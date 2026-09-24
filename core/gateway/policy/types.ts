// MCPForge — the policy chain: its inputs, its seams and its verdicts. W0-E3.
// 02 §4.2 step [6], as extended by 02 §11.4.2.
//
// The chain is TEN ordered stages, not eight. 02 §4.2 lists 6a–6h; 02 §11.4.2
// inserts `6a′` (consumer active and within its declared authorizations) after
// `6a` and `6e′` (binding-type authorization) after `6e`. Stage labels are
// primed rather than renumbered so every existing reference stays valid, and
// the whole ten are built now — a chain that grows a stage later is a chain
// whose order was never proved.
//
// TWO PROPERTIES THIS MODULE EXISTS TO MAKE TESTABLE:
//
//  1. **Order is data, not control flow.** The ten stages are a frozen array
//     (./stages.ts) that the runner walks. Nothing branches around a stage and
//     no stage calls another, so "6e′ runs before 6g" is a property of a list a
//     test can read, not of a call graph a test has to infer.
//  2. **A stage can only refuse or continue.** No stage returns a widening
//     verdict, and a stage that throws refuses (./chain.ts). There is no
//     outcome anywhere in this module that admits a call some earlier stage had
//     not already admitted.
//
// WHAT THIS MODULE IS NOT. Stages 6c, 6d, 6f, 6g and 6h are owned by later
// tasks — caps (W0-E6), the generated Ajv validator (W0-B6/B7), guardrails and
// SoD (W0-F4/F5), the plan/confirm state machine (W0-F1/F2) and the idempotency
// dispatch (W0-C3/F3). Each is a SEAM here: a named interface the chain calls,
// with the refusal mapping owned by the stage. That is deliberate. The
// alternative — leaving those stages out until their owning task lands — would
// mean the chain's order is only asserted once every task is done, which is
// precisely the mistake this task exists to avoid.

import type { ErrorCode, Guardrail } from '@mcpforge/shared';
import type { ReversalContract, ResultKeySpec } from '../reversal/types.js';
import type { ScopeCatalogueEntry, ScopeContext, ToolId } from '../scope/index.js';

/**
 * The two entry points a tool id can arrive through. They are named here so the
 * chain can record which one a call used — and for no other reason: 02 §11.4.6
 * requires that `forge.invoke` runs the IDENTICAL chain, so no stage may read
 * this field to decide anything. A test asserts both entry points produce the
 * same verdict for the same call.
 */
export const POLICY_ENTRY_POINTS = ['tools/call', 'forge.invoke'] as const;
export type PolicyEntryPoint = (typeof POLICY_ENTRY_POINTS)[number];

/**
 * The gateway's view of one catalogue entry as the POLICY chain needs it: scope
 * resolution's five fields plus the three the elevated-posture question reads.
 */
export interface PolicyCatalogueEntry extends ScopeCatalogueEntry {
  /**
   * `binding.ref` — the allowlisted target name (02 §2.2). For `plsql` this is
   * the wrapper package a `bindingGrant.names` entry must match; for `function`
   * it is the orchestration. See ./binding-auth/grants.ts for the flagged
   * inference this reuse rests on.
   */
  readonly bindingRef: string;
  /** `governance.policyException` — any tool carrying one is elevated posture (02 §11.4.7). */
  readonly policyException?: string | null;
  /** The tool's own `writeSafety.humanApprovalRequired`, for stage 6g. */
  readonly humanApprovalRequired?: boolean;
  /**
   * The tool's own `writeSafety.guardrails`, verbatim from the manifest, for
   * stage 6f (W0-F4, 02 §3.1.3). The manifest is the sole source: there is no
   * second, gateway-side place a guardrail can be declared, so nothing can be
   * enforced that a reviewer cannot see in the change proposal.
   */
  readonly guardrails?: readonly Guardrail[];
  /**
   * The tool's own `writeSafety.reversal`, verbatim from the manifest (W0-F5,
   * 02 §3.1.4). Additive in exactly the way W0-F4 added `guardrails`, and for
   * the same reason: the manifest is the sole source, so the class and the
   * reversing tool the gateway freezes into the audit row are the ones a
   * reviewer read in the change proposal.
   */
  readonly reversal?: ReversalContract;
  /**
   * The tool's `output.resultKeys` (02 §2.2 — "these ARE the reversal handle").
   * The dispatcher extracts them from the target's result and writes them into
   * the audit row, which is what makes `forge audit reverse` possible at all.
   */
  readonly resultKeys?: readonly ResultKeySpec[];
  readonly toolVersion: string;
}

