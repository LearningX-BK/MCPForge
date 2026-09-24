// MCPForge — W0-J7: the Plan Review card family barrel (03 §7.6).
// W0-J8 (`ConfirmAction`, `RefusalBanner`, `ApprovalGateCard`,
// `ApproverDecisionPanel`) and W0-J9 (`ExecutionProgress`, `ResultCard`, …)
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
export { RefusedPlanCard, type RefusedPlanCardProps } from './refused-plan-card';
export {
  ApprovalGateCard,
  approvalStateSentence,
  personLabel,
  timeOfDay,
  type ApprovalGateCardProps,
} from './approval-gate-card';
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
export {
  ExecutionProgress,
  EXECUTING_HEADING,
  CORRELATION_ID_LABEL,
  type ExecutionProgressProps,
} from './execution-progress';
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
  ExecutionView,
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
