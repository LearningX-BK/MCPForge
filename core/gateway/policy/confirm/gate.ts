// MCPForge — the plan/execute state machine. W0-F1, 02 §3.1.1, 03 §7.1.
//
// This is the implementation of stage 6g's `WriteGate` seam (../types.ts). It
// is the ONLY plan/confirm mechanism in the codebase: nothing here runs beside
// stage 6g, and no second entry point exists. `forge.invoke` and `tools/call`
// both walk the same chain, so both reach this same object (02 §11.4.6).
//
// THE STATE MACHINE, in the vocabulary of 03 §7.1:
//
//   not a write tool                     -> not-a-write   (6g has nothing to say)
//   write, `confirm` absent or null      -> PLANNING -> PLAN_READY
//                                           dry run, mint a token, RESPOND.
//                                           **No change is made to the target.**
//   write, `humanApprovalRequired`       -> AWAITING_APPROVAL
//                                           the plan is produced and an approval
//                                           request is RAISED (W0-F6,
//                                           ../approval/). **No token is minted
//                                           until a named approver approves.**
//   write, `confirm` present             -> verify, then EXECUTING
//                                           bad signature / wrong caller / wrong
//                                           tool / wrong args -> refuse.
//
// WHY THE PLAN BRANCH CANNOT MUTATE ANYTHING. The plan branch calls exactly one
// outward function, `deps.dryRun.plan(...)`, and returns. It has no reference to
// an execute path, and stage 6g's `respond` verdict terminates the chain in
// ../../policy/chain.ts, so the binding executor at step [7] is never reached.
// ./confirm.test.ts proves it the way W0-F1's `done:` clause demands — with
// a mock target that records every call it receives and is asserted to have
// received no mutating one.
//
// FOUR THINGS THIS TASK DELIBERATELY DOES NOT DO, each with its owner:
//
//  1. **Single-use enforcement (W0-F3).** The token carries a `nonce` and the
//     gate hands it forward, but the `confirm_nonce` INSERT must run inside the
//     execute transaction (W0-C3) and stage 6g runs before the executor. Nothing
//     here claims a token has not already been spent.
//  2. **The canonical hash's hardening (W0-F2).** ./hash.ts is minimal-but-
//     correct and sits in W0-F2's own declared file path.
//  3. **The human-approval queue (W0-F6, now landed).** `humanApprovalRequired:
//     true` delegates to `../approval/`, which raises the request, records the
//     decision and mints the token — for the REQUESTER — only on approval. With
//     no queue configured the branch still refuses fail-closed.
//  4. **Guardrails at execute (W0-F4).** Stage 6f runs before 6g on both the
//     plan call and the execute call, because both are ordinary calls through
//     the whole chain. That is what makes "evaluated at plan AND at execute"
//     true without this file doing anything.

import { randomUUID } from 'node:crypto';
import type { ReversalClass } from '@mcpforge/shared';
import type {
  PolicyCall,
  PolicyCatalogueEntry,
  PolicyContext,
  WriteGate,
  WriteGateVerdict,
} from '../types.js';
import {
  CONFIRM_FIELD,
  argsCanonicalHash,
  argumentWitness,
  businessArgs,
  planCanonicalHash,
} from './hash.js';
import {
  buildPlanBody,
  declaredEffect,
  type DryRunOutcome,
  type PlanEffect,
  type PlanReversal,
} from './plan.js';
import type { ApprovalGate } from '../approval/types.js';
import {
  DEFAULT_CONFIRM_TTL_SECONDS,
  mintConfirmToken,
  verifyConfirmToken,
  type ConfirmKeyring,
} from './token.js';

/**
 * What the gate needs to know about a write tool. Every field comes from the
 * tool's own manifest `writeSafety` block (02 §2.2) — this view invents no
 * field the schema does not already declare, so W0-F5 and W0-F6 read the same
 * source rather than a parallel one.
 */
