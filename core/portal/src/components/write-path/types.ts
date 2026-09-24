// MCPForge — W0-J7: the prop shapes for the Plan Review card family (03 §7.2).
//
// Judgment call (documented once, for the whole family): no gateway/API client
// exists in the portal at Wave 0, so every component here is presentational and
// prop-driven. The shapes below deliberately mirror the real gateway types so
// the eventual wiring task is a mapping and not a redesign:
//
//   PlanEffectView    ← core/gateway/policy/confirm/plan.ts  `PlanEffect`
//   PlanReversalView  ← core/gateway/policy/confirm/plan.ts  `PlanReversal`
//   PlanBodyView      ← core/gateway/policy/confirm/plan.ts  `PlanBody`
//   LockedArgsView    ← core/gateway/policy/types.ts         `WriteGateVerdict`
//                       (`kind: 'confirmed'` → argsCanonicalHash)
//   GuardrailResultView ← core/gateway/policy/types.ts       `GuardrailVerdict`,
//                       widened with the guardrail's identity and the value it
//                       checked, because 03 §7.2 item 4 requires the card to
//                       show "every guardrail on the tool, with pass/fail and
//                       the value checked" — a bare `{breached:false}` cannot
//                       say which rule passed or against what.
//
// The one shape that is NOT a mirror of a manifest type is `ProbeIdentityView`.
// See identity-block.tsx for why.

import type {
  BindingType,
  EnvClass,
  ReversalClass,
  Sensitivity,
} from '@mcpforge/shared';

/** One thing this call will do to one system. Mirrors `PlanEffect`. */
export interface PlanEffectView {
  readonly system: string;
  readonly object: string;
  readonly action: string;
  readonly reversible: boolean;
}

/** The reversal contract as the card renders it. Mirrors `PlanReversal`. */
export interface PlanReversalView {
  readonly class: ReversalClass;
  /** The reversing tool id, e.g. `jde.ap.voucher.cancel`. */
  readonly tool?: string | undefined;
  /** Where the reversing tool's detail page lives, when the host knows. */
  readonly toolHref?: string | undefined;
  readonly windowHours?: number | undefined;
  /** ISO-8601 instant the window closes — rendered as "until 26 Sep 2026". */
  readonly windowEndsAt?: string | undefined;
  readonly preconditions?: string | undefined;
  /**
   * Why no reversal exists. Rendered inside the `irreversible` danger banner;
   * 03 §7.2 item 5 asks for the banner "with the reason".
   */
  readonly reason?: string | undefined;
}

/**
 * One guardrail on the tool and what it decided for THIS plan. Passed
 * guardrails are carried in the same array as failed ones on purpose — there
 * is no separate "failures" collection anywhere in this family, because a
 * caller that can supply only failures can hide what was enforced.
 */
export interface GuardrailResultView {
  /** The guardrail's own id/rule name, e.g. `amountCeiling`. */
  readonly id: string;
  /** Human label, e.g. "Amount ceiling". */
  readonly label: string;
  readonly passed: boolean;
  /**
   * The value that was actually checked, already rendered as a string by the
   * caller (e.g. "18,400.00 GBP against a 50,000.00 GBP ceiling").
   */
  readonly valueChecked: string;
  /** The guardrail's own message. Required reading when `passed` is false. */
  readonly message?: string | undefined;
}

/**
 * Who is executing and whether identity carries into the target — **as
 * reported by the capability probe**. See identity-block.tsx.
 */
export interface ProbeIdentityView {
  /** `Principal.subject` — the only identity value written to audit. */
  readonly subject: string;
  /** Display name for the subject, when the host has one. */
  readonly displayName?: string | undefined;
  readonly bindingType: BindingType;
  /**
   * What the probe OBSERVED. `verified` is reachable here and only here,
   * because only a probe report may assert it (CLAUDE.md non-negotiable #2).
   */
  readonly carries: 'verified' | 'unverified' | 'no';
  /** The probe report this view came from. Without it nothing is asserted. */
  readonly probeRef: string;
  /** When that probe ran, ISO-8601. */
  readonly probedAt?: string | undefined;
  /**
   * The named compensating control that carries identity into the target when
   * the binding cannot — e.g. "wrapper schema records p_requested_by".
   */
  readonly compensatingControl?: string | undefined;
}