/** One call, as the chain sees it. */
export interface PolicyCall {
  readonly toolId: ToolId;
  readonly entryPoint: PolicyEntryPoint;
  /** Raw, unvalidated arguments. Stage 6d is what makes them trustworthy. */
  readonly args: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
}

// --- the five seams --------------------------------------------------------

/** 6c — caps and concurrency. SEAM: W0-E6 (`core/gateway/caps/**`). */
export interface RateLimiter {
  check(
    call: PolicyCall,
    ctx: PolicyContext,
  ): { readonly allowed: true } | { readonly allowed: false; readonly reason: string };
}

/** 6d — compiled Ajv from the tool's generated schema. SEAM: W0-B6/B7 codegen. */
export interface ArgumentValidator {
  validate(
    call: PolicyCall,
    entry: PolicyCatalogueEntry,
  ): { readonly valid: true } | { readonly valid: false; readonly errors: string };
}

/**
 * 6f — declared guardrails including SoD. FILLED by W0-F4
 * (`./guardrails/gate.ts`), 02 §3.1.3.
 *
 * The verdict may be a promise, exactly as `WriteGate`'s and
 * `IdempotencyGate`'s are: two of the five guardrail kinds read state outside
 * the call — `rateLimit` counts this caller's executes and `timeWindow` is
 * "evaluated from a precondition read" (02 §3.1.3). A synchronous-only seam
 * would have forced those two reads somewhere other than the stage that owns
 * them.
 */
export type GuardrailVerdict =
  | { readonly breached: false }
  | { readonly breached: true; readonly message: string; readonly next?: string };

export interface GuardrailEvaluator {
  evaluate(
    call: PolicyCall,
    entry: PolicyCatalogueEntry,
    ctx: PolicyContext,
  ): GuardrailVerdict | Promise<GuardrailVerdict>;
}

/**
 * 6g — the plan/confirm state machine. SEAM: W0-F1/F2
 * (`core/gateway/policy/confirm/**`).
 *
 * The four verdicts are exactly the states 02 §3.1.1 describes, and the shape
 * matches what W0-B7's generated handlers already assume: a plan mints a token
 * bound to `argsCanonicalHash` (sha256 over the arguments EXCLUDING `confirm`),
 * and an execute presents that token with identical business arguments.
 */
export type WriteGateVerdict =
  /** Not a write tool — 6g has nothing to say. */
  | { readonly kind: 'not-a-write' }
  /** A plan was produced (or a human approval is pending): respond, do not execute. */
  | { readonly kind: 'respond'; readonly response: Readonly<Record<string, unknown>> }
  /**
   * A valid confirm token was presented and VERIFIED. Proceed to 6h.
   *
   * "Consumed" is deliberately not the word: 6g verifies the signature, the
   * binding and the TTL, and W0-F3 spends the nonce inside the execute
   * transaction (02 §3.1.1). The `nonce` and `tokenExpiresAt` travel with the
   * verdict for exactly that reason — the executor must not re-parse a token to
   * learn them, because a second parser is a second place the binding rules can
   * drift.
   */
  | {
      readonly kind: 'confirmed';
      readonly argsCanonicalHash: string;
      readonly confirmToken: string;
      /** The verified payload's `nonce` — what W0-F3's `confirm_nonce` INSERT spends. */
      readonly nonce: string;
      /** The token's own `exp`, as ISO-8601. Spent nonces are swept only after it. */
      readonly tokenExpiresAt: string;
    }
  /** Refused, with the code 02 §4.2 assigns to this stage. */
  | {
      readonly kind: 'refuse';
      readonly code:
        'PLAN_REQUIRED' | 'PLAN_EXPIRED' | 'PLAN_ARGUMENT_MISMATCH' | 'APPROVAL_REQUIRED';
      readonly message: string;
      readonly next?: string;
    };

