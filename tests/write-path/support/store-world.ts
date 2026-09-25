// MCPForge — W0-F7. The store-backed world shared by criteria (a) and (d):
// a REAL SQLite store, the REAL policy chain, the REAL guardrail evaluator, the
// REAL confirm gate, the REAL human-approval gate, the REAL idempotency gate and
// the REAL write dispatcher. The only thing that is not real is the target
// system itself — the one thing a local build cannot have (the same posture
// W0-F5's and W0-F3's own suites take; see this task's `reads:` list).
//
// [W0-F8] WHAT THIS FILE USED TO GET WRONG, AND WHY IT MATTERED.
// Until W0-F8 this world built its catalogue entry from
// `core/gateway/policy/policy.fixtures.ts`, which (1) stubbed the guardrail
// evaluator to answer `{breached:false}` unconditionally, so the real evaluator
// was never in the test at all, and (2) hand-wrote `WriteSafetyView`s for
// `voucher.create`/`voucher.cancel` that DISAGREED with the shipped manifests —
// `humanApprovalRequired: false` and `reversal.class: 'native-reverse'` where the
// manifest says `true` and `irreversible`. So criterion (a) passed while
// `jde.ap.voucher.cancel` was, in the real system, unreachable: its
// then-declared `requiresField` guardrail refused every call at stage 6f, before
// the plan/confirm/execute path this evidence claims to prove was ever reached.
// A test that describes a different tool than the one that ships is not evidence.
//
// THE FIX, and the rule this file now follows: **every write-safety fact in this
// world comes from the shipped manifest, read with codegen's own reader
// (`readTool`), and is cross-checked against the artefact codegen actually
// emitted (`generated/tools/<id>/tool.ts`) before any test runs.** If the
// manifest and the generated artefact ever disagree, or if either disagrees with
// what this world asserts, module load throws and the suite cannot produce a
// green tick. Nothing here restates a manifest value; the checks below are
// assertions ABOUT agreement, not a second copy of the data.
//
// [W0-P13] THE WORKAROUND THIS FILE USED TO DISCLOSE IS GONE. Until W0-P13
// this file carried two hand builders (`catalogueEntryFor`,
// `writeSafetyViewFor`) and a module-load agreement check against
// `generated/tools/<id>/tool.ts`, because no composition root turned the
// committed artefacts into runtime objects. That root now exists:
// `core/gateway/assembly/` loads `manifests/` through `forge validate`'s own
// rules, cross-checks every tool against its committed registration and
// `schema.json` (drift refuses to load), and resolves the catalogue entry, the
// write-safety view, the reversal registry and the compiled-Ajv 6d validator
// for all 11 tools. This world takes all four from it and builds none of them.
//
// STILL NOT REAL, and named honestly: the target system is a mock. Everything
// on the path, 6a through 6h, INCLUDING stage 6d's argument validation (now the
// compiled Ajv over each tool's committed `schema.json`), is the shipped code.
//
// SEAM FOR A LIVE TARGET: everything downstream of `mockTarget()` — the
// context, the dispatcher, `planConfirmExecute` — takes a `WriteTargetInvoker`
// and never inspects its internals. Pointing criteria (a)/(d) at a live
// instance later is: replace `mockTarget().invoker` with an invoker that
// calls the real AIS/Orchestrator endpoint (the same seam
// `adapters/function`'s binding executor implements) and leave every other
// line in this file untouched. THIS HAS NEVER BEEN RUN AGAINST A LIVE
// INSTANCE — flagged honestly in this task's final report, not silently.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRuntimeStore } from '../../../core/gateway/store/store.js';
import type { RuntimeStore } from '../../../core/gateway/store/repository.js';
import { runPolicyChain } from '../../../core/gateway/policy/chain.js';
import {
  call,
  context,
  defaultRoles,
  functionGrant,
  role,
  TOOLS,
} from '../../../core/gateway/policy/policy.fixtures.js';
import type {
  PolicyCall,
  PolicyCatalogueEntry,
  PolicyContext,
} from '../../../core/gateway/policy/types.js';
import {
  confirmWriteGate,
  type DryRunner,
  type WriteSafetyView,
} from '../../../core/gateway/policy/confirm/gate.js';
import {
  generateConfirmSigningKey,
  singleKeyKeyring,
} from '../../../core/gateway/policy/confirm/token.js';
import { approvalGate, type ApprovalGate } from '../../../core/gateway/policy/approval/index.js';
import { guardrailEvaluator } from '../../../core/gateway/policy/guardrails/gate.js';
import { idempotencyGate } from '../../../core/gateway/policy/idempotency/gate.js';
import {
  writeDispatcher,
  type WriteDispatcher,
} from '../../../core/gateway/policy/idempotency/dispatch.js';
import type { WriteTargetInvoker } from '../../../core/gateway/policy/idempotency/types.js';
import type { ReversalContract, ReversalExecutor } from '../../../core/gateway/reversal/types.js';
import { loadRuntimeCatalogue } from '../../../core/gateway/assembly/index.js';

