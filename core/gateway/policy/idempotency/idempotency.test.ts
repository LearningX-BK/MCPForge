// MCPForge — W0-F3's proofs. 02 §3.1.2 (+ §3.1.1's single-use half).
//
// Wave 0 exit criterion 7(d), clause by clause:
//
//   1. `idempotencyKey = sha256(callerSubject | toolId | toolVersion |
//      argsCanonicalHash | confirmToken)` — the five parts, literally.
//   2. The record is written BEFORE the binding is invoked — asserted from
//      inside the mock target, which reads the store at the moment it is called.
//   3. A repeat within `scopeHours` returns the ORIGINAL result with
//      `"replayed": true`, and the mock target confirms it was called EXACTLY
//      ONCE — sequentially AND concurrently.
//   4. The confirm token's nonce is genuinely spent, inside the execute
//      transaction, so the literal same token cannot authorise a second call.
//
// Everything runs against a REAL SQLite store and through the REAL policy chain
// at stage 6h's existing seam. There is no second idempotency mechanism.

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../../store/store.js';
import type { RuntimeStore } from '../../store/repository.js';
import { runPolicyChain } from '../chain.js';
import {
  call,
  consumer as consumerView,
  context,
  defaultRoles,
  entry,
  functionGrant,
  role,
  TOOLS,
} from '../policy.fixtures.js';
import type { ConfirmedCall, PolicyCall, PolicyCatalogueEntry, PolicyContext } from '../types.js';
import { argsCanonicalHash } from '../confirm/hash.js';
import { confirmWriteGate, type DryRunner, type WriteSafetyView } from '../confirm/gate.js';
import { generateConfirmSigningKey, singleKeyKeyring } from '../confirm/token.js';
import { idempotencyKeyFor } from '../../store/runtime/idempotency.js';
import { idempotencyGate } from './gate.js';
import { writeDispatcher } from './dispatch.js';
import { idempotencyKeyForCall } from './key.js';
import type { WriteTargetInvoker } from './types.js';

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-f3-'));
let store: RuntimeStore;
let dbSeq = 0;

afterEach(async () => {
  // Closed per test: an open SQLite handle keeps the file locked on Windows and
  // the directory cannot be removed.
  await store.close();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// --- the world -------------------------------------------------------------

const NOW = new Date('2026-09-03T12:00:00.000Z');
const KEYRING = singleKeyKeyring(generateConfirmSigningKey('kid-f3'));

const BUSINESS_ARGS = {
  supplier_number: 4242,
  amount: 18400,
  currency: 'GBP',
  company: '00100',
} as const;

const VOUCHER_CREATE: WriteSafetyView = {
  toolId: TOOLS.voucherCreate,
  toolVersion: '1.0.0',
  planTemplate:
    'Create an AP voucher for supplier {supplier_number} for {amount} {currency}. This creates an OPEN PAYABLE in JD Edwards.',
  tokenTtlSeconds: 300,
  humanApprovalRequired: false,
  reversal: { class: 'compensating-tool', tool: TOOLS.voucherCancel, windowHours: 720 },
  dryRunStrategy: 'validate-pair',
  entity: 'voucher',
  verb: 'create',
};

const DRY_RUN: DryRunner = { plan: () => ({ warnings: [], planValues: {} }) };

/** The mock target. It records every invocation and what the store held at that moment. */
function mockTarget() {
  const invocations: { readonly idempotencyKey: string; readonly recordStatus: string }[] = [];
  let documentNumber = 8000;

  const invoker: WriteTargetInvoker = {
    async invoke(input) {
      // Clause 2, asserted from the inside: the record must ALREADY exist when
      // the binding is invoked, and it must still be `pending`.
      const record = await store.idempotency.get(input.idempotencyKey);
      invocations.push({
        idempotencyKey: input.idempotencyKey,
        recordStatus: record?.status ?? 'ABSENT',
      });
      documentNumber += 1;
      return { document_number: documentNumber, status: 'CREATED' };
    },
  };

  return { invoker, invocations };
}

function policyCall(args: Record<string, unknown>): PolicyCall {
  return { ...call(TOOLS.voucherCreate, args), entryPoint: 'tools/call' as const };
}

function voucherEntry(): PolicyCatalogueEntry {
  return entry(TOOLS.voucherCreate);
}

/** p2p with the live `function` grant, the real 6g gate and the real 6h gate. */
function ctxFor(scopeHours?: number): PolicyContext {
  const roles = new Map(defaultRoles());
  roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
  return context({
    heldRoleIds: ['p2p'],
    roles,
    now: NOW,
    runtime: {
      writeGate: confirmWriteGate({
        writeSafetyFor: (toolId) => (toolId === VOUCHER_CREATE.toolId ? VOUCHER_CREATE : undefined),
        dryRun: DRY_RUN,
        keyring: KEYRING,
        now: () => NOW,
      }),
      idempotency: idempotencyGate({
        store,
        now: () => NOW,
        ...(scopeHours === undefined ? {} : { scopeHoursFor: () => scopeHours }),
      }),
    },
  });
}

function dispatcherFor(target: ReturnType<typeof mockTarget>, scopeHours?: number) {
  return writeDispatcher({
    store,
    invoker: target.invoker,
    now: () => NOW,
    ...(scopeHours === undefined ? {} : { scopeHoursFor: () => scopeHours }),
  });
}

/** Run the plan phase through the real chain and return the minted token. */
async function planToken(ctx: PolicyContext, args: Record<string, unknown>): Promise<string> {
  const decision = await runPolicyChain(policyCall(args), ctx);
  if (decision.outcome !== 'responded') throw new Error('plan phase did not respond');
  return String(decision.response['confirmToken']);
}

/**
 * The whole write path, exactly as a gateway runs it: the chain, then — only on
 * `proceed` — the dispatcher. Nothing here reorders or skips a stage.
 */
async function executeWrite(
  ctx: PolicyContext,
  dispatcher: ReturnType<typeof dispatcherFor>,
  args: Record<string, unknown>,
) {
  const call_ = policyCall(args);
  const decision = await runPolicyChain(call_, ctx);
  if (decision.outcome !== 'proceed') return { decision } as const;
  const outcome = await dispatcher.dispatch({
    call: call_,
    entry: voucherEntry(),
    ctx,
    confirmed: decision.confirmed,
  });
  return { decision, outcome } as const;
}

beforeEach(async () => {
  dbSeq += 1;
  store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, `f3-${dbSeq}.db`) });
});