/** The canonical arguments and the hash the confirm token is bound to. */
export interface LockedArgsView {
  readonly args: Readonly<Record<string, unknown>>;
  /** Full sha256 hex; the card renders the first 8 characters. */
  readonly argsCanonicalHash: string;
}

/** The `confirm_required` body as the card consumes it. Mirrors `PlanBody`. */
export interface PlanBodyView {
  readonly plan: string;
  readonly effects: readonly PlanEffectView[];
  readonly warnings: readonly string[];
  readonly reversal: PlanReversalView;
}

// ---------------------------------------------------------------------------
// W0-J8 — confirm, refusal and approval (03 §7.3, §7.4). Additive only: every
// type above is W0-J7's and is unchanged.
//
// Mirrors, in the same spirit as the block at the top of this file:
//
//   ConsequenceView      ← the facts the friction level is DERIVED from
//                          (reversal class, sensitivity, environment class).
//                          Not a variant, not a level — see confirm-action.tsx.
//   RefusalView          ← core/gateway/policy/types.ts `WriteGateVerdict`
//                          (`kind: 'refuse'`) widened per code with the detail
//                          03 §7.3 requires a BANNER to carry and a chip
//                          cannot: the fields that changed, the guardrail's own
//                          message, the rule, the breaching value.
//   ApprovalView         ← core/gateway/policy/approval/types.ts and
//                          core/gateway/store/runtime/types.ts `ApprovalRequest`
//                          (id, planHash, argsCanonicalHash, callerSubject,
//                          toolId/Version, status, approverSubject,
//                          decisionReason, decidedAt, createdAt, expiresAt),
//                          plus the `approvalUrl` `RaiseOutcome` returns and
//                          display names the store does not hold.
// ---------------------------------------------------------------------------

/**
 * The plan facts confirm friction is derived from. 03 §7.3's table is a
 * function of these three and nothing else, so this is the whole input.
 *
 * SECURITY SHAPE: there is no `variant`, `friction` or `force` field here or
 * on `ConfirmActionProps`. A caller supplies the facts; the component decides
 * the friction. See `deriveConfirmVariant` in confirm-action.tsx.
 */
export interface ConsequenceView {
  readonly reversalClass: ReversalClass;
  readonly sensitivity: Sensitivity;
  readonly envClass: EnvClass;
  /**
   * The tool's entity segment — the word the user types for `irreversible`
   * ("the user types the tool's entity name (`voucher`)"). Required whenever
   * the derived variant is `type-to-confirm`; see confirm-action.tsx for what
   * happens when it is missing (the button stays disabled — it never degrades).
   */
  readonly entityName?: string | undefined;
  /**
   * Set for 03 §7.3's fourth row — deployment-wide actions such as the kill
   * switch. Forces `type-to-confirm` against the deployment id regardless of
   * reversal class, and the typed word becomes the deployment id.
   */
  readonly deploymentId?: string | undefined;
}

/** One argument whose value changed between plan time and execute time. */
export interface PlanArgumentChangeView {
  /** The argument's path, e.g. `amount` or `lines[0].quantity`. */
  readonly field: string;
  /** Already rendered by the caller. `undefined` means the field was absent. */
  readonly planned: string | undefined;
  readonly presented: string | undefined;
}

/** One grant that contributed to a separation-of-duties conflict. */
export interface SodGrantView {
  /** What the grant permits, e.g. `jde.ap.voucher.create`. */
  readonly grant: string;
  /** The role that produced it — the half that makes the refusal actionable. */
  readonly role: string;
}

/**
 * A refusal, per code. 03 §7.3: three states that "must render as distinct,
 * explained outcomes, not toasts".
 *
 * SECURITY SHAPE: the detail each code needs is REQUIRED by the type, not
 * optional. `PLAN_ARGUMENT_MISMATCH` cannot be constructed without its changed
 * fields and `POLICY_GUARDRAIL_BREACH` cannot be constructed without the
 * guardrail's own message, the rule and the breaching value — so the banner
 * can never fall back to "invalid request".
 */
