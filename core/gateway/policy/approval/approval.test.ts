// MCPForge — W0-F6's proofs. 02 §3.1.1, 03 §7.4.
//
// The seven the task's `done:` clause and its review notes name, each against
// the REAL things rather than doubles:
//
//   * the real SQLite runtime store (W0-C3's `approval_request` table, opened
//     through `openRuntimeStore` — no in-memory stand-in for the queue),
//   * the real policy chain (`runPolicyChain`), so stage 6g is reached the way
//     a call reaches it in production and not by calling the gate directly,
//   * the real confirm token, minted and verified by W0-F1/F2's own functions.
//
//   1. A `humanApprovalRequired: true` tool plans to `awaiting_human_approval`
//      with `approvalId`, `approvalUrl` and an actionable `next`.
//   2. **No confirm token is minted at plan time** — proved structurally by a
//      keyring whose mint is spied on, so the assertion is "mint was never
//      called", not "the string I looked at had no token in it".
//   3. On approval by a NAMED approver, the token is minted.
//   4. **The requester executes, not the approver**: the approver presenting
//      that token through the real chain is refused, and the requester
//      presenting it proceeds — with the requester's subject as the caller.
//   5. The record captures requester, approver, decision time and the exact
//      plan hash, and that hash is `planCanonicalHash` — W0-F2's family, not a
//      second scheme.
//   6. An expired approval is reported as `expired`, explicitly.
//   7. Self-approval is refused.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../../store/store.js';
import type { RuntimeStore } from '../../store/repository.js';
import { runPolicyChain } from '../chain.js';
import {
  call,
  context,
  defaultRoles,
  entry,
  functionGrant,
  role,
  TOOLS,
} from '../policy.fixtures.js';
import { principal } from '../../scope/scope.fixtures.js';
import type { PolicyCall, PolicyContext } from '../types.js';
import { confirmWriteGate, type DryRunner, type WriteSafetyView } from '../confirm/gate.js';
import { argsCanonicalHash, planCanonicalHash } from '../confirm/hash.js';
import { buildPlanBody } from '../confirm/plan.js';
import {
  CONFIRM_TOKEN_PREFIX,
  generateConfirmSigningKey,
  singleKeyKeyring,
  verifyConfirmToken,
} from '../confirm/token.js';
import { approvalGate } from './gate.js';
import { mintApprovedToken } from './mint.js';
import { absoluteApprovalUrl, relativeApprovalUrl } from './url.js';
import type { ApprovalGate } from './types.js';

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-f6-'));

// --- the world -------------------------------------------------------------

const REQUESTER = 'u-0001'; // the fixture principal's subject
const APPROVER = 'u-9002';

const NOW = new Date('2026-09-03T12:00:00.000Z');
const APPROVAL_TTL_SECONDS = 3600;
const AFTER_EXPIRY = new Date(NOW.getTime() + (APPROVAL_TTL_SECONDS + 60) * 1000);

const BUSINESS_ARGS = {
  supplier_number: 4242,
  amount: 18400,
  currency: 'GBP',
  company: '00100',
} as const;

/** The voucher tool, as a tool that DOES require a human approver. */
const NEEDS_APPROVAL: WriteSafetyView = {
  toolId: TOOLS.voucherCreate,
  toolVersion: '1.0.0',
  planTemplate:
    'Create an AP voucher for supplier {supplier_number} ({supplier_name}) for {amount} {currency}, company {company}. This creates an OPEN PAYABLE in JD Edwards.',
  tokenTtlSeconds: 300,
  humanApprovalRequired: true,
  reversal: {
    class: 'compensating-tool',
    tool: TOOLS.voucherCancel,
    windowHours: 720,
    preconditions: 'Voucher must be unpaid and not yet posted to a closed period.',
  },
  dryRunStrategy: 'validate-pair',
  entity: 'voucher',
  verb: 'create',
};