// --- 1: the key ------------------------------------------------------------

describe('the key is 02 §3.1.2’s five parts, and nothing else', () => {
  it('derives sha256(callerSubject | toolId | toolVersion | argsCanonicalHash | confirmToken)', () => {
    const ctx = ctxFor();
    const confirmed: ConfirmedCall = {
      argsCanonicalHash: argsCanonicalHash(BUSINESS_ARGS),
      confirmToken: 'cnf_fixed',
      nonce: 'nonce-1',
      tokenExpiresAt: '2026-09-03T12:05:00.000Z',
    };
    const derived = idempotencyKeyForCall(voucherEntry(), ctx, confirmed);

    expect(derived).toBe(
      idempotencyKeyFor({
        callerSubject: ctx.scope.session.principal.subject,
        toolId: TOOLS.voucherCreate,
        toolVersion: '1.0.0',
        argsCanonicalHash: confirmed.argsCanonicalHash,
        confirmToken: 'cnf_fixed',
      }),
    );
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    // The composition is W0-C3's and is not re-implemented here: this asserts
    // the five parts reach it, not a second sha256 over the same text.
    expect(derived).not.toBe(createHash('sha256').update('anything else').digest('hex'));
  });

  it('carries no consumer component — the literal five parts, per 02 §3.1.2 and TASKS.md', () => {
    const ctx = ctxFor();
    const confirmed: ConfirmedCall = {
      argsCanonicalHash: 'a'.repeat(64),
      confirmToken: 'cnf_fixed',
      nonce: 'n',
      tokenExpiresAt: '2026-09-03T12:05:00.000Z',
    };
    const asRegistered = idempotencyKeyForCall(voucherEntry(), ctx, confirmed);
    const otherConsumer = context({
      heldRoleIds: ['p2p'],
      now: NOW,
      consumer: consumerView({ consumerId: 'a-completely-different-consumer' }),
    });
    expect(idempotencyKeyForCall(voucherEntry(), otherConsumer, confirmed)).toBe(asRegistered);
  });
});

// --- 2 + 3: the record, the replay, the single execution -------------------