export { TOOLS };

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');

export const NOW = new Date('2026-09-04T09:00:00.000Z');
export const KEYRING = singleKeyKeyring(generateConfirmSigningKey('kid-f7'));

/** The approver in this world. Never the requester — self-approval is refused. */
export const APPROVER_SUBJECT = 'a.approver@ltm.example';

export const CREATE_ARGS = {
  supplier_number: '4242',
  amount: 18_400,
  currency: 'GBP',
  company: '00100',
} as const;

// --- the runtime catalogue: the gateway's own resolver (W0-P13) ---------------
//
// Loading it IS the drift check: a manifest that fails `forge validate`, or a
// generated artefact that has drifted from its manifest, throws here, at module
// load, and no suite in this directory can produce a green tick over it.

export const CATALOGUE = await loadRuntimeCatalogue({ repoRoot: REPO_ROOT });

function resolved(toolId: string) {
  const tool = CATALOGUE.tools.get(toolId);
  if (tool === undefined) throw new Error(`W0-P13: ${toolId} is not in the runtime catalogue`);
  return tool;
}

/** Codegen's own view of each manifest, as the resolver read it. */
export const CREATE_VIEW = resolved(TOOLS.voucherCreate).view;
export const CANCEL_VIEW = resolved(TOOLS.voucherCancel).view;

/**
 * The write-safety posture this world REQUIRES of these two tools, asserted (not
 * restated) at module load. If a change proposal ever weakens `voucher.cancel` —
 * drops its human approval, softens `irreversible`, shortens its idempotency
 * window — the criterion-(a) evidence stops being produced instead of quietly
 * describing a weaker control. W0-F8's own brief: the fix was to the test, never
 * to the control.
 */
function assertPosture(): void {
  const cancel = CANCEL_VIEW.writeSafety!;
  const create = CREATE_VIEW.writeSafety!;
  const problems: string[] = [];
  if (cancel.humanApprovalRequired !== true)
    problems.push('cancel.humanApprovalRequired is not true');
  if (cancel.reversalClass !== 'irreversible')
    problems.push('cancel.reversal.class is not irreversible');
  if (cancel.idempotencyScopeHours !== 24) problems.push('cancel.idempotency.scopeHours is not 24');
  if (create.reversalClass !== 'compensating-tool')
    problems.push('create.reversal.class is not compensating-tool');
  if (create.reversalTool !== TOOLS.voucherCancel)
    problems.push(`create.reversal.tool is not ${TOOLS.voucherCancel}`);
  if (Object.keys(create.reversalArgMap).length === 0)
    problems.push('create.reversal.argMap is empty');
  if (problems.length > 0) {
    throw new Error(`W0-F8: the shipped write-safety posture changed — ${problems.join('; ')}`);
  }
}

assertPosture();

export const VOUCHER_CREATE: WriteSafetyView = CATALOGUE.writeSafetyFor(TOOLS.voucherCreate)!;
export const VOUCHER_CANCEL: WriteSafetyView = CATALOGUE.writeSafetyFor(TOOLS.voucherCancel)!;

export const CREATE_REVERSAL: ReversalContract = CATALOGUE.reversals.contractFor(
  TOOLS.voucherCreate,
)!;
export const CANCEL_REVERSAL: ReversalContract = CATALOGUE.reversals.contractFor(
  TOOLS.voucherCancel,
)!;