export interface WriteGate {
  evaluate(
    call: PolicyCall,
    entry: PolicyCatalogueEntry,
    ctx: PolicyContext,
  ): Promise<WriteGateVerdict> | WriteGateVerdict;
}

/**
 * 6h — the idempotency lookup. SEAM: W0-C3's `idempotency` repository, filled
 * by W0-F3 (`./idempotency/gate.ts`).
 *
 * **The decision W0-C3 left open, taken by W0-F3:** the record is CLAIMED and
 * COMMITTED before the execute transaction opens (`./idempotency/dispatch.ts`
 * documents why). This stage therefore does a read-only lookup — it answers
 * "has this exact call already reached an outcome inside its window?" — and the
 * claim itself belongs to the dispatcher, where the binding invocation it
 * guards actually happens. A stage that claimed but did not execute would leave
 * a `pending` record behind on every plan-shaped call that never dispatches.
 *
 * The third verdict is a refusal: a record that is still `pending` from a
 * previous attempt means an identical call may be in flight or may have died
 * mid-binding, and the honest answer is neither "proceed" (a possible duplicate)
 * nor "replay" (there is no result yet).
 */
export type IdempotencyVerdict =
  | { readonly kind: 'proceed' }
  | { readonly kind: 'replay'; readonly previousResult: unknown }
  | {
      readonly kind: 'refuse';
      readonly code: ErrorCode;
      readonly message: string;
      readonly next: string;
    };

export interface IdempotencyGate {
  lookup(
    call: PolicyCall,
    entry: PolicyCatalogueEntry,
    ctx: PolicyContext,
    confirmed: ConfirmedCall | null,
  ): Promise<IdempotencyVerdict> | IdempotencyVerdict;
}

/**
 * What stage 6g verified and stages after it may rely on. One shape, named
 * once: the chain state, the 6h seam and W0-F3's dispatcher all read it, and a
 * second definition is a second thing to keep in step.
 */
export interface ConfirmedCall {
  readonly argsCanonicalHash: string;
  readonly confirmToken: string;
  readonly nonce: string;
  readonly tokenExpiresAt: string;
}

/** The five seams, assembled once per gateway. */
export interface PolicyRuntime {
  readonly rateLimiter: RateLimiter;
  readonly argumentValidator: ArgumentValidator;
  readonly guardrails: GuardrailEvaluator;
  readonly writeGate: WriteGate;
  readonly idempotency: IdempotencyGate;
}

/**
 * A role, as the policy chain reads it — the fields 02 §4.3 puts on a role that
 * are NOT visibility, and which W0-E2 deliberately left to this task:
 * `sensitivityCeiling` and `writeAllowed` (stage 6e) and `bindingGrants`
 * (stage 6e′).
 */
export interface PolicyRoleView {
  readonly roleId: string;
  readonly sensitivityCeiling: string;
  readonly writeAllowed: boolean;
  readonly bindingGrants: readonly CompiledBindingGrant[];
}

/**
 * One compiled `bindingGrant`, shaped exactly as W0-B8 writes it into
 * `generated/roles/<id>.scope.json` and
 * `generated/consumers/<id>.authorization.json` (codegen `compileGrant`).
 *
 * `expired` is computed at COMPILE time and is authoritative when true; the
 * gateway re-checks `expiresAt` against the call's own clock as well, because a
 * process that has been running since before an expiry must not keep honouring
 * a grant the artefact was compiled with (02 §11.4 — grants expire; renewal is
 * a re-approval).
 */
export interface CompiledBindingGrant {
  readonly bindingType: string;
  readonly names: readonly string[];
  readonly approvalRef: string;
  readonly approver: string;
  readonly expiresAt: string;
  readonly expired?: boolean;
  /**
   * [W0-N4] The RESOLVED standing authorization, as codegen's
   * `compile/standing.ts` writes it — the approval record's named approver, its
   * own expiry and whether it resolved at all. It is an object rather than the
   * bare ref it is authored as, because a ref this process cannot resolve is
   * not a recorded decision (02 §11.4.4).
   *
   * `string` is accepted in the TYPE only so a stale pre-W0-N4 artefact still
   * parses; `binding-auth/standing.ts` REFUSES that form and falls back to a
   * per-call human approval.
   */
  readonly standingAuthorization?: CompiledStandingAuthorization | string;
}