describe('the record is written before the binding, and a repeat replays it', () => {
  it('the mock target sees a PENDING record already written when it is invoked', async () => {
    const ctx = ctxFor();
    const target = mockTarget();
    const token = await planToken(ctx, { ...BUSINESS_ARGS });

    const { outcome } = await executeWrite(ctx, dispatcherFor(target), {
      ...BUSINESS_ARGS,
      confirm: token,
    });

    expect(outcome?.kind).toBe('executed');
    expect(target.invocations).toHaveLength(1);
    expect(target.invocations[0]?.recordStatus).toBe('pending');
  });

  it('a repeat within the window returns the ORIGINAL result with replayed: true, and the target runs ONCE', async () => {
    const ctx = ctxFor();
    const target = mockTarget();
    const dispatcher = dispatcherFor(target);
    const token = await planToken(ctx, { ...BUSINESS_ARGS });
    const args = { ...BUSINESS_ARGS, confirm: token };

    const first = await executeWrite(ctx, dispatcher, args);
    // `auditCallId` joined this outcome with W0-F5: an executed write now
    // returns the id of the audit row it wrote, which is what `forge audit
    // reverse` is later handed. Matched loosely here so this suite keeps
    // asserting the REPLAY property rather than the audit row's identifier.
    expect(first.outcome).toMatchObject({
      kind: 'executed',
      response: { document_number: 8001, status: 'CREATED' },
    });
    expect((first.outcome as { auditCallId?: string }).auditCallId).toMatch(/.+/);

    // The repeat does not even reach the dispatcher: stage 6h answers it.
    const second = await executeWrite(ctx, dispatcher, args);
    expect(second.decision.outcome).toBe('responded');
    if (second.decision.outcome !== 'responded') throw new Error('unreachable');
    expect(second.decision.stage).toBe('6h');
    expect(second.decision.response).toEqual({
      document_number: 8001,
      status: 'CREATED',
      replayed: true,
    });

    expect(target.invocations).toHaveLength(1);
  });

  it('CONCURRENTLY: the same confirmed token presented twice invokes the target exactly once', async () => {
    const ctx = ctxFor();
    const target = mockTarget();
    const dispatcher = dispatcherFor(target);
    const token = await planToken(ctx, { ...BUSINESS_ARGS });
    const args = { ...BUSINESS_ARGS, confirm: token };

    const [a, b] = await Promise.all([
      executeWrite(ctx, dispatcher, args),
      executeWrite(ctx, dispatcher, args),
    ]);

    // ONE call to the target. This is the whole criterion.
    expect(target.invocations).toHaveLength(1);

    const outcomes = [a.outcome, b.outcome];
    expect(outcomes.map((o) => o?.kind).sort()).toEqual(['executed', 'replayed']);

    const executed = outcomes.find((o) => o?.kind === 'executed');
    const replayed = outcomes.find((o) => o?.kind === 'replayed');
    if (executed?.kind !== 'executed' || replayed?.kind !== 'replayed') {
      throw new Error('unreachable');
    }
    // The replayed caller sees the ORIGINAL result, marked.
    expect(replayed.response).toEqual({
      document_number: 8001,
      status: 'CREATED',
      replayed: true,
    });
    expect(executed.response).toEqual({ document_number: 8001, status: 'CREATED' });
  });

  it('a storm of identical presentations still invokes the target exactly once', async () => {
    const ctx = ctxFor();
    const target = mockTarget();
    const dispatcher = dispatcherFor(target);
    const token = await planToken(ctx, { ...BUSINESS_ARGS });
    const args = { ...BUSINESS_ARGS, confirm: token };

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => executeWrite(ctx, dispatcher, args)),
    );

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(target.invocations).toHaveLength(1);
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const outcome = r.value.outcome;
      if (outcome === undefined || outcome.kind === 'refused') {
        throw new Error(`an identical presentation was neither executed nor replayed`);
      }
      expect(outcome.response['document_number']).toBe(8001);
    }
  });

  it('outside the window the call runs again — the record no longer governs', async () => {
    const target = mockTarget();
    const ctx = ctxFor();
    const token = await planToken(ctx, { ...BUSINESS_ARGS });
    const args = { ...BUSINESS_ARGS, confirm: token };

    await executeWrite(ctx, dispatcherFor(target), args);
    expect(target.invocations).toHaveLength(1);

    // A window of zero hours: every record is already out of scope. The nonce is
    // spent, so this proves the WINDOW is what reopened the key — and that the
    // token's own single-use is a separate, still-enforced control.
    const laterCtx = ctxFor(0);
    const later = await executeWrite(laterCtx, dispatcherFor(target, 0), args);
    expect(later.outcome?.kind).toBe('refused');
    if (later.outcome?.kind !== 'refused') throw new Error('unreachable');
    expect(later.outcome.code).toBe('PLAN_EXPIRED');
    expect(target.invocations).toHaveLength(1);
  });
});