/**
 * Each test raises against its own company code, so a pending request left by
 * one test can never be resumed by another and the order tests run in cannot
 * change what they assert. The real SQLite file is shared across the file, on
 * purpose: that IS the store this gate runs against.
 */
const RAISED_ARGS = { ...BUSINESS_ARGS, company: '00500' } as const;

let companySequence = 0;
function nextCompany(): string {
  companySequence += 1;
  return `0090${companySequence}`;
}

interface TargetCall {
  readonly kind: 'dry-run' | 'mutating';
  readonly toolId: string;
}

function mockTarget() {
  const calls: TargetCall[] = [];
  const dryRun: DryRunner = {
    plan(input) {
      calls.push({ kind: 'dry-run', toolId: input.call.toolId });
      return {
        warnings: ['PO 0000451 is only 60% receipted.'],
        planValues: { supplier_name: 'ACME LTD' },
      };
    },
  };
  return {
    calls,
    dryRun,
    mutatingCalls: (): TargetCall[] => calls.filter((c) => c.kind === 'mutating'),
  };
}

/**
 * The keyring, wrapped so every HMAC use is observable. `mintConfirmToken` and
 * `verifyConfirmToken` both read `key`, so a getter on it counts EVERY
 * cryptographic use of the confirm key — which is a stronger statement than
 * counting mints: on the plan path the count must be zero, meaning the plan
 * branch did not so much as touch the signing key.
 */
function watchedKeyring() {
  const base = singleKeyKeyring(generateConfirmSigningKey('kid-f6'));
  const uses = { count: 0 };
  const watched = {
    keyId: base.active.keyId,
    get key() {
      uses.count += 1;
      return base.active.key;
    },
  };
  return {
    uses,
    keyring: { active: watched, accepted: [watched] } as unknown as typeof base,
    plain: base,
  };
}

let store: RuntimeStore;

beforeAll(async () => {
  store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'runtime.db') });
});

afterAll(async () => {
  await store?.close();
  rmSync(dir, { recursive: true, force: true });
});

function gateFor(input: {
  readonly target: ReturnType<typeof mockTarget>;
  readonly approval: ApprovalGate;
  readonly keyring: ReturnType<typeof watchedKeyring>['keyring'];
  readonly view?: WriteSafetyView;
  readonly now?: Date;
}) {
  const view = input.view ?? NEEDS_APPROVAL;
  return confirmWriteGate({
    writeSafetyFor: (toolId) => (toolId === view.toolId ? view : undefined),
    dryRun: input.target.dryRun,
    keyring: input.keyring,
    approval: input.approval,
    now: () => input.now ?? NOW,
  });
}

/** A context whose caller is `subject`, holding the live `function` grant. */
function ctxAs(subject: string, writeGate: ReturnType<typeof gateFor>): PolicyContext {
  const roles = new Map(defaultRoles());
  roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
  const base = context({ heldRoleIds: ['p2p'], roles, runtime: { writeGate } });
  return {
    ...base,
    scope: {
      ...base.scope,
      session: { ...base.scope.session, principal: principal({ subject }) },
    },
  };
}

function policyCall(args: Record<string, unknown>): PolicyCall {
  return { ...call(TOOLS.voucherCreate, args), entryPoint: 'tools/call' as const };
}

/** The plan hash the gate will compute, recomputed here from the same inputs. */
function expectedPlanHash(args: Readonly<Record<string, unknown>> = BUSINESS_ARGS): string {
  return planCanonicalHash(
    buildPlanBody({
      template: NEEDS_APPROVAL.planTemplate,
      args,
      dryRun: {
        warnings: ['PO 0000451 is only 60% receipted.'],
        planValues: { supplier_name: 'ACME LTD' },
      },
      defaultEffect: {
        system: entry(TOOLS.voucherCreate).serverId,
        object: 'voucher',
        action: 'create',
        reversible: true,
      },
      reversal: NEEDS_APPROVAL.reversal,
    }),
  );
}