export type RefusalView =
  | {
      readonly code: 'PLAN_EXPIRED';
      /** The gateway's own message, when it sent one. */
      readonly message?: string | undefined;
      readonly next: string;
    }
  | {
      readonly code: 'PLAN_ARGUMENT_MISMATCH';
      readonly message?: string | undefined;
      readonly next: string;
      /** Every field that changed. All are rendered; there is no cap. */
      readonly changes: readonly PlanArgumentChangeView[];
    }
  | {
      readonly code: 'POLICY_GUARDRAIL_BREACH';
      /** The guardrail's own message, rendered verbatim. */
      readonly message: string;
      readonly next: string;
      /** The rule that fired, e.g. `amountCeiling` or `sodConflict`. */
      readonly rule: string;
      /** The value that breached it, already rendered by the caller. */
      readonly valueBreached: string;
      /**
       * Present when `rule` is `sodConflict`. Both halves of the conflict, each
       * naming the role that produced it.
       */
      readonly sodGrants?: readonly SodGrantView[] | undefined;
    };

/** A person, as the approval blocks name them. */
export interface ApprovalPersonView {
  /** `Principal.subject` — the only identity value written to audit. */
  readonly subject: string;
  readonly displayName?: string | undefined;
}

/** An approval request as the two approval components render it. */
export interface ApprovalView {
  /** The `apr_…` id. */
  readonly approvalId: string;
  readonly state: ApprovalStateView;
  readonly requester: ApprovalPersonView;
  /** The role the requester is asking under. */
  readonly requesterRole?: string | undefined;
  /** The named approver(s). 03 §7.4: a named person, never a spinner. */
  readonly approvers: readonly ApprovalPersonView[];
  /** Who actually decided, once decided. */
  readonly decidedBy?: ApprovalPersonView | undefined;
  readonly decisionReason?: string | undefined;
  /** ISO-8601. `ApprovalRequest.createdAt`. */
  readonly raisedAt: string;
  readonly decidedAt?: string | undefined;
  readonly expiresAt: string;
  /** `ApprovalRequest.planHash` — rendered short. The claim the approver makes. */
  readonly planHash: string;
  readonly argsCanonicalHash: string;
  readonly toolId: string;
  readonly toolVersion?: string | undefined;
  readonly envClass: EnvClass;
  /** `RaiseOutcome.approvalUrl` — copyable, so the requester can chase it. */
  readonly approvalUrl?: string | undefined;
}

/** `ApprovalStatus` from the store, named for the view layer. */
export type ApprovalStateView = 'pending' | 'approved' | 'rejected' | 'expired';

// ---------------------------------------------------------------------------
// W0-J9 — execute, result and reverse (03 §7.5, §7.6). Additive only: every
// type above is W0-J7's / W0-J8's and is unchanged.
//
// Mirrors, in the same spirit as the two blocks above:
//
//   ResultKeyView       ← core/gateway/reversal/types.ts `ResultKeySpec` and the
//                         `resultKeys` map on `ReversalReport` — the recorded
//                         business keys, which ARE the reversal handle and the
//                         audit handle (02 §2.2).
//   ExecutionView       ← the correlation id the gateway assigns at dispatch,
//                         carried from the first moment so a failure is
//                         traceable even if the browser is closed.
//   ReplayView          ← core/gateway/policy/idempotency/types.ts
//                         `WriteDispatchOutcome` (`kind: 'replayed'`, whose
//                         response carries `replayed: true`).
//   CallLinksView       ← `ReversalReport.links`
//                         (`reversesCallId` / `reversedByCallId`).
//   ReversalPlanView    ← what a reversal needs to run the full plan → confirm
//                         sequence: exactly the props PlanReviewCard and
//                         ConfirmAction already take. A reversal is a write.
// ---------------------------------------------------------------------------

/**
 * One recorded business key. 03 §7.5: "These are the reversal handle and the
 * audit handle; they get prominence, not a details expander."
 */
export interface ResultKeyView {
  /** The declared key name, e.g. `document_number`. */
  readonly name: string;
  /** Its recorded value, already rendered by the caller. */
  readonly value: string;
  /**
   * Where Activity's business-key search for this key lives. Optional only
   * because the Activity route is a later task; when absent the chip still
   * copies, it just does not link.
   */
  readonly searchHref?: string | undefined;
}

/** The gateway-vs-target split 03 §7.5 asks the result card to show. */
export interface LatencyView {
  readonly totalMs: number;
  readonly gatewayMs: number;
  readonly targetMs: number;
}

/**
 * `target_identity_observed` against what was expected. A mismatch is "the
 * OIC/`function` risk showing up live" and renders as a danger banner.
 *
 * SECURITY SHAPE: there is no `mismatch: boolean` prop. The banner is derived
 * from `observed !== expected`, so a caller cannot present a mismatch as a
 * match by omitting a flag.
 */