// --- 4: the nonce is actually spent ---------------------------------------

describe('the confirm token becomes single-use here (02 §3.1.1)', () => {
  it('spends the nonce inside the execute transaction', async () => {
    const ctx = ctxFor();
    const target = mockTarget();
    const token = await planToken(ctx, { ...BUSINESS_ARGS });
    const args = { ...BUSINESS_ARGS, confirm: token };

    const decision = await runPolicyChain(policyCall(args), ctx);
    if (decision.outcome !== 'proceed' || decision.confirmed === null) {
      throw new Error('chain did not proceed');
    }
    const nonce = decision.confirmed.nonce;
    expect(await store.nonces.find(nonce)).toBeUndefined();

    await dispatcherFor(target).dispatch({
      call: policyCall(args),
      entry: voucherEntry(),
      ctx,
      confirmed: decision.confirmed,
    });

    const spent = await store.nonces.find(nonce);
    expect(spent?.toolId).toBe(TOOLS.voucherCreate);
    expect(spent?.callerSubject).toBe(ctx.scope.session.principal.subject);
  });

  it('refuses a second presentation of the LITERAL same token under a different key', async () => {
    const ctx = ctxFor();
    const target = mockTarget();
    const token = await planToken(ctx, { ...BUSINESS_ARGS });
    const dispatcher = dispatcherFor(target);

    const decision = await runPolicyChain(policyCall({ ...BUSINESS_ARGS, confirm: token }), ctx);
    if (decision.outcome !== 'proceed' || decision.confirmed === null) {
      throw new Error('chain did not proceed');
    }
    await dispatcher.dispatch({
      call: policyCall({ ...BUSINESS_ARGS, confirm: token }),
      entry: voucherEntry(),
      ctx,
      confirmed: decision.confirmed,
    });
    expect(target.invocations).toHaveLength(1);

    // Same nonce, different argument hash: a different idempotency key, so the
    // replay path cannot catch it. Only the spent nonce can — and it does.
    const replayed = await dispatcher.dispatch({
      call: policyCall({ ...BUSINESS_ARGS, confirm: token }),
      entry: voucherEntry(),
      ctx,
      confirmed: { ...decision.confirmed, argsCanonicalHash: 'f'.repeat(64) },
    });

    expect(replayed.kind).toBe('refused');
    if (replayed.kind !== 'refused') throw new Error('unreachable');
    expect(replayed.code).toBe('PLAN_EXPIRED');
    expect(replayed.next.trim().length).toBeGreaterThan(0);
    expect(replayed.next.toLowerCase()).not.toContain('try again');
    // Still exactly one target call.
    expect(target.invocations).toHaveLength(1);
  });
});

// --- stage 6h's in-flight refusal -----------------------------------------

describe('a pending record refuses rather than duplicating', () => {
  it('stage 6h refuses an identical call whose earlier attempt never settled', async () => {
    const ctx = ctxFor();
    const target = mockTarget();
    const token = await planToken(ctx, { ...BUSINESS_ARGS });
    const args = { ...BUSINESS_ARGS, confirm: token };

    // Simulate the attempt that died between its record and its outcome.
    await store.idempotency.begin({
      callerSubject: ctx.scope.session.principal.subject,
      toolId: TOOLS.voucherCreate,
      toolVersion: '1.0.0',
      argsCanonicalHash: argsCanonicalHash({ ...BUSINESS_ARGS, confirm: token }),
      confirmToken: token,
      now: NOW.toISOString(),
    });

    const { decision, outcome } = await executeWrite(ctx, dispatcherFor(target), args);
    expect(outcome).toBeUndefined();
    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.stage).toBe('6h');
    expect(decision.error.code).toBe('RATE_LIMITED');
    expect(decision.error.next.toLowerCase()).not.toContain('try again');
    expect(target.invocations).toHaveLength(0);
  });
});
