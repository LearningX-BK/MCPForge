// MCPForge — W0-J15: Approvals data shapes (03 §5.3 "Approvals", §7.4).
//
// "Two kinds of approval in one queue, differentiated but not separated":
//
//   Runtime approval      — a write call whose tool has
//                            `humanApprovalRequired: true`, waiting for a
//                            named approver before a confirm token is minted.
//                            Backed by gw / `audit_approval`. Expires with
//                            its plan (03 §7.4). This is W0-J8's `ApprovalView`
//                            verbatim — not a parallel shape.
//   Definitional approval — a change proposal (a PR changing a manifest, a
//                            role, or a package). Backed by git / PR. Does
//                            not expire (03 §5.3's own table: "Expires? No").
//                            This is W0-J12's `ChangeProposal` verbatim.
//
// JUDGMENT CALL, same seam discipline as `build/types.ts` and
// `write-path/types.ts`: no live gateway (`audit_approval` query) or wired
// `ChangeHost.listProposals()` exists in the portal yet, so this file adds
// only the minimal view wrapper needed to render ONE unified, sortable list
// — `ApprovalQueueEntry` — over the two REAL shapes above. It invents no
// parallel status vocabulary: the runtime half reads `ApprovalStateView`
// (write-path/types.ts) and the definitional half reads `ChangeState`
// (@mcpforge/shared) unchanged.
//
// JUDGMENT CALL — "expired" for definitional approvals: `CHANGE_STATES`
// (core/shared/src/status.ts) has no `expired` member — a change proposal
// does not expire, it is `withdrawn` (PR closed without merging) or goes
// `invalid` (a gate failed). 03 §5.3's own table says as much ("Expires? No"
// for the definitional column). So the "expired-or-stale" fixture asked for
// in this task is modelled as `withdrawn` — the real closed state nearest to
// "no longer live" for a definitional approval — not as an invented
// `expired` value on `ChangeState`. This is a deliberate reading, flagged
// for a human: if a future revision of 03/02 wants a genuine
// stale/timed-out definitional state, that is a schema change to
// `ChangeState` itself, out of this task's touches: scope.
import type { ChangeState } from '@mcpforge/shared';
import type { ApprovalStateView, ApprovalView } from '@/components/write-path';

/** Discriminant. Nothing else in this module infers kind from shape. */
export type ApprovalQueueKind = 'runtime' | 'definitional';

/** The runtime half — W0-J8's `ApprovalView`, unchanged, plus routing info. */
export interface RuntimeApprovalEntry {
  readonly kind: 'runtime';
  readonly approval: ApprovalView;
  /** Where `/approvals/[approvalId]` (the `ApproverDecisionPanel`) lives. */
  readonly href: string;
  readonly application: string;
  readonly sensitivity: string;
}

/** The definitional half — W0-J12's `ChangeProposal` shape, view-flattened. */
export interface DefinitionalApprovalEntry {
  readonly kind: 'definitional';
  readonly id: string;
  readonly title: string;
  readonly state: ChangeState;
  readonly author: string;
  readonly createdAt: string;
  readonly href: string;
  readonly application: string;
}

export type ApprovalQueueEntry = RuntimeApprovalEntry | DefinitionalApprovalEntry;

/** Filter facets named in 03 §5.3: "kind, application, requester, tool, sensitivity, age." */
export interface ApprovalFilters {
  readonly kind?: ApprovalQueueKind;
  readonly application?: string;
}

export const RUNTIME_URGENT_STATES: readonly ApprovalStateView[] = ['pending'];