export interface WriteSafetyView {
  readonly toolId: string;
  readonly toolVersion: string;
  /** `writeSafety.confirm.planTemplate`. */
  readonly planTemplate: string;
  /** `writeSafety.confirm.tokenTtlSeconds`. */
  readonly tokenTtlSeconds: number;
  /** `writeSafety.humanApprovalRequired`. */
  readonly humanApprovalRequired: boolean;
  /** `writeSafety.reversal`. */
  readonly reversal: {
    readonly class: ReversalClass;
    readonly tool?: string;
    readonly windowHours?: number;
    readonly preconditions?: string;
  };
  /** `writeSafety.dryRun.strategy` — never `none` on a write tool (CLAUDE.md #4). */
  readonly dryRunStrategy: string;
  /** For the default effect line. */
  readonly entity: string;
  readonly verb: string;
}

/**
 * The dry run. SEAM: W0-H2 owns the binding-type dispatch and the degradation
 * ladder; the mock target implements this in tests. **An implementation of this
 * interface must not mutate the target** — that is the contract, stated here
 * and enforced by the strategy check in `planVerdict`.
 */
export interface DryRunner {
  plan(input: {
    readonly call: PolicyCall;
    readonly entry: PolicyCatalogueEntry;
    readonly writeSafety: WriteSafetyView;
    readonly businessArgs: Readonly<Record<string, unknown>>;
  }): Promise<DryRunOutcome> | DryRunOutcome;
}

export interface ConfirmGateDeps {
  /** toolId → its write-safety view, or `undefined` for a tool with none. */
  writeSafetyFor(toolId: string): WriteSafetyView | undefined;
  readonly dryRun: DryRunner;
  readonly keyring: ConfirmKeyring;
  /**
   * W0-F6's human-approval gate (`../approval/`). Present, the
   * `humanApprovalRequired` branch raises a request and answers
   * `awaiting_human_approval`; absent, that branch refuses fail-closed. It is
   * OPTIONAL for exactly one reason: a gateway with no queue must still refuse
   * safely rather than fail to start and take the read tools down with it.
   */
  readonly approval?: ApprovalGate;
  /** Injected so tests pin expiry. Defaults to `ctx.scope.now`. */
  now?(): Date;
  /** Injected so the plan hash is reproducible in tests. */
  nonce?(): string;
}

function ttlSeconds(view: WriteSafetyView): number {
  const declared = view.tokenTtlSeconds;
  return Number.isFinite(declared) && declared > 0 ? declared : DEFAULT_CONFIRM_TTL_SECONDS;
}

function reversalOf(view: WriteSafetyView): PlanReversal {
  const out: {
    class: ReversalClass;
    tool?: string;
    windowHours?: number;
    preconditions?: string;
  } = { class: view.reversal.class };
  if (view.reversal.tool !== undefined) out.tool = view.reversal.tool;
  if (view.reversal.windowHours !== undefined) out.windowHours = view.reversal.windowHours;
  if (view.reversal.preconditions !== undefined) out.preconditions = view.reversal.preconditions;
  return out;
}

function defaultEffectOf(entry: PolicyCatalogueEntry, view: WriteSafetyView): PlanEffect {
  return declaredEffect({
    serverId: entry.serverId,
    entity: view.entity,
    verb: view.verb,
    reversalClass: view.reversal.class,
  });
}

/**
 * Build the gate. The returned object is what a composition root passes as
 * `PolicyRuntime.writeGate`.
 */
