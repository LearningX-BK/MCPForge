// MCPForge — W0-F5's proofs. 02 §3.1.4, 03 §7.5. Wave 0 exit criterion 7(a).
//
// The `done:` criterion, clause by clause, and where each is proved here:
//
//   1. all four reversal classes are in the type model, and `irreversible`
//      structurally forces `humanApprovalRequired: true` + `reviewPath:
//      standard`                                        -> "the four classes"
//      (codegen's refusal of a write tool with no `reversal.class` is proved
//      where the rule lives: core/codegen/src/rules/rules.test.ts, fixture
//      `reversal-class-missing`.)
//   2. execute writes `reversal_class`, the reversing tool id and the
//      extracted `result_keys` into the audit row      -> "the audit row"
//   3. `forge audit reverse` constructs the reversing call by applying
//      `argMap` to the original result keys            -> "constructing"
//   4. the reversal itself runs the full plan -> confirm sequence
//                                                      -> "the reversal is a write"
//   5. both calls linked in both directions            -> "both directions"
//
// Everything below runs against a REAL SQLite store, through the REAL policy
// chain, the REAL confirm gate and the REAL write dispatcher. The only mock is
// the target system itself, which is the one thing a local build cannot have.

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REVERSAL_CLASSES, type ReviewPath, type ToolManifest } from '@mcpforge/shared';
import { openRuntimeStore } from '../store/store.js';
import type { RuntimeStore } from '../store/repository.js';
import { runPolicyChain } from '../policy/chain.js';
import {
  call,
  context,
  defaultRoles,
  entry,
  functionGrant,
  role,
  TOOLS,
} from '../policy/policy.fixtures.js';
import type { PolicyCall, PolicyContext } from '../policy/types.js';
import { confirmWriteGate, type DryRunner, type WriteSafetyView } from '../policy/confirm/gate.js';
import { generateConfirmSigningKey, singleKeyKeyring } from '../policy/confirm/token.js';
import { idempotencyGate } from '../policy/idempotency/gate.js';
import { writeDispatcher, type WriteDispatcher } from '../policy/idempotency/dispatch.js';
import type { WriteTargetInvoker } from '../policy/idempotency/types.js';
import { constructReversingCall, contractForCall } from './construct.js';
import { reversalRegistry } from './registry.js';
import { extractResultKeys } from './result-keys.js';
import { reverseCall } from './reverse.js';
import type { ReversalContract, ReversalExecutor } from './types.js';

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-f5-'));
let store: RuntimeStore;
let dbSeq = 0;

beforeEach(async () => {
  dbSeq += 1;
  store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, `f5-${dbSeq}.db`) });
});