/** The catalogue entry the chain resolves — the real one, not a fixture. */
export function entryFor(toolId: string): PolicyCatalogueEntry {
  const found = CATALOGUE.entryFor(toolId);
  if (found === undefined) throw new Error(`no real catalogue entry for ${toolId}`);
  return found;
}

export const DRY_RUN: DryRunner = { plan: () => ({ warnings: [], planValues: {} }) };

export const REGISTRY = CATALOGUE.reversals;

// --- store lifecycle ---------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-f7-'));
let seq = 0;

export async function openStore(): Promise<RuntimeStore> {
  seq += 1;
  return openRuntimeStore({ kind: 'sqlite', file: join(dir, `f7-${seq}.db`) });
}

export function cleanupStoreDir(): void {
  rmSync(dir, { recursive: true, force: true });
}

// --- the mock target ---------------------------------------------------------
//
// Answers in the RAW shape a JDE orchestration answers in — nested under
// `voucher` — so result-key extraction (used by criterion (a)) runs over the
// real declared paths, not a flattened object arranged to make a test pass.

export function mockTarget() {
  const invocations: { readonly toolId: string; readonly args: Record<string, unknown> }[] = [];
  let documentNumber = 9000;

  const invoker: WriteTargetInvoker = {
    async invoke(input) {
      invocations.push({ toolId: input.entry.toolId, args: { ...input.call.args } });
      if (input.entry.toolId === TOOLS.voucherCancel) {
        return {
          voucher: {
            docNumber: String(input.call.args['document_number']),
            docType: String(input.call.args['document_type']),
            docCo: String(input.call.args['document_company']),
            status: 'CANCELLED',
          },
        };
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

// --- context / dispatcher builders -------------------------------------------

export function policyCall(toolId: string, args: Record<string, unknown>): PolicyCall {
  return { ...call(toolId, args), entryPoint: 'tools/call' as const };
}

/**
 * The approval gate this context's stage 6g holds. `planConfirmExecute` reaches
 * the SAME instance — there is no second path by which an approval can be
 * recorded or a token minted (02 §3.1.1, W0-F6).
 */
const APPROVALS = new WeakMap<PolicyContext, ApprovalGate>();

export function approvalsFor(ctx: PolicyContext): ApprovalGate {
  const gate = APPROVALS.get(ctx);
  if (gate === undefined) throw new Error('no approval gate registered for this context');
  return gate;
}

export function ctxFor(store: RuntimeStore, scopeHours?: number): PolicyContext {
  const roles = new Map(defaultRoles());
  // The grant names the REAL binding refs both manifests declare, so stage 6e′
  // authorizes exactly the orchestrations these two tools actually bind to.
  roles.set(
    'p2p',
    role({
      roleId: 'p2p',
      bindingGrants: [functionGrant({ names: [CREATE_VIEW.bindingRef, CANCEL_VIEW.bindingRef] })],
    }),
  );
  const approvals = approvalGate({ queue: store.approvals, keyring: KEYRING, now: () => NOW });
  const ctx = context({
    heldRoleIds: ['p2p'],
    roles,
    now: NOW,
    catalogue: CATALOGUE.entries,
    runtime: {
      // THE REAL 6d (W0-P13): compiled Ajv over each tool's committed schema.json.
      argumentValidator: CATALOGUE.argumentValidator,
      // THE REAL EVALUATOR (W0-F8). Previously a stub that answered
      // `{breached:false}` for everything, which is what let a tool that
      // refused every call at 6f look reachable.
      guardrails: guardrailEvaluator({ now: () => NOW }),
      writeGate: confirmWriteGate({
        writeSafetyFor: (toolId) => CATALOGUE.writeSafetyFor(toolId),
        dryRun: DRY_RUN,
        keyring: KEYRING,
        approval: approvals,
        now: () => NOW,
      }),
      idempotency: idempotencyGate({
        store,
        now: () => NOW,
        ...(scopeHours === undefined ? {} : { scopeHoursFor: () => scopeHours }),
      }),
    },
  });
  APPROVALS.set(ctx, approvals);
  return ctx;
}

export function dispatcherFor(
  store: RuntimeStore,
  target: ReturnType<typeof mockTarget>,
  scopeHours?: number,
): WriteDispatcher {
  return writeDispatcher({
    store,
    invoker: target.invoker,
    now: () => NOW,
    ...(scopeHours === undefined ? {} : { scopeHoursFor: () => scopeHours }),
  });
}

export interface WriteRun {
  readonly callId: string;
  readonly response: Record<string, unknown>;
  /** The approval this write went through, when its manifest requires one. */
  readonly approvalId: string | null;
  readonly approverSubject: string | null;
}

/**
 * One whole write, exactly as the gateway runs it: plan through the real
 * chain, take the human-approval detour when the tool's manifest declares one,
 * confirm with the token that path minted, dispatch only on `proceed`.
 *
 * [W0-F8] The approval branch is not a convenience — `jde.ap.voucher.cancel`
 * really does declare `humanApprovalRequired: true` (forced by
 * `reversal.class: irreversible`), so the reversal leg of criterion (a) really
 * does stop for a named approver. A helper that skipped it would be the same
 * class of mistake as the fixture it replaced.
 */
export async function planConfirmExecute(
  ctx: PolicyContext,
  dispatcher: WriteDispatcher,
  toolId: string,
  args: Record<string, unknown>,
  reversesCallId?: string,
): Promise<WriteRun> {
  const planDecision = await runPolicyChain(policyCall(toolId, args), ctx);
  if (planDecision.outcome !== 'responded') {
    throw new Error(`plan phase did not respond for ${toolId}: ${JSON.stringify(planDecision)}`);
  }

  let token: string;
  let approvalId: string | null = null;
  let approverSubject: string | null = null;

  if (planDecision.response['status'] === 'awaiting_human_approval') {
    if (planDecision.response['confirmToken'] !== undefined) {
      throw new Error(`${toolId} minted a confirm token on the approval path`);
    }
    approvalId = String(planDecision.response['approvalId']);
    const decision = await approvalsFor(ctx).decide({
      approvalId,
      approverSubject: APPROVER_SUBJECT,
      decision: 'approved',
    });
    if (decision.kind !== 'approved') {
      throw new Error(`approval of ${toolId} did not approve: ${JSON.stringify(decision)}`);
    }
    approverSubject = APPROVER_SUBJECT;
    token = decision.confirmToken;
  } else {
    token = String(planDecision.response['confirmToken']);
  }

  const confirmedCall = policyCall(toolId, { ...args, confirm: token });
  const decision = await runPolicyChain(confirmedCall, ctx);
  if (decision.outcome !== 'proceed') {
    throw new Error(`confirm phase did not proceed for ${toolId}: ${JSON.stringify(decision)}`);
  }
  const outcome = await dispatcher.dispatch({
    call: confirmedCall,
    entry: entryFor(toolId),
    ctx,
    confirmed: decision.confirmed,
    ...(reversesCallId === undefined ? {} : { reversesCallId }),
  });
  if (outcome.kind !== 'executed') {
    throw new Error(`dispatch did not execute ${toolId}: ${JSON.stringify(outcome)}`);
  }
  return {
    callId: outcome.auditCallId!,
    response: { ...outcome.response },
    approvalId,
    approverSubject,
  };
}

/**
 * A real `ReversalExecutor` — no private route to the binding, no second token
 * mint. `sink`, when given, collects each run so a test can assert on the
 * approval the reversal leg actually went through; it is observation only and
 * nothing on the execution path reads it.
 */
export function executorOver(
  ctx: PolicyContext,
  dispatcher: WriteDispatcher,
  sink?: WriteRun[],
): ReversalExecutor {
  return {
    async planAndConfirm(input) {
      try {
        const done = await planConfirmExecute(
          ctx,
          dispatcher,
          input.toolId,
          { ...input.args },
          input.reversesCallId,
        );
        sink?.push(done);
        return { ok: true, callId: done.callId, plan: {}, result: done.response };
      } catch (error) {
        return {
          ok: false,
          phase: 'execute',
          code: 'TARGET_ERROR',
          message: error instanceof Error ? error.message : String(error),
          next: 'Establish the state of the original write in the target system before retrying the reversal.',
        };
      }
    },
  };
}
