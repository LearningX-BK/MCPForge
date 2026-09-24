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
// DISCLOSED WORKAROUND, scoped to this file. There is no committed
// generated-test harness or gateway composition root yet that turns
// `generated/tools/**` into a `PolicyCatalogueEntry` — that is `W0-B10`, which is
// not dispatched, and W0-F8 is explicitly forbidden from doing its work. So the
// two builders below (`catalogueEntryFor`, `writeSafetyViewFor`) do that mapping
// here, for these two tools, using codegen's OWN `readTool` rather than a second
// hand-rolled parser. When W0-B10 lands its resolver this file should call it and
// delete both builders. Flagged in W0-F8's report, not buried here.
//
// STILL NOT REAL, and named honestly: stage 6e's argument validator is still the
// fixture's always-valid stub (the compiled-Ajv wiring is W0-B10's), and the
// target system is a mock. Everything else on the path — 6a…6h — is the shipped
// code.
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
import {
  BINDING_TYPES,
  SENSITIVITIES,
  type BindingType,
  type Guardrail,
  type Sensitivity,
} from '@mcpforge/shared';
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
import { reversalRegistry } from '../../../core/gateway/reversal/registry.js';
import type { ReversalContract, ReversalExecutor } from '../../../core/gateway/reversal/types.js';
import { loadManifestFile } from '../../../core/codegen/src/validate/loader.js';
import { readTool, type ToolView } from '../../../core/codegen/src/templates/manifest-view.js';
import { toolRegistration as CREATE_REGISTRATION } from '../../../generated/tools/jde.ap.voucher.create/tool.js';
import { toolRegistration as CANCEL_REGISTRATION } from '../../../generated/tools/jde.ap.voucher.cancel/tool.js';

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

// --- the real manifests, read with codegen's own reader ----------------------

function manifestView(relPath: string): ToolView {
  const file = loadManifestFile(REPO_ROOT, join(REPO_ROOT, relPath));
  if (file.doc === undefined) {
    throw new Error(`W0-F8: ${relPath} could not be parsed: ${file.parseError ?? 'unknown error'}`);
  }
  return readTool(file.doc);
}

export const CREATE_VIEW = manifestView('manifests/jde/fin/ap/voucher.create.tool.yaml');
export const CANCEL_VIEW = manifestView('manifests/jde/fin/ap/voucher.cancel.tool.yaml');

/**
 * The generated registration is what the gateway is actually served. If it has
 * drifted from the manifest this world reads, every fact below is suspect, so
 * this throws at module load rather than letting a suite report a green tick
 * over a stale artefact.
 */
function assertGeneratedAgrees(
  view: ToolView,
  registration: typeof CREATE_REGISTRATION | typeof CANCEL_REGISTRATION,
): void {
  const ws = view.writeSafety;
  if (ws === null) throw new Error(`W0-F8: ${view.id} declares no writeSafety block`);
  const mismatches: string[] = [];
  const check = (field: string, fromManifest: unknown, fromGenerated: unknown): void => {
    if (JSON.stringify(fromManifest) !== JSON.stringify(fromGenerated)) {
      mismatches.push(
        `${field}: manifest=${JSON.stringify(fromManifest)} generated=${JSON.stringify(fromGenerated)}`,
      );
    }
  };
  check('id', view.id, registration.id);
  check('version', view.version, registration.version);
  check('write', view.write, registration.write);
  check('sensitivity', view.sensitivity, registration.sensitivity);
  check('binding.type', view.bindingType, registration.binding.type);
  check('binding.ref', view.bindingRef, registration.binding.ref);
  check(
    'writeSafety.humanApprovalRequired',
    ws.humanApprovalRequired,
    registration.writeSafety.humanApprovalRequired,
  );
  check('writeSafety.reversal.class', ws.reversalClass, registration.writeSafety.reversalClass);
  check('writeSafety.reversal.tool', ws.reversalTool, registration.writeSafety.reversalTool);
  check('writeSafety.dryRun.strategy', ws.dryRunStrategy, registration.writeSafety.dryRunStrategy);
  check(
    'writeSafety.idempotency.scopeHours',
    ws.idempotencyScopeHours,
    registration.writeSafety.idempotencyScopeHours,
  );
  check('writeSafety.guardrails', ws.guardrails, registration.writeSafety.guardrails);
  if (mismatches.length > 0) {
    throw new Error(
      `W0-F8: generated/tools/${view.id}/tool.ts has drifted from its manifest — ${mismatches.join('; ')}. Run forge codegen.`,
    );
  }
}

assertGeneratedAgrees(CREATE_VIEW, CREATE_REGISTRATION);
assertGeneratedAgrees(CANCEL_VIEW, CANCEL_REGISTRATION);

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