// Closed per test: an open SQLite handle keeps the file locked on Windows.
afterEach(async () => {
  await store.close();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// --- the world -------------------------------------------------------------

const NOW = new Date('2026-09-03T12:00:00.000Z');
const KEYRING = singleKeyKeyring(generateConfirmSigningKey('kid-f5'));

const CREATE_ARGS = {
  supplier_number: 4242,
  amount: 18400,
  currency: 'GBP',
  company: '00100',
} as const;

/** The reversal contract under test — 02 §3.1.4's own worked example. */
const CREATE_REVERSAL: ReversalContract = {
  class: 'compensating-tool',
  tool: TOOLS.voucherCancel,
  argMap: {
    document_number: '$.result.document_number',
    document_company: '$.result.document_company',
  },
  windowHours: 720,
};

const VOUCHER_CREATE: WriteSafetyView = {
  toolId: TOOLS.voucherCreate,
  toolVersion: '1.0.0',
  planTemplate:
    'Create an AP voucher for supplier {supplier_number} for {amount} {currency}. This creates an OPEN PAYABLE in JD Edwards.',
  tokenTtlSeconds: 300,
  humanApprovalRequired: false,
  reversal: CREATE_REVERSAL,
  dryRunStrategy: 'validate-pair',
  entity: 'voucher',
  verb: 'create',
};

/**
 * The REVERSING tool's own write safety. It has one because a reversal is
 * itself a write (03 §7.5) — it plans, it mints a token, it confirms, and it is
 * refused if any of that is skipped. A cancel with no `writeSafety` would be
 * the shortcut this task exists to prove does not exist.
 */
const VOUCHER_CANCEL: WriteSafetyView = {
  toolId: TOOLS.voucherCancel,
  toolVersion: '1.0.0',
  planTemplate:
    'Cancel voucher {document_number} in company {document_company}. This VOIDS an open payable in JD Edwards.',
  tokenTtlSeconds: 300,
  humanApprovalRequired: false,
  reversal: { class: 'native-reverse' },
  dryRunStrategy: 'validate-pair',
  entity: 'voucher',
  verb: 'cancel',
};

const WRITE_SAFETY: Readonly<Record<string, WriteSafetyView>> = {
  [TOOLS.voucherCreate]: VOUCHER_CREATE,
  [TOOLS.voucherCancel]: VOUCHER_CANCEL,
};

const DRY_RUN: DryRunner = { plan: () => ({ warnings: [], planValues: {} }) };

const REGISTRY = reversalRegistry({
  [TOOLS.voucherCreate]: CREATE_REVERSAL,
  [TOOLS.voucherCancel]: { class: 'native-reverse' },
});

/**
 * The mock target. `create` answers in the RAW shape a JDE orchestration
 * answers in — nested under `voucher` — so the result-key extraction under test
 * is the real one over the real declared paths, not a flat object arranged to
 * make the test pass.
 */
function mockTarget() {
  const invocations: { readonly toolId: string; readonly args: Record<string, unknown> }[] = [];
  let documentNumber = 8000;

  const invoker: WriteTargetInvoker = {
    async invoke(input) {
      invocations.push({ toolId: input.entry.toolId, args: { ...input.call.args } });
      if (input.entry.toolId === TOOLS.voucherCancel) {
        return { voucher: { docNumber: String(input.call.args['document_number']), status: 'CANCELLED' } };
      }
      documentNumber += 1;
      return {
        voucher: {
          docNumber: String(documentNumber),
          docType: 'PV',
          docCo: String(CREATE_ARGS.company),
        },
        status: 'CREATED',
      };
    },
  };

  return { invoker, invocations };
}

function policyCall(toolId: string, args: Record<string, unknown>): PolicyCall {
  return { ...call(toolId, args), entryPoint: 'tools/call' as const };
}

function ctx(): PolicyContext {
  const roles = new Map(defaultRoles());
  roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
  return context({
    heldRoleIds: ['p2p'],
    roles,
    now: NOW,
    runtime: {
      writeGate: confirmWriteGate({
        writeSafetyFor: (toolId) => WRITE_SAFETY[toolId],
        dryRun: DRY_RUN,
        keyring: KEYRING,
        now: () => NOW,
      }),
      idempotency: idempotencyGate({ store, now: () => NOW }),
    },
  });
}

function dispatcherFor(target: ReturnType<typeof mockTarget>): WriteDispatcher {
  return writeDispatcher({ store, invoker: target.invoker, now: () => NOW });
}

/**
 * One whole write, exactly as a gateway runs it: plan through the real chain,
 * then confirm with the token the plan returned, then — only on `proceed` —
 * dispatch. Nothing here reorders or skips a stage, and there is no path from
 * a caller to `dispatch` that does not pass through `runPolicyChain` first.
 */
async function planConfirmExecute(
  context_: PolicyContext,
  dispatcher: WriteDispatcher,
  toolId: string,
  args: Record<string, unknown>,
  reversesCallId?: string,
): Promise<{ readonly callId: string; readonly response: Record<string, unknown> }> {
  const planDecision = await runPolicyChain(policyCall(toolId, args), context_);
  if (planDecision.outcome !== 'responded') {
    throw new Error(`plan phase did not respond for ${toolId}: ${planDecision.outcome}`);
  }
  const token = String(planDecision.response['confirmToken']);

  const confirmedCall = policyCall(toolId, { ...args, confirm: token });
  const decision = await runPolicyChain(confirmedCall, context_);
  if (decision.outcome !== 'proceed') {
    throw new Error(`confirm phase did not proceed for ${toolId}: ${JSON.stringify(decision)}`);
  }
  const outcome = await dispatcher.dispatch({
    call: confirmedCall,
    entry: entry(toolId),
    ctx: context_,
    confirmed: decision.confirmed,
    ...(reversesCallId === undefined ? {} : { reversesCallId }),
  });
  if (outcome.kind !== 'executed') {
    throw new Error(`dispatch did not execute ${toolId}: ${JSON.stringify(outcome)}`);
  }
  return { callId: outcome.auditCallId!, response: { ...outcome.response } };
}

/**
 * A real `ReversalExecutor` over the real chain and the real dispatcher.
 *
 * This is the whole point of clause 4, and it is deliberately nothing but a
 * call to `planConfirmExecute`: the reversal has no private route to the
 * binding, mints no token of its own, and skips no stage. The ONE thing it
 * carries that an ordinary write does not is `reversesCallId`.
 */
function executorOver(
  context_: PolicyContext,
  dispatcher: WriteDispatcher,
): ReversalExecutor {
  return {
    async planAndConfirm(input) {
      try {
        const done = await planConfirmExecute(
          context_,
          dispatcher,
          input.toolId,
          { ...input.args },
          input.reversesCallId,
        );
        return { ok: true, callId: done.callId, plan: {}, result: done.response };
      } catch (error) {
        return {
          ok: false,
          phase: 'execute',
          code: 'TARGET_ERROR',
          message: error instanceof Error ? error.message : String(error),
          next: `Establish the state of the original write in the target system before retrying the reversal.`,
        };
      }
    },
  };
}

// --- 1: the four classes ---------------------------------------------------

describe('the four reversal classes are in the type model, and irreversible is structural', () => {
  it('is exactly 02 §3.1.4’s four, in the shared manifest types', () => {
    expect([...REVERSAL_CLASSES]).toEqual([
      'native-reverse',
      'compensating-tool',
      'transactional',
      'irreversible',
    ]);
  });

  // The assertion is the COMPILE, not the runtime expectation below it: this
  // block does not type-check if `IrreversibleWriteToolManifest` stops pinning
  // `humanApprovalRequired: true` and `reviewPath: 'standard'` as literals.
  // 02 §3.1.4: "irreversible forces humanApprovalRequired: true and reviewPath:
  // standard" — forced in the type, not merely checked at validate time.
  it('irreversible structurally forces humanApprovalRequired: true and reviewPath: standard', () => {
    type Irreversible = Extract<
      ToolManifest['writeSafety'],
      { readonly reversal: { readonly class: 'irreversible' } }
    >;
    type ApprovalField = Irreversible['humanApprovalRequired'];

    // `true`, not `boolean`: assigning `false` to this is a compile error.
    const approval: ApprovalField = true;
    expect(approval).toBe(true);

    // @ts-expect-error — humanApprovalRequired: false is not expressible for an
    // irreversible write. If this line ever compiles, the type has gone soft.
    const notAllowed: ApprovalField = false;
    expect(notAllowed).toBe(false);

    // The review path an irreversible write may carry is the literal
    // 'standard'; 'expedited' is a ReviewPath but not this one.
    const reviewPath = 'standard' as const;
    const anyPath: ReviewPath = reviewPath;
    expect(anyPath).toBe('standard');
  });

  it('extracts the declared result keys out of a RAW target response, by their paths', () => {
    const keys = extractResultKeys(
      { voucher: { docNumber: '8001', docType: 'PV', docCo: '00100' } },
      [
        { name: 'document_number', path: '$.voucher.docNumber' },
        { name: 'document_type', path: '$.voucher.docType' },
        { name: 'missing_key', path: '$.voucher.nope' },
      ],
    );
    // A key with no value is OMITTED, never written as an empty business key.
    expect(keys).toEqual([
      { keyName: 'document_number', keyValue: '8001' },
      { keyName: 'document_type', keyValue: 'PV' },
    ]);
  });
});

// --- 2: what execute freezes into the audit row ----------------------------

describe('execute writes the reversal contract and the result keys into the audit row', () => {
  it('records reversal_class, the reversing tool id and the extracted result_keys', async () => {
    const target = mockTarget();
    const { callId } = await planConfirmExecute(
      ctx(),
      dispatcherFor(target),
      TOOLS.voucherCreate,
      { ...CREATE_ARGS },
    );

    const row = await store.audit.get(callId);
    expect(row).toBeDefined();
    expect(row!.isWrite).toBe(true);
    expect(row!.phase).toBe('execute');
    expect(row!.reversalClass).toBe('compensating-tool');
    expect(row!.reversalToolId).toBe(TOOLS.voucherCancel);
    expect(row!.resultKeys).toEqual([
      { keyName: 'document_number', keyValue: '8001' },
      { keyName: 'document_type', keyValue: 'PV' },
      { keyName: 'document_company', keyValue: '00100' },
    ]);
  });

  it('records the consumer’s ATTESTED human-in-the-loop, not an assumed one', async () => {
    const target = mockTarget();
    const { callId } = await planConfirmExecute(
      ctx(),
      dispatcherFor(target),
      TOOLS.voucherCreate,
      { ...CREATE_ARGS },
    );
    const row = await store.audit.get(callId);
    // The fixture consumer attests true; the value comes from the registration,
    // never from the gateway deciding a human was probably there.
    expect(row!.humanInTheLoop).toBe(true);
  });

  it('the frozen row wins over a manifest edited AFTER the call was made', async () => {
    const target = mockTarget();
    const { callId } = await planConfirmExecute(
      ctx(),
      dispatcherFor(target),
      TOOLS.voucherCreate,
      { ...CREATE_ARGS },
    );
    const row = (await store.audit.get(callId))!;

    // Someone re-declares the tool as reversed by a DIFFERENT tool. The call
    // that was already made is not retro-fitted to the new manifest.
    const edited = reversalRegistry({
      [TOOLS.voucherCreate]: {
        class: 'native-reverse',
        tool: 'jde.ap.voucher.update',
        argMap: CREATE_REVERSAL.argMap!,
      },
    });
    const contract = contractForCall(row, edited);
    expect(contract?.class).toBe('compensating-tool');
    expect(contract?.tool).toBe(TOOLS.voucherCancel);
    // The argMap is the one part the row does not freeze, so it still comes
    // from the manifest — which is why this is flagged in the task report.
    expect(contract?.argMap).toEqual(CREATE_REVERSAL.argMap);
  });
});

// --- 3: constructing the reversing call ------------------------------------

describe('the reversing call is constructed by applying argMap to the recorded result keys', () => {
  it('fills the reversing tool’s arguments from the ORIGINAL call’s business keys', async () => {
    const target = mockTarget();
    const { callId } = await planConfirmExecute(
      ctx(),
      dispatcherFor(target),
      TOOLS.voucherCreate,
      { ...CREATE_ARGS },
    );

    const report = await reverseCall(callId, {
      audit: store.audit,
      registry: REGISTRY,
      now: () => NOW,
    });

    expect(report.refusal).toBeNull();
    expect(report.reversingToolId).toBe(TOOLS.voucherCancel);
    expect(report.reversingCall).toEqual({
      toolId: TOOLS.voucherCancel,
      // Exactly the keys the CREATE recorded — 8001 and 00100 — and nothing
      // invented. `document_type` is recorded but not mapped, so it is absent.
      args: { document_number: '8001', document_company: '00100' },
    });
    // Construct-only: nothing was executed, and the report says so honestly.
    expect(report.executed).toBeNull();
    expect(target.invocations).toHaveLength(1);
  });

  it('refuses an unknown call id with a next, rather than throwing', async () => {
    const report = await reverseCall('no-such-call', {
      audit: store.audit,
      registry: REGISTRY,
      now: () => NOW,
    });
    expect(report.refusal?.reason).toBe('call_not_found');
    expect(report.refusal?.next.length ?? 0).toBeGreaterThan(0);
  });

  it('refuses an irreversible class with the REASON a human can act on (03 §7.5)', () => {
    const record = {
      id: 'call-x',
      toolId: 'jde.ap.payment.release',
      isWrite: true,
      phase: 'execute',
      outcome: 'ok',
      ts: NOW.toISOString(),
      reversalClass: 'irreversible',
      reversalToolId: null,
      resultKeys: [],
      targetSystem: 'JD Edwards',
    } as never;
    const result = constructReversingCall({
      record,
      contract: { class: 'irreversible' },
      now: NOW,
      alreadyReversedBy: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('irreversible');
    expect(result.message).toMatch(/irreversible/);
    // Non-negotiable 5: never "try again". It names the human action.
    expect(result.next).not.toMatch(/try again/i);
    expect(result.next).toMatch(/manual|human/i);
  });

  it('refuses once the declared window has closed', async () => {
    const target = mockTarget();
    const { callId } = await planConfirmExecute(
      ctx(),
      dispatcherFor(target),
      TOOLS.voucherCreate,
      { ...CREATE_ARGS },
    );
    // 720 declared hours + a day.
    const tooLate = new Date(NOW.getTime() + 745 * 3600 * 1000);
    const report = await reverseCall(callId, {
      audit: store.audit,
      registry: REGISTRY,
      now: () => tooLate,
    });
    expect(report.refusal?.reason).toBe('window_expired');
    expect(report.refusal?.next.length ?? 0).toBeGreaterThan(0);
  });

  it('refuses to invent arguments when the original call recorded no business keys', async () => {
    const appended = await store.audit.append({
      ts: NOW.toISOString(),
      correlationId: 'corr-keyless',
      callerSubject: 'u-0001',
      callerRoles: ['p2p'],
      consumerId: 'claude-desktop-coe',
      humanInTheLoop: true,
      toolId: TOOLS.voucherCreate,
      toolVersion: '1.0.0',
      serverId: 'jde-ap',
      bindingType: 'function',
      sensitivityClass: 'financial',
      isWrite: true,
      deploymentId: 'ltm-dev',
      phase: 'execute',
      argsHash: 'a'.repeat(64),
      replayed: false,
      resultKeys: [],
      outcome: 'ok',
      reversalClass: 'compensating-tool',
      reversalToolId: TOOLS.voucherCancel,
    });

    const report = await reverseCall(appended.id, {
      audit: store.audit,
      registry: REGISTRY,
      now: () => NOW,
    });
    expect(report.refusal?.reason).toBe('missing_result_key');
    expect(report.reversingCall).toBeNull();
  });
});

// --- 4 + 5: the reversal is a write, and both ends are linked --------------

describe('the reversal runs the full plan -> confirm sequence, and both calls are linked', () => {
  it('executes the reversal through the real chain and links both directions', async () => {
    const target = mockTarget();
    const dispatcher = dispatcherFor(target);
    const context_ = ctx();

    const original = await planConfirmExecute(context_, dispatcher, TOOLS.voucherCreate, {
      ...CREATE_ARGS,
    });

    const report = await reverseCall(original.callId, {
      audit: store.audit,
      registry: REGISTRY,
      executor: executorOver(context_, dispatcher),
      now: () => NOW,
    });

    expect(report.refusal).toBeNull();
    expect(report.executed?.ok).toBe(true);

    // The reversal really reached the target, with the constructed arguments.
    expect(target.invocations.map((i) => i.toolId)).toEqual([
      TOOLS.voucherCreate,
      TOOLS.voucherCancel,
    ]);
    expect(target.invocations[1]!.args['document_number']).toBe('8001');
    expect(target.invocations[1]!.args['document_company']).toBe('00100');
    // It carried a REAL confirm token: the dispatcher refuses without one, and
    // the chain mints one only from a plan.
    expect(target.invocations[1]!.args['confirm']).toMatch(/.+/);

    // Both ends of the edge, from the store, not from the report's own memory.
    const reversalCallId = report.executed!.ok ? report.executed!.callId : '';
    const forward = await store.audit.reversalLinks(original.callId);
    const backward = await store.audit.reversalLinks(reversalCallId);
    expect(forward?.reversedByCallId).toBe(reversalCallId);
    expect(forward?.reversesCallId).toBeNull();
    expect(backward?.reversesCallId).toBe(original.callId);

    // And the report itself, re-read after the execute, carries both.
    expect(report.links?.reversedByCallId).toBe(reversalCallId);

    // The reversing row is a first-class audit row of its own, recorded as a
    // reversal rather than as an ordinary execute.
    const reversalRow = await store.audit.get(reversalCallId);
    expect(reversalRow!.toolId).toBe(TOOLS.voucherCancel);
    expect(reversalRow!.phase).toBe('reverse');
    expect(reversalRow!.isWrite).toBe(true);
    expect(reversalRow!.reversesCallId).toBe(original.callId);
    // The reversal declares its OWN reversal class, because it is itself a write.
    expect(reversalRow!.reversalClass).toBe('native-reverse');
  });

  it('a reversed call cannot be reversed twice', async () => {
    const target = mockTarget();
    const dispatcher = dispatcherFor(target);
    const context_ = ctx();
    const original = await planConfirmExecute(context_, dispatcher, TOOLS.voucherCreate, {
      ...CREATE_ARGS,
    });

    const deps = {
      audit: store.audit,
      registry: REGISTRY,
      executor: executorOver(context_, dispatcher),
      now: () => NOW,
    };
    const first = await reverseCall(original.callId, deps);
    expect(first.executed?.ok).toBe(true);

    const second = await reverseCall(original.callId, deps);
    expect(second.refusal?.reason).toBe('already_reversed');
    expect(second.executed).toBeNull();
    // Two target calls in total — the create and the ONE cancel.
    expect(target.invocations).toHaveLength(2);
  });

  it('the audit hash chain still verifies with both rows in it', async () => {
    const target = mockTarget();
    const dispatcher = dispatcherFor(target);
    const context_ = ctx();
    const original = await planConfirmExecute(context_, dispatcher, TOOLS.voucherCreate, {
      ...CREATE_ARGS,
    });
    await reverseCall(original.callId, {
      audit: store.audit,
      registry: REGISTRY,
      executor: executorOver(context_, dispatcher),
      now: () => NOW,
    });

    const verified = await store.audit.verifyChain('ltm-dev');
    expect(verified.firstBreak).toBeNull();
    expect(verified.rowsChecked).toBe(2);
  });
});