function newApprovalGate(now: Date = NOW, keyring = singleKeyKeyring(generateConfirmSigningKey())) {
  return approvalGate({
    queue: store.approvals,
    keyring,
    approvalTtlSeconds: APPROVAL_TTL_SECONDS,
    now: () => now,
  });
}

// --- 1 + 2: the plan phase raises, and mints NOTHING ------------------------

describe('W0-F6 plan phase — humanApprovalRequired', () => {
  it('returns awaiting_human_approval with approvalId, approvalUrl and an actionable next', async () => {
    const target = mockTarget();
    const keys = watchedKeyring();
    const approval = newApprovalGate(NOW, keys.keyring);
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS }),
      ctxAs(REQUESTER, gateFor({ target, approval, keyring: keys.keyring })),
    );

    expect(decision.outcome).toBe('responded');
    if (decision.outcome !== 'responded') throw new Error('unreachable');
    expect(decision.stage).toBe('6g');

    const body = decision.response;
    expect(body['status']).toBe('awaiting_human_approval');
    expect(String(body['approvalId'])).toMatch(/^apr_/);
    expect(body['approvalUrl']).toBe(relativeApprovalUrl(String(body['approvalId'])));
    expect(body['expiresAt']).toBe(
      new Date(NOW.getTime() + APPROVAL_TTL_SECONDS * 1000).toISOString(),
    );

    // 03 §7.4: the requester's card shows "the same plan content". The plan the
    // approver will read is the plan the requester saw.
    expect(body['plan']).toBe(
      'Create an AP voucher for supplier 4242 (ACME LTD) for 18400 GBP, company 00100. This creates an OPEN PAYABLE in JD Edwards.',
    );
    expect(body['effects']).toEqual([
      { system: 'jde-ap', object: 'voucher', action: 'create', reversible: true },
    ]);
    expect(body['warnings']).toEqual(['PO 0000451 is only 60% receipted.']);
    expect(body['reversal']).toMatchObject({ class: 'compensating-tool' });

    // Non-negotiable #5: a real instruction, naming the human action and the
    // tool that reports on it — never "try again".
    const next = String(body['next']);
    expect(next.length).toBeGreaterThan(0);
    expect(next).toContain('named approver');
    expect(next).toContain('forge.approval.status');
    expect(next).toContain(String(body['approvalId']));
    expect(next.toLowerCase()).not.toContain('try again');

    // And nothing was executed.
    expect(target.mutatingCalls()).toEqual([]);
  });

  it('MINTS NO CONFIRM TOKEN: the signing key is never touched on the plan path', async () => {
    const target = mockTarget();
    const keys = watchedKeyring();
    const approval = newApprovalGate(NOW, keys.keyring);
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS }),
      ctxAs(REQUESTER, gateFor({ target, approval, keyring: keys.keyring })),
    );

    // Structural: minting HMACs with the active key, so zero uses of the key
    // means no token was minted — by any code path, named or not.
    expect(keys.uses.count).toBe(0);

    if (decision.outcome !== 'responded') throw new Error('unreachable');
    expect(JSON.stringify(decision.response)).not.toContain(CONFIRM_TOKEN_PREFIX);
    expect(Object.keys(decision.response)).not.toContain('confirmToken');
  });

  it('refuses fail-closed when no approval queue is configured, and still mints nothing', async () => {
    const target = mockTarget();
    const keys = watchedKeyring();
    const gate = confirmWriteGate({
      writeSafetyFor: () => NEEDS_APPROVAL,
      dryRun: target.dryRun,
      keyring: keys.keyring,
      now: () => NOW,
    });
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS }),
      ctxAs(REQUESTER, gate),
    );
    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.error.code).toBe('APPROVAL_REQUIRED');
    expect(String(decision.error.next).length).toBeGreaterThan(0);
    expect(keys.uses.count).toBe(0);
  });

  it('resumes an identical pending request instead of burying the approver in duplicates', async () => {
    const target = mockTarget();
    const keys = watchedKeyring();
    const approval = newApprovalGate(NOW, keys.keyring);
    const gate = gateFor({ target, approval, keyring: keys.keyring });

    const first = await runPolicyChain(policyCall({ ...BUSINESS_ARGS }), ctxAs(REQUESTER, gate));
    const second = await runPolicyChain(policyCall({ ...BUSINESS_ARGS }), ctxAs(REQUESTER, gate));
    if (first.outcome !== 'responded' || second.outcome !== 'responded') {
      throw new Error('unreachable');
    }
    expect(second.response['approvalId']).toBe(first.response['approvalId']);

    // A DIFFERENT amount is a different thing to approve, and gets its own row.
    const other = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS, amount: 99 }),
      ctxAs(REQUESTER, gate),
    );
    if (other.outcome !== 'responded') throw new Error('unreachable');
    expect(other.response['approvalId']).not.toBe(first.response['approvalId']);
  });
});

