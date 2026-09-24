// MCPForge — the `function` binding executor (02 §3.5). Public surface.
//
// Note what is NOT exported, on purpose: there is no entry point that takes an
// orchestration name as an argument. The only way to dispatch is to hold a
// `FunctionBindingDescriptor` built by `buildFunctionBindingDescriptor` from a
// manifest whose `binding.type` is `function`.

export { createFunctionExecutor } from './executor.js';
export type { FunctionExecutor, FunctionExecutorOptions } from './executor.js';
export { buildFunctionBindingDescriptor, NotAFunctionBinding } from './descriptor.js';
// W0-H2 — the validate-pair dry run and its degradation ladder (02 §3.5).
// Note what is NOT exported here either: no entry point takes an orchestration
// name. The `_VALIDATE` sibling is derived from the manifest inside
// `buildDryRunDescriptor` and nowhere else.
export {
  APPROVAL_FORCING_SENSITIVITY,
  DEGRADED_STRATEGY,
  NO_PROBE_EVIDENCE,
  NotAWriteTool,
  VALIDATE_SIBLING_SUFFIX,
  buildDryRunDescriptor,
  createDryRunDispatcher,
  resolveDryRunPlan,
  validatePairRegistry,
  validateSiblingDescriptor,
} from './dryrun.js';
export type {
  DryRunDescriptor,
  DryRunDispatcher,
  DryRunDispatcherOptions,
  DryRunOutcome,
  DryRunPlan,
  ValidatePairRegistry,
} from './dryrun.js';
export { applyInputMapping, buildIdentityInputMapping } from './mapping.js';
export type { MappedInputs } from './mapping.js';
export { ConcurrencyRegistry, AcquireTimeout } from './concurrency.js';
export type { Semaphore } from './concurrency.js';
export { compileGeneratedSchema } from './schema.js';
export {
  DEFAULT_READ_SAMPLE_RATE,
  EXECUTING_USER_KEY,
  assertIdentityEcho,
  createAlwaysSampler,
  createDeterministicSampler,
  decideEchoCheck,
  extractExecutingUser,
  identitiesMatch,
  skippedEcho,
} from './identity.js';
export { FunctionIdentityEchoError } from './errors.js';
export { DEFAULT_MAX_CONCURRENCY } from './types.js';
export type {
  AisClient,
  EchoSampler,
  FunctionBindingIdentity,
  IdentityEchoObservation,
  AisRequest,
  AisResponse,
  AisDispatchRecord,
  CompiledSchemaValidator,
  FunctionBindingDescriptor,
  FunctionCallInput,
  FunctionCallResult,
  FunctionExecutionCaps,
} from './types.js';
