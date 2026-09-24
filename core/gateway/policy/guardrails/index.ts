// MCPForge — the business-guardrail engine. W0-F4, 02 §3.1.3, 02 §4.3.
//
// The implementation of stage 6f's `GuardrailEvaluator` seam. All five kinds
// 02 §3.1.3 names — `maxNumeric`/`minNumeric`, `allowedValues`, `rateLimit`,
// `sodConflict`, `timeWindow` — and no sixth mechanism: `guardrailEvaluator` is
// the only guardrail evaluator in the gateway and it is reached only through
// the frozen policy chain.
//
// `core/gateway/policy/**` is an OPUS_GUARDED_PATH (CLAUDE.md §6).

export { evaluateGuardrails, guardrailEvaluator } from './gate.js';
export { evaluateAllowedValues, evaluateNumeric, malformedDeclaration } from './field.js';
export { evaluateSodConflict, rolesGranting } from './sod.js';
export { evaluateRateLimit, evaluateTimeWindow } from './stateful.js';
export {
  NOT_BREACHED,
  type ExecuteCountQuery,
  type ExecuteCountSource,
  type GuardrailBreach,
  type GuardrailDeps,
  type GuardrailPass,
  type GuardrailVerdict as GuardrailEngineVerdict,
  type TimeWindowQuery,
  type TimeWindowSource,
  type TimeWindowVerdict,
} from './types.js';