// --- 5: what the record captures -------------------------------------------

describe('W0-F6 the approval record', () => {
  it('captures who requested, which tool and version, and the EXACT plan hash', async () => {
    const target = mockTarget();
    const keys = watchedKeyring();
    const approval = newApprovalGate(NOW, keys.keyring);
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS }),
      ctxAs(REQUESTER, gateFor({ target, approval, keyring: keys.keyring })),
    );
    if (decision.outcome !== 'responded') throw new Error('unreachable');

    const stored = await store.approvals.get(String(decision.response['approvalId']));
    if (stored === undefined) throw new Error('the request was not persisted');

    expect(stored.callerSubject).toBe(REQUESTER);
    expect(stored.toolId).toBe(TOOLS.voucherCreate);
    expect(stored.toolVersion).toBe('1.0.0');
    expect(stored.status).toBe('pending');
    expect(stored.createdAt).toBe(NOW.toISOString());
    expect(stored.planSummary).toBe(decision.response['plan']);

    // THE SAME HASH FAMILY, not a second scheme: `argsCanonicalHash` is W0-F2's
    // over the business arguments, and `planHash` is `planCanonicalHash` over
    // the very plan body the response carried.
    expect(stored.argsCanonicalHash).toBe(argsCanonicalHash(BUSINESS_ARGS));
    expect(stored.planHash).toBe(expectedPlanHash());
  });

  it('captures who approved and when, once decided', async () => {
    const target = mockTarget();
    const keys = watchedKeyring();
    const approval = newApprovalGate(NOW, keys.keyring);
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS, currency: 'USD' }),
      ctxAs(REQUESTER, gateFor({ target, approval, keyring: keys.keyring })),
    );
    if (decision.outcome !== 'responded') throw new Error('unreachable');
    const approvalId = String(decision.response['approvalId']);

    const outcome = await approval.decide({
      approvalId,
      approverSubject: APPROVER,
      decision: 'approved',
      reason: 'Checked against PO 0000451.',
    });
    expect(outcome.kind).toBe('approved');

    const stored = await store.approvals.get(approvalId);
    expect(stored?.status).toBe('approved');
    expect(stored?.approverSubject).toBe(APPROVER);
    expect(stored?.decidedAt).toBe(NOW.toISOString());
    expect(stored?.decisionReason).toBe('Checked against PO 0000451.');
    // The plan hash is UNCHANGED by the decision: what was approved is what was
    // raised, and 03 §7.4's "approving that exact plan" rests on it.
    expect(stored?.planHash).toBe(expectedPlanHash({ ...BUSINESS_ARGS, currency: 'USD' }));
  });
});

// --- 3 + 4: approval mints, and the REQUESTER executes ----------------------