export interface IdentityEchoView {
  /** The `Principal.subject` the call was made as. */
  readonly expected: string;
  /**
   * What the target actually reported. `null` means the target reported
   * nothing — which is not a match, and renders as its own stated absence.
   */
  readonly observed: string | null;
}

/** An idempotent replay. 03 §7.5's own visibly distinct state. */
export interface ReplayView {
  /** ISO-8601 instant of the ORIGINAL execution — "already made at 14:03". */
  readonly originalExecutedAt: string;
  /** The original call's audit id, so the user can go and read it. */
  readonly originalCallId?: string | undefined;
  readonly originalCallHref?: string | undefined;
}

/** Both ends of the reversal edge (03 §7.5), rendered in both directions. */
export interface CallLinksView {
  /** Set on a REVERSING call: the call it reverses. */
  readonly reversesCallId?: string | undefined;
  readonly reversesCallHref?: string | undefined;
  /** Set on a REVERSED call: the call that reversed it. */
  readonly reversedByCallId?: string | undefined;
  readonly reversedByCallHref?: string | undefined;
}

/** An executed (or replayed) call, as the result card renders it. */
export interface ResultView {
  /** The audit call id. */
  readonly callId: string;
  readonly toolId: string;
  readonly toolVersion?: string | undefined;
  /** The rendered `summaryTemplate` — the card's first and largest line. */
  readonly summary: string;
  /** Every recorded business key. Rendered as first-class chips, never hidden. */
  readonly resultKeys: readonly ResultKeyView[];
  readonly auditHref?: string | undefined;
  readonly latency?: LatencyView | undefined;
  readonly identityEcho?: IdentityEchoView | undefined;
  /** Present ONLY when the gateway reported `replayed: true`. */
  readonly replay?: ReplayView | undefined;
  readonly links?: CallLinksView | undefined;
}

/** Execution in flight. The correlation id exists before any result does. */
export interface ExecutionView {
  /** Assigned at dispatch. Visible from the first moment (03 §7.5). */
  readonly correlationId: string;
  readonly toolId: string;
  /** Optional human phase label, e.g. "Calling JD Edwards". Never a promise. */
  readonly phaseLabel?: string | undefined;
  /** ISO-8601 instant the execute was dispatched. */
  readonly startedAt?: string | undefined;
}

/**
 * One manifest precondition on the reversal.
 *
 * Judgment call (documented in the task report): `satisfied` is deliberately
 * `boolean | undefined`, where `undefined` means "not evaluatable client-side".
 * At Wave 0 there is no live gateway to evaluate a precondition against, and
 * rendering an unevaluated precondition as a green tick would be a claim the
 * portal cannot support. So the third state is real and renders as its own
 * "not checked yet" mark, never as a pass.
 */
export interface ReversalPreconditionView {
  readonly label: string;
  readonly satisfied: boolean | undefined;
}

/**
 * Everything the reversal's OWN plan → confirm sequence needs — which is
 * exactly what `PlanReviewCard` and `ConfirmAction` already take.
 *
 * SECURITY SHAPE: `ReversalAction` has no `onReverse` fire-and-forget callback.
 * The only way a reversal is initiated is through this plan being rendered in a
 * real `PlanReviewCard` with a real `ConfirmAction` in its action slot, so the
 * composition is structurally required rather than a convention. When this is
 * absent the Reverse control is `disabled` with a visible reason — it never
 * degrades to a one-click undo.
 */
export interface ReversalPlanView {
  readonly plan: PlanBodyView;
  readonly identity: ProbeIdentityView;
  readonly locked: LockedArgsView;
  readonly consequence: ConsequenceView;
  /** ISO-8601 `tokenExpiresAt` for the reversal's own plan token. */
  readonly expiresAt?: string | undefined;
}

/** The five steps of 03 §7.6's stepper, in order. */
export const WRITE_PATH_STEPS = [
  'plan',
  'confirm',
  'approve',
  'execute',
  'reverse',
] as const;
export type WritePathStep = (typeof WRITE_PATH_STEPS)[number];

/**
 * Per-step state. `skipped` is distinct from BOTH `done` and `upcoming` on
 * purpose — 03 §7.6: "Showing the skipped approval step is the point."
 */
export type WritePathStepState = 'done' | 'current' | 'upcoming' | 'skipped';