export function confirmWriteGate(deps: ConfirmGateDeps): WriteGate {
  const nonce = deps.nonce ?? ((): string => randomUUID());

  /**
   * The dry run and the plan body — the half of the plan phase that is common
   * to the ordinary path and the human-approval path. Factored out so the two
   * cannot drift about what the human reads: 03 §7.4 requires the approver to
   * see "the same blocks as the plan card, because an approver needs everything
   * the requester saw and nothing less", and the only way to guarantee that is
   * for one function to produce both.
   *
   * It returns a refusal instead of a body when the tool's dry-run strategy is
   * missing — CLAUDE.md #4 forbids a write tool without one, so reaching that
   * means the runtime view disagrees with the manifest that produced it.
   */
  async function planBodyFor(
    call: PolicyCall,
    entry: PolicyCatalogueEntry,
    view: WriteSafetyView,
  ): Promise<
    | { readonly ok: true; readonly body: ReturnType<typeof buildPlanBody> }
    | { readonly ok: false; readonly verdict: WriteGateVerdict }
  > {
    if (view.dryRunStrategy === 'none' || view.dryRunStrategy.trim().length === 0) {
      return {
        ok: false,
        verdict: {
          kind: 'refuse',
          code: 'PLAN_REQUIRED',
          message: `${call.toolId} is a write tool whose dry-run strategy is missing, so no plan can be produced and no execution may proceed.`,
          next: `Do not retry ${call.toolId}. Tell the human this tool's write-safety configuration is incomplete and ask the MCPForge operator to re-run forge validate on its manifest.`,
        },
      };
    }

    const business = businessArgs(call.args);
    const outcome = await deps.dryRun.plan({
      call,
      entry,
      writeSafety: view,
      businessArgs: business,
    });

    return {
      ok: true,
      body: buildPlanBody({
        template: view.planTemplate,
        args: business,
        dryRun: outcome,
        defaultEffect: defaultEffectOf(entry, view),
        reversal: reversalOf(view),
      }),
    };
  }

  /**
   * The `awaiting_human_approval` fork (02 §3.1.1, W0-F6). **Nothing on this
   * path can mint a token**: it calls `deps.approval.raise`, whose return type
   * (../approval/types.ts `RaiseOutcome`) has no token field in any variant.
   *
   * With no approval gate configured, the answer is the fail-closed refusal
   * W0-F1 wrote — a gateway that cannot record an approval must not proceed as
   * though one happened.
   */
  async function awaitingApproval(
    call: PolicyCall,
    entry: PolicyCatalogueEntry,
    view: WriteSafetyView,
    callerSubject: string,
    ctx: PolicyContext,
  ): Promise<WriteGateVerdict> {
    if (deps.approval === undefined) {
      return {
        kind: 'refuse',
        code: 'APPROVAL_REQUIRED',
        message: `${view.toolId} requires a named human approver before a confirm token may be minted, and this gateway has no approval queue configured to record one.`,
        next: `Do not retry ${view.toolId}. Ask the MCPForge operator to configure the approval queue; until then this tool cannot be executed by anyone, which is the intended failure.`,
      };
    }

    const built = await planBodyFor(call, entry, view);
    if (!built.ok) return built.verdict;

    const raised = await deps.approval.raise({
      toolId: view.toolId,
      toolVersion: view.toolVersion,
      callerSubject,
      consumerId: ctx.scope.session.consumer.consumerId,
      // The SAME hashes the confirm token binds (W0-F2). The approval record
      // captures the exact plan hash approved, and it is this family of hash
      // and no second scheme.
      argsCanonicalHash: argsCanonicalHash(call.args),
      planHash: planCanonicalHash(built.body),
      planSummary: built.body.plan,
      tokenTtlSeconds: ttlSeconds(view),
    });

    return {
      kind: 'respond',
      response: {
        ...built.body,
        // Overrides the body's `confirm_required`: this plan is NOT confirmable
        // yet, and an agent that read only `status` must not think it is.
        status: 'awaiting_human_approval',
        approvalId: raised.approvalId,
        approvalUrl: raised.approvalUrl,
        expiresAt: raised.expiresAt,
        next: raised.next,
      },
    };
  }

  async function planVerdict(
    call: PolicyCall,
    entry: PolicyCatalogueEntry,
    view: WriteSafetyView,
    now: Date,
    callerSubject: string,
  ): Promise<WriteGateVerdict> {
    const built = await planBodyFor(call, entry, view);
    if (!built.ok) return built.verdict;
    const body = built.body;

    const expiresAtMs = now.getTime() + ttlSeconds(view) * 1000;
    const token = mintConfirmToken(
      {
        callerSubject,
        toolId: view.toolId,
        toolVersion: view.toolVersion,
        argsCanonicalHash: argsCanonicalHash(call.args),
        planHash: planCanonicalHash(body),
        nonce: nonce(),
        exp: Math.floor(expiresAtMs / 1000),
      },
      deps.keyring,
      // The witness is minted under the SAME key that signs the token, so a
      // rotation carries both halves together: an in-flight token verified with
      // an overlap-window key still names its changed fields correctly.
      argumentWitness(call.args, deps.keyring.active.key),
    );

    return {
      kind: 'respond',
      response: {
        ...body,
        confirmToken: token,
        expiresAt: new Date(expiresAtMs).toISOString(),
        next: `Show the plan to the human. If approved, call ${view.toolId} again with identical arguments plus confirm=<confirmToken>. The token expires at the stated time and is bound to these exact arguments.`,
      },
    };
  }

  // NOTE: this object holds no per-call mutable state. Every value a verdict
  // depends on is a parameter, so two concurrent `evaluate` calls interleaving
  // across an `await` cannot see each other's caller, tool or arguments. A
  // gateway-wide singleton that remembered "the current subject" between awaits
  // is exactly how one caller's token gets minted for another.
  return {
    async evaluate(
      call: PolicyCall,
      entry: PolicyCatalogueEntry,
      ctx: PolicyContext,
    ): Promise<WriteGateVerdict> {
      // A read tool has nothing to confirm. `entry.write` is the catalogue's
      // own flag, checked BEFORE the view lookup so a read tool can never be
      // dragged into the write path by a stray view.
      if (!entry.write) return { kind: 'not-a-write' };

      const view = deps.writeSafetyFor(call.toolId);
      if (view === undefined) {
        // A write tool with no write-safety view is a configuration failure, and
        // the fail-closed answer is a refusal — never an execution.
        return {
          kind: 'refuse',
          code: 'PLAN_REQUIRED',
          message: `${call.toolId} is marked write: true but the gateway holds no writeSafety block for it, so it cannot be planned or executed.`,
          next: `Do not retry ${call.toolId}. Ask the MCPForge operator to check that its manifest declares a complete writeSafety block and that the deployment's catalogue was regenerated.`,
        };
      }

      const now = deps.now?.() ?? ctx.scope.now;
      const callerSubject = ctx.scope.session.principal.subject;

      const presented = call.args[CONFIRM_FIELD];
      const isPlan = presented === undefined || presented === null;

      if (isPlan) {
        // Read from BOTH sources and take the union: the catalogue entry and
        // the write-safety view are compiled from the same manifest, and if
        // they ever disagree the fail-closed reading is "approval is required".
        if (view.humanApprovalRequired || entry.humanApprovalRequired === true) {
          // 02 §3.1.1: "No `confirmToken` is minted until a human approves."
          // W0-F6 fills this branch. The plan is still produced — the approver
          // must read the same plan the requester saw (03 §7.4) — but the ONLY
          // outward call it makes is the dry run, and `awaitingApproval` below
          // has no access to `mintConfirmToken`. See ./confirm.test.ts and
          // ../approval/approval.test.ts: no token is minted on this path.
          return awaitingApproval(call, entry, view, callerSubject, ctx);
        }
        return planVerdict(call, entry, view, now, callerSubject);
      }

      if (typeof presented !== 'string' || presented.length === 0) {
        return {
          kind: 'refuse',
          code: 'PLAN_REQUIRED',
          message: `The confirm argument on ${view.toolId} must be the confirmToken string returned by a plan call.`,
          next: `Call ${view.toolId} again without confirm to obtain the plan and its confirmToken, show the plan to the human, then call again with identical arguments plus that token.`,
        };
      }

      const verification = verifyConfirmToken(
        presented,
        {
          callerSubject,
          toolId: view.toolId,
          toolVersion: view.toolVersion,
          argsCanonicalHash: argsCanonicalHash(call.args),
          // Supplied so a mismatch can NAME the fields that changed (02 §3.1.1).
          args: call.args,
        },
        deps.keyring,
        now,
      );

      if (verification.ok) {
        return {
          kind: 'confirmed',
          argsCanonicalHash: verification.payload.argsCanonicalHash,
          confirmToken: presented,
          // Handed forward, not spent here (see note 1 above): W0-F3's executor
          // performs the `confirm_nonce` INSERT inside the execute transaction.
          nonce: verification.nonce,
          tokenExpiresAt: new Date(verification.payload.exp * 1000).toISOString(),
        };
      }

      switch (verification.failure) {
        case 'expired':
          return {
            kind: 'refuse',
            code: 'PLAN_EXPIRED',
            message: `The confirm token for ${view.toolId} expired before it was presented.`,
            next: `Call ${view.toolId} again without confirm for a fresh plan, re-show that plan to the human, and confirm it within ${ttlSeconds(view)} seconds.`,
          };
        case 'not-bound-to-this-call':
          return {
            kind: 'refuse',
            code: 'PLAN_ARGUMENT_MISMATCH',
            message: mismatchMessage(
              view.toolId,
              verification.mismatchedField,
              verification.changedArguments,
            ),
            next: nextForMismatch(view.toolId, verification.changedArguments),
          };
        case 'malformed':
        case 'bad-signature':
        default:
          return {
            kind: 'refuse',
            code: 'PLAN_ARGUMENT_MISMATCH',
            message: `The confirm value presented to ${view.toolId} is not a confirm token this gateway minted.`,
            next: `Call ${view.toolId} again without confirm to obtain a valid confirmToken from the plan response, and pass that value back unchanged.`,
          };
      }
    },
  };
}