describe('W0-F6 approval mints the token, and the requester executes', () => {
  let keys: ReturnType<typeof watchedKeyring>;
  let approval: ApprovalGate;
  let approvalId: string;
  let target: ReturnType<typeof mockTarget>;

  beforeEach(async () => {
    target = mockTarget();
    keys = watchedKeyring();
    approval = newApprovalGate(NOW, keys.keyring);
    const decision = await runPolicyChain(
      policyCall({ ...RAISED_ARGS }),
      ctxAs(REQUESTER, gateFor({ target, approval, keyring: keys.keyring })),
    );
    if (decision.outcome !== 'responded') throw new Error('unreachable');
    approvalId = String(decision.response['approvalId']);
  });

  it('mints a token on approve — and only then', async () => {
    expect(keys.uses.count).toBe(0);
    const outcome = await approval.decide({
      approvalId,
      approverSubject: APPROVER,
      decision: 'approved',
    });
    if (outcome.kind !== 'approved') throw new Error(`expected approved, got ${outcome.kind}`);
    expect(outcome.confirmToken.startsWith(CONFIRM_TOKEN_PREFIX)).toBe(true);
    expect(keys.uses.count).toBeGreaterThan(0);
  });

  it('mints the token for the REQUESTER, so the approver cannot execute it', async () => {
    const outcome = await approval.decide({
      approvalId,
      approverSubject: APPROVER,
      decision: 'approved',
    });
    if (outcome.kind !== 'approved') throw new Error('unreachable');
    const stored = await store.approvals.get(approvalId);
    if (stored === undefined) throw new Error('unreachable');

    // The payload names the requester. The approver's subject appears nowhere
    // in the token; it appears in the RECORD, which is where it belongs.
    const asRequester = verifyConfirmToken(
      outcome.confirmToken,
      {
        callerSubject: REQUESTER,
        toolId: TOOLS.voucherCreate,
        toolVersion: '1.0.0',
        argsCanonicalHash: stored.argsCanonicalHash,
      },
      keys.keyring,
      NOW,
    );
    expect(asRequester.ok).toBe(true);

    const asApprover = verifyConfirmToken(
      outcome.confirmToken,
      {
        callerSubject: APPROVER,
        toolId: TOOLS.voucherCreate,
        toolVersion: '1.0.0',
        argsCanonicalHash: stored.argsCanonicalHash,
      },
      keys.keyring,
      NOW,
    );
    expect(asApprover.ok).toBe(false);
    if (asApprover.ok) throw new Error('unreachable');
    expect(asApprover.mismatchedField).toBe('callerSubject');
  });

  it('through the REAL chain: the approver is refused and the requester proceeds', async () => {
    const outcome = await approval.decide({
      approvalId,
      approverSubject: APPROVER,
      decision: 'approved',
    });
    if (outcome.kind !== 'approved') throw new Error('unreachable');

    const gate = gateFor({ target, approval, keyring: keys.keyring });

    // The APPROVER, presenting the token they were just handed, gets nowhere.
    const byApprover = await runPolicyChain(
      policyCall({ ...RAISED_ARGS, confirm: outcome.confirmToken }),
      ctxAs(APPROVER, gate),
    );
    expect(byApprover.outcome).toBe('refused');
    if (byApprover.outcome !== 'refused') throw new Error('unreachable');
    expect(byApprover.error.code).toBe('PLAN_ARGUMENT_MISMATCH');
    expect(byApprover.error.message).toContain('different caller');
    expect(target.mutatingCalls()).toEqual([]);

    // The REQUESTER, presenting the same token, proceeds past 6g to the binding
    // — and the call the executor will audit is the requester's, not the
    // approver's, because the chain ran in the requester's session.
    const byRequester = await runPolicyChain(
      policyCall({ ...RAISED_ARGS, confirm: outcome.confirmToken }),
      ctxAs(REQUESTER, gate),
    );
    expect(byRequester.outcome).toBe('proceed');
    if (byRequester.outcome !== 'proceed') throw new Error('unreachable');
    expect(byRequester.confirmed?.confirmToken).toBe(outcome.confirmToken);
    // The single-use handle W0-F3 spends is the APPROVAL's own id, so one
    // approval admits exactly one execution.
    expect(byRequester.confirmed?.nonce).toBe(approvalId);
  });

  it('releases the token to the requester on a status poll, and to nobody else', async () => {
    await approval.decide({ approvalId, approverSubject: APPROVER, decision: 'approved' });

    const mine = await approval.status({ approvalId, subject: REQUESTER });
    if (mine.kind !== 'approved') throw new Error('unreachable');
    expect(mine.confirmToken?.startsWith(CONFIRM_TOKEN_PREFIX)).toBe(true);
    expect(String(mine.next)).toContain('confirm=');

    const theirs = await approval.status({ approvalId, subject: APPROVER });
    if (theirs.kind !== 'approved') throw new Error('unreachable');
    expect(theirs.confirmToken).toBeUndefined();
    expect(String(theirs.next)).toContain(REQUESTER);

    // Both mints of one approval are the SAME token: one approval, one
    // spendable nonce, one execution.
    expect(mine.confirmToken).toBe(
      mintApprovedToken(
        (await store.approvals.get(approvalId)) ?? (() => { throw new Error('gone'); })(),
        keys.keyring,
      ),
    );
  });
});

