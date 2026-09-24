// MCPForge — the capability probe. 02 §4.5, extended by 02 §11.4.3. W0-H4.
//
// Note what this package does NOT export: any way to write a manifest, and any
// way to build a probe plan other than `buildProbePlan`.

export {
  PROBE_STATUSES,
  PROBE_STATUS_SET,
  PROBE_ENABLED_STATUSES,
  CHECK_FAILURE_STATUSES,
  STATUS_PRECEDENCE,
  isProbeStatus,
} from './status.js';
export type { ProbeStatus, CheckFailureStatus } from './status.js';

export { ENVIRONMENT_CLASSES, isEnvironmentClass, isProductionTarget } from './target.js';
export type { EnvironmentClass, ProbeTarget } from './target.js';

export {
  buildProbePlan,
  CHECK_CATALOGUE,
  ALL_CHECKS,
  CHECK_CLASSIFICATIONS,
  NON_MUTATING_CLASSIFICATIONS,
  isMutating,
} from './plan/index.js';
export type {
  CheckClassification,
  CheckOutcome,
  NonMutatingClassification,
  ProbeCheckContext,
  ProbeCheckExecutor,
  ProbeCheckResult,
  ProbeCheckSpec,
  ProbePlan,
  ProbePlanInput,
} from './plan/index.js';

export * from './identity/index.js';

export { runProbe, MutatingCheckRefused, deriveCarriage, IDENTITY_CONSTRAINT_CHECK } from './run/runner.js';
export type { ProbeRunInput, ProbeToolInput } from './run/runner.js';

export {
  createFunctionProbeExecutor,
  dispatchableOrchestrations,
  PROBE_ORCHESTRATION_INFO,
  VALIDATE_SUFFIX,
} from './run/function-executor.js';
export type { FunctionProbeOptions } from './run/function-executor.js';

export { reduceStatus } from './report/reduce.js';
export type { ReducedStatus, ReduceInput } from './report/reduce.js';

export { remediationFor, agentMessageFor } from './report/messages.js';
export type { MessageInput } from './report/messages.js';

export { PROBE_REPORT_API_VERSION, PROBE_REPORT_KIND } from './report/types.js';
export type {
  BindingGrantReconciliation,
  GrantEvidence,
  ProbeReport,
  ProbeReportSummary,
  ProbeReportTarget,
  ProbeToolReport,
  ValidatePairReport,
} from './report/types.js';
// W0-H2 — validate-pair presence per write tool, for the enablement backlog.
export { buildValidatePairReport, VALIDATE_SIBLING_CHECK } from './report/validate-pair.js';
export type { ValidatePairInput } from './report/validate-pair.js';

export {
  PROBE_REPORT_SCHEMA_ID,
  probeReportSchema,
  validateProbeReport,
  assertProbeReport,
  ProbeReportInvalid,
} from './report/schema.js';
export type { ProbeReportValidation, SchemaViolation } from './report/schema.js';

export {
  PROBE_REPORT_RELATIVE_PATH,
  probeReportPath,
  writeProbeReport,
  loadProbeReport,
  probeStatusMap,
  ProbeReportLoadError,
} from './report/io.js';

export { reconcileBindingGrants, reconciliationDetail } from './reconcile/binding-grants.js';
export type { CompiledBindingGrant, DatabaseGrantSource } from './reconcile/binding-grants.js';

export { probeInputsFromCatalogue, UnknownBindingType } from './catalogue.js';
export type { ProbeToolDetail } from './catalogue.js';