// --- manifest -> the two runtime views ---------------------------------------
//
// The mapping W0-B10's resolver will own. Nothing invents a value: every field
// is read off the manifest view above.

function reversalContractFor(view: ToolView): ReversalContract {
  const ws = view.writeSafety!;
  const argMap = ws.reversalArgMap;
  return {
    class: ws.reversalClass as ReversalContract['class'],
    ...(ws.reversalTool === null ? {} : { tool: ws.reversalTool }),
    ...(Object.keys(argMap).length === 0 ? {} : { argMap }),
  };
}

function writeSafetyViewFor(view: ToolView): WriteSafetyView {
  const ws = view.writeSafety!;
  return {
    toolId: view.id,
    toolVersion: view.version,
    planTemplate: ws.planTemplate ?? '',
    tokenTtlSeconds: ws.confirmTokenTtlSeconds ?? 300,
    humanApprovalRequired: ws.humanApprovalRequired,
    reversal: reversalContractFor(view),
    dryRunStrategy: ws.dryRunStrategy ?? 'none',
    entity: view.entity,
    verb: view.verb,
  };
}

/**
 * `readTool` answers with plain strings (it reads an untyped YAML document);
 * the catalogue's own types are the closed lists. These narrow by CHECKING, so a
 * manifest carrying a binding type or sensitivity the gateway does not know
 * fails loudly here rather than being cast into the catalogue.
 */
function asBindingType(value: string, toolId: string): BindingType {
  if (!(BINDING_TYPES as readonly string[]).includes(value)) {
    throw new Error(`W0-F8: ${toolId} declares an unknown binding type ${value}`);
  }
  return value as BindingType;
}

function asSensitivity(value: string, toolId: string): Sensitivity {
  if (!(SENSITIVITIES as readonly string[]).includes(value)) {
    throw new Error(`W0-F8: ${toolId} declares an unknown sensitivity ${value}`);
  }
  return value as Sensitivity;
}

function catalogueEntryFor(view: ToolView): PolicyCatalogueEntry {
  const ws = view.writeSafety!;
  return {
    toolId: view.id,
    serverId: view.server,
    bindingType: asBindingType(view.bindingType, view.id),
    sensitivity: asSensitivity(view.sensitivity, view.id),
    write: view.write,
    toolVersion: view.version,
    bindingRef: view.bindingRef,
    policyException: view.policyException,
    humanApprovalRequired: ws.humanApprovalRequired,
    guardrails: ws.guardrails as readonly Guardrail[],
    reversal: reversalContractFor(view),
    resultKeys: view.resultKeys,
  };
}

export const VOUCHER_CREATE: WriteSafetyView = writeSafetyViewFor(CREATE_VIEW);
export const VOUCHER_CANCEL: WriteSafetyView = writeSafetyViewFor(CANCEL_VIEW);

export const CREATE_REVERSAL: ReversalContract = reversalContractFor(CREATE_VIEW);
export const CANCEL_REVERSAL: ReversalContract = reversalContractFor(CANCEL_VIEW);

const ENTRIES: Readonly<Record<string, PolicyCatalogueEntry>> = {
  [TOOLS.voucherCreate]: catalogueEntryFor(CREATE_VIEW),
  [TOOLS.voucherCancel]: catalogueEntryFor(CANCEL_VIEW),
};

/** The catalogue entry the chain resolves — the real one, not a fixture. */
export function entryFor(toolId: string): PolicyCatalogueEntry {
  const found = ENTRIES[toolId];
  if (found === undefined) throw new Error(`no real catalogue entry for ${toolId}`);
  return found;
}

const CATALOGUE: readonly PolicyCatalogueEntry[] = Object.values(ENTRIES);

const WRITE_SAFETY: Readonly<Record<string, WriteSafetyView>> = {
  [TOOLS.voucherCreate]: VOUCHER_CREATE,
  [TOOLS.voucherCancel]: VOUCHER_CANCEL,
};

export const DRY_RUN: DryRunner = { plan: () => ({ warnings: [], planValues: {} }) };

export const REGISTRY = reversalRegistry({
  [TOOLS.voucherCreate]: CREATE_REVERSAL,
  [TOOLS.voucherCancel]: CANCEL_REVERSAL,
});

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
    catalogue: CATALOGUE,
    runtime: {
      // THE REAL EVALUATOR (W0-F8). Previously a stub that answered
      // `{breached:false}` for everything, which is what let a tool that
      // refused every call at 6f look reachable.
      guardrails: guardrailEvaluator({ now: () => NOW }),
      writeGate: confirmWriteGate({
        writeSafetyFor: (toolId) => WRITE_SAFETY[toolId],
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