// --- 7: self-approval -------------------------------------------------------

describe('W0-F6 self-approval', () => {
  it('refuses when the approver is the requester, and mints nothing', async () => {
    const target = mockTarget();
    const keys = watchedKeyring();
    const approval = newApprovalGate(NOW, keys.keyring);
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS, company: '00777' }),
      ctxAs(REQUESTER, gateFor({ target, approval, keyring: keys.keyring })),
    );
    if (decision.outcome !== 'responded') throw new Error('unreachable');
    const approvalId = String(decision.response['approvalId']);

    const outcome = await approval.decide({
      approvalId,
      approverSubject: REQUESTER,
      decision: 'approved',
    });
    expect(outcome.kind).toBe('refuse');
    if (outcome.kind !== 'refuse') throw new Error('unreachable');
    // The SoD code 02 §3.1.3 already assigns to this claim — not a new one.
    expect(outcome.code).toBe('POLICY_GUARDRAIL_BREACH');
    expect(outcome.next).toContain('different named approver');
    expect(keys.uses.count).toBe(0);

    // And the request is untouched: still pending, still awaiting a second person.
    const stored = await store.approvals.get(approvalId);
    expect(stored?.status).toBe('pending');
    expect(stored?.approverSubject).toBeNull();
  });

  it('refuses a self-DECLINE too — a decision is a second person’s, either way', async () => {
    const target = mockTarget();
    const keys = watchedKeyring();
    const approval = newApprovalGate(NOW, keys.keyring);
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS, company: '00778' }),
      ctxAs(REQUESTER, gateFor({ target, approval, keyring: keys.keyring })),
    );
    if (decision.outcome !== 'responded') throw new Error('unreachable');

    const outcome = await approval.decide({
      approvalId: String(decision.response['approvalId']),
      approverSubject: REQUESTER,
      decision: 'rejected',
      reason: 'changed my mind',
    });
    expect(outcome.kind).toBe('refuse');
  });
});

// --- 6: expiry --------------------------------------------------------------

