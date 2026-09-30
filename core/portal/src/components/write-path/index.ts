// MCPForge — W0-J7: the Plan Review card family barrel (03 §7.6).
// W0-J8 (`ConfirmAction`, `RefusalBanner`,
// `ApproverDecisionPanel`) and W0-J9 (`ResultCard`, …)
// extend this barrel; they are not part of this task.
export { PlanReviewCard, type PlanReviewCardProps } from './plan-review-card';
export { PlanSentence, type PlanSentenceProps } from './plan-sentence';
export { EffectsTable, sortEffects, type EffectsTableProps } from './effects-table';
export { WarningList, type WarningListProps } from './warning-list';
export {
  GuardrailResultList,
  type GuardrailResultListProps,
} from './guardrail-result-list';
export {
  ReversalContract,
  IRREVERSIBLE_BANNER_TEXT,
  type ReversalContractProps,
} from './reversal-contract';
export { IdentityBlock, type IdentityBlockProps } from './identity-block';
export { LockedArgs, shortHash, type LockedArgsProps } from './locked-args';
export {
  PlanExpiryCountdown,
  formatRemaining,
  ANNOUNCE_AT_SECONDS,
  type PlanExpiryCountdownProps,
} from './plan-expiry-countdown';
// --- W0-J8 (03 §7.3, §7.4) -------------------------------------------------
export {
  ConfirmAction,
  deriveConfirmVariant,
  requiredConfirmWord,
  confirmWordMatches,
  ACKNOWLEDGE_LABEL,
  type ConfirmActionProps,
  type ConfirmVariant,
} from './confirm-action';
export { RefusalBanner, type RefusalBannerProps } from './refusal-banner';
// W0-P3f deleted `RefusedPlanCard` and `ApprovalGateCard` (owner decision, 30
// Sep 2026): both render the full argument list, and the approval queue stores
// only the arguments' hash, never their values. The portal has no surface for
// either: the requester's card lives in the agent's chat client, where the
// plan response carries everything it needs.
export { personLabel, timeOfDay } from './approval-labels';
export {
  ApproverDecisionPanel,
  type ApproverDecisionPanelProps,
} from './approver-decision-panel';
export type {
  ApprovalPersonView,
  ApprovalStateView,
  ApprovalView,
  ConsequenceView,
  PlanArgumentChangeView,
  RefusalView,
  SodGrantView,
} from './types';

// --- W0-J9 (03 §7.5, §7.6) -------------------------------------------------
// `ExecutionProgress` was deleted in W0-P3d: the portal never executes a
// runtime write (the requester's agent does, through /mcp; the approver never
// executes, 03 §7.4), so an in-flight execute has no portal surface to show.
export {
  ResultCard,
  identityEchoMismatched,
  type ResultCardProps,
} from './result-card';
export {
  ResultKeyChip,
  COPY_IDLE_LABEL,
  COPY_DONE_LABEL,
  type ResultKeyChipProps,
} from './result-key-chip';
export {
  ReplayNotice,
  REPLAY_HEADING,
  replaySentence,
  type ReplayNoticeProps,
} from './replay-notice';
export {
  ReversalAction,
  reversalActionLabel,
  reversingToolPhrase,
  formatReversalCountdown,
  reversalWindowExpired,
  type ReversalActionProps,
} from './reversal-action';
export {
  WritePathStepper,
  deriveStepStates,
  type WritePathStepperProps,
} from './write-path-stepper';
export { formatWindowEnd } from './reversal-contract';
export { WRITE_PATH_STEPS } from './types';
export type {
  CallLinksView,
  IdentityEchoView,
  LatencyView,
  ReplayView,
  ResultKeyView,
  ResultView,
  ReversalPlanView,
  ReversalPreconditionView,
  WritePathStep,
  WritePathStepState,
} from './types';

export type {
  GuardrailResultView,
  LockedArgsView,
  PlanBodyView,
  PlanEffectView,
  PlanReversalView,
  ProbeIdentityView,
} from './types';