/** `["amount"]` → `amount`; `["amount","currency"]` → `amount, currency`. */
function nameList(fields: readonly string[]): string {
  return fields.join(', ');
}

/**
 * 02 §3.1.1: the refusal names the fields that changed. Naming them is the whole
 * point — "this is the argument that is different from the one the human read"
 * is what makes the refusal actionable, and non-negotiable #5 forbids the
 * alternative. Field NAMES only: the changed VALUE is never echoed, because the
 * agent that presented it already has it and the log line that carries this
 * message must not become a place business values leak.
 */
function mismatchMessage(
  toolId: string,
  field: string | undefined,
  changed: readonly string[] | undefined,
): string {
  switch (field) {
    case 'argsCanonicalHash':
      return changed !== undefined && changed.length > 0
        ? `${nameList(changed)} ${changed.length === 1 ? 'is' : 'are'} not what the human approved: ${changed.length === 1 ? 'that argument' : 'those arguments'} changed after the plan for ${toolId} was shown, so this confirm token does not authorise this call.`
        : `The arguments presented to ${toolId} are not the arguments the human approved in the plan this token was minted for.`;
    case 'callerSubject':
      return `This confirm token was minted for a different caller and is not valid for ${toolId} in this session.`;
    case 'toolVersion':
      return `This confirm token was minted against a different version of ${toolId}.`;
    case 'toolId':
      return `This confirm token was minted for a different tool and is not valid for ${toolId}.`;
    default:
      return `This confirm token is not bound to this call of ${toolId}.`;
  }
}

function nextForMismatch(toolId: string, changed: readonly string[] | undefined): string {
  const named =
    changed !== undefined && changed.length > 0
      ? ` Either restore ${nameList(changed)} to the planned value and present this token again, or`
      : ' Either present the arguments this token was minted for, or';
  return `Do not retry ${toolId} with this token and these arguments.${named} call ${toolId} again without confirm to produce a plan for the arguments you actually intend, show THAT plan to the human, and confirm it. Never reuse a token minted for a different call.`;
}