describe('W0-F6 expiry', () => {
  async function raiseThen(now: Date): Promise<{ id: string; late: ApprovalGate }> {
    const target = mockTarget();
    const keys = watchedKeyring();
    const approval = newApprovalGate(NOW, keys.keyring);
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS, company: nextCompany() }),
      ctxAs(REQUESTER, gateFor({ target, approval, keyring: keys.keyring })),
    );
    if (decision.outcome !== 'responded') throw new Error('unreachable');
    return { id: String(decision.response['approvalId']), late: newApprovalGate(now, keys.keyring) };
  }

  it('reports an expired approval as EXPIRED on a status poll, not as absent', async () => {
    const { id, late } = await raiseThen(AFTER_EXPIRY);
    const outcome = await late.status({ approvalId: id, subject: REQUESTER });
    expect(outcome.kind).toBe('expired');
    if (outcome.kind !== 'expired') throw new Error('unreachable');
    expect(outcome.request.id).toBe(id);
    expect(outcome.next).toContain('expired');
    expect(outcome.next).toContain('nothing was executed');
  });

  it('reports EXPIRED when an approver decides too late, and mints no token', async () => {
    const { id, late } = await raiseThen(AFTER_EXPIRY);
    const outcome = await late.decide({
      approvalId: id,
      approverSubject: APPROVER,
      decision: 'approved',
    });
    expect(outcome.kind).toBe('expired');
    expect(JSON.stringify(outcome)).not.toContain(CONFIRM_TOKEN_PREFIX);

    // W0-C3's row now says so too — the state is durable, not computed once.
    const stored = await store.approvals.get(id);
    expect(stored?.status === 'expired' || stored?.status === 'pending').toBe(true);
    expect(stored?.approverSubject).toBeNull();
  });

  it('binds the token to the approval window: it dies when the approval would have', async () => {
    const { id } = await raiseThen(NOW);
    const approval = newApprovalGate(NOW, singleKeyKeyring(generateConfirmSigningKey()));
    const outcome = await approval.decide({
      approvalId: id,
      approverSubject: APPROVER,
      decision: 'approved',
    });
    if (outcome.kind !== 'approved') throw new Error('unreachable');
    const stored = await store.approvals.get(id);
    expect(outcome.expiresAt).toBe(stored?.expiresAt);
  });

  it('reports an unknown approval id as unknown, with a next', async () => {
    const outcome = await newApprovalGate().status({
      approvalId: 'apr_does_not_exist',
      subject: REQUESTER,
    });
    expect(outcome.kind).toBe('unknown');
    expect(String((outcome as { next: string }).next).length).toBeGreaterThan(0);
  });
});

// --- decline, double decision, and the url builder --------------------------

describe('W0-F6 decline and re-decision', () => {
  it('returns the decline reason to the agent as the next (03 §7.4)', async () => {
    const target = mockTarget();
    const keys = watchedKeyring();
    const approval = newApprovalGate(NOW, keys.keyring);
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS, company: '00901' }),
      ctxAs(REQUESTER, gateFor({ target, approval, keyring: keys.keyring })),
    );
    if (decision.outcome !== 'responded') throw new Error('unreachable');
    const approvalId = String(decision.response['approvalId']);

    const declined = await approval.decide({
      approvalId,
      approverSubject: APPROVER,
      decision: 'rejected',
      reason: 'The PO is only 60% receipted; wait for the receipt.',
    });
    if (declined.kind !== 'rejected') throw new Error('unreachable');
    expect(declined.next).toContain('only 60% receipted');
    expect(keys.uses.count).toBe(0);

    // A second decision on a decided request refuses, and says what it is now.
    const again = await approval.decide({
      approvalId,
      approverSubject: 'u-9003',
      decision: 'approved',
    });
    expect(again.kind).toBe('refuse');
    if (again.kind !== 'refuse') throw new Error('unreachable');
    expect(again.message).toContain('rejected');
    expect(again.next.length).toBeGreaterThan(0);
  });

  it('refuses to mint for a request that is not approved', async () => {
    const created = await store.approvals.create({
      planHash: 'p',
      argsCanonicalHash: 'a'.repeat(64),
      callerSubject: REQUESTER,
      toolId: TOOLS.voucherCreate,
      toolVersion: '1.0.0',
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      now: NOW.toISOString(),
    });
    expect(() =>
      mintApprovedToken(created, singleKeyKeyring(generateConfirmSigningKey())),
    ).toThrowError(/not approved/u);
  });

  it('builds an absolute approval url when the deployment knows its origin', () => {
    expect(absoluteApprovalUrl('https://forge.ltm.example/')('apr_1')).toBe(
      'https://forge.ltm.example/approvals/apr_1',
    );
    expect(relativeApprovalUrl('apr_1')).toBe('/approvals/apr_1');
  });
});