/**
 * [W0-N4] One `standingAuthorization`, resolved against `approvals/` at compile
 * time. `status` is codegen's closed set — 'active' | 'unresolved' |
 * 'no-approver' | 'no-expiry' | 'not-approved' | 'expired' — but is typed as a
 * string here deliberately: the gateway must treat a status it does not
 * recognise as NOT in force, and a narrow union would invite a cast rather than
 * a check.
 */
export interface CompiledStandingAuthorization {
  readonly ref: string;
  readonly status: string;
  readonly approver: string;
  /** The approval RECORD's own expiry, distinct from the grant's `expiresAt`. */
  readonly expiresAt: string;
  readonly effective: boolean;
}

/** Everything the ten stages read. */
export interface PolicyContext {
  /** The scope context, verbatim — stage 6a re-resolves from it at call time. */
  readonly scope: ScopeContext;
  readonly catalogue: readonly PolicyCatalogueEntry[];
  /** roleId → the role's non-visibility grants (02 §4.3). */
  readonly roles: ReadonlyMap<string, PolicyRoleView>;
  /** The consumer's own compiled `bindingGrants`, if its record declares any. */
  readonly consumerBindingGrants: readonly CompiledBindingGrant[];
  readonly runtime: PolicyRuntime;
}

// --- stage verdicts --------------------------------------------------------

export const POLICY_STAGE_IDS = [
  '6a',
  '6a′',
  '6b',
  '6c',
  '6d',
  '6e',
  '6e′',
  '6f',
  '6g',
  '6h',
] as const;
export type PolicyStageId = (typeof POLICY_STAGE_IDS)[number];

export interface StageRefusal {
  readonly kind: 'refuse';
  readonly code: ErrorCode;
  readonly message: string;
  readonly condition: string;
  /** Non-empty and agent-actionable. `forgeError` throws on an empty one. */
  readonly next: string;
}

/** A terminal, NON-error response: a minted plan, an approval hand-off, a replay. */
export interface StageRespond {
  readonly kind: 'respond';
  readonly response: Readonly<Record<string, unknown>>;
}

export type StageOutcome = { readonly kind: 'continue' } | StageRefusal | StageRespond;

export const CONTINUE: StageOutcome = Object.freeze({ kind: 'continue' as const });

/**
 * One stage. It reads the call and the context and answers ONLY its own
 * question — no stage consults another, and no stage may widen what an earlier
 * one narrowed.
 *
 * `state` is the small amount of information a stage may hand to a later stage
 * (today: 6g's confirmed token, which 6h needs). It is deliberately not the
 * context: a stage cannot mutate what the stages after it read.
 */
export interface PolicyStage {
  readonly id: PolicyStageId;
  readonly name: string;
  evaluate(
    call: PolicyCall,
    ctx: PolicyContext,
    state: PolicyChainState,
  ): StageOutcome | Promise<StageOutcome>;
}

/** Carried forward between stages. Every field is written by exactly one stage. */
export interface PolicyChainState {
  /** Written by 6a; every later stage reads the entry from here. */
  entry?: PolicyCatalogueEntry;
  /**
   * Written by 6e′ (W0-N3) when the elevated posture OVERRIDES the tool's own
   * `humanApprovalRequired` to true — an elevated write whose authorizing grant
   * carries no `standingAuthorization` (02 §11.4). Read by 6g, which is the
   * only stage that may act on it.
   *
   * It is a one-way narrowing: absent or `false` means 6e′ said nothing, and
   * the tool's own flag still governs. Nothing anywhere sets it to `false` to
   * turn an approval off.
   */
  forcedHumanApproval?: boolean;
  /** Written by 6e′ — the approval ref that substituted for a per-call approval, if any. */
  standingAuthorization?: string;
  /** Written by 6g when a confirm token was verified. Read by 6h and by the executor. */
  confirmed?: ConfirmedCall;
}
