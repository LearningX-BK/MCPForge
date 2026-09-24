// MCPForge — role / package / consumer compilation. W0-B8 (02 §4.3, §6.1).
//
// TASKS.md names this directory `core/codegen/compile/**`. The package
// compiles with rootDir `src`, so it physically sits at
// `core/codegen/src/compile/**`, matching the same note rules/index.ts carries.

export {
  matchesToolIdGlob,
  matchesAny,
  resolveGlobs,
  entityPrefix,
  toolVerb,
  TOOL_ID_SEGMENTS,
} from './glob.js';
export {
  isRecord,
  stringArray,
  manifestsOfKind,
  allToolIds,
  readRole,
  readPackage,
  readConsumer,
  type RoleView,
  type PackageView,
  type ConsumerView,
  type BindingGrantView,
  type SodConflictView,
} from './model.js';
export {
  compileRoleScope,
  compileGrant,
  compileGrants,
  grantIsExpired,
  todayIso,
  type CompiledRoleScope,
  type IsoDate,
} from './role.js';
export {
  loadApprovalRecords,
  resolveStandingAuthorization,
  type ApprovalRecordView,
  type CompiledStandingAuthorization,
  type StandingStatus,
} from './standing.js';
export { compilePackageSelection, type CompiledPackageSelection } from './package.js';
export {
  compileConsumerAuthorization,
  type CompiledConsumerAuthorization,
} from './consumer.js';
export { SOD_RULES, IMPLICIT_SOD_VERBS } from './sod.js';
export { compileGovernanceArtefacts, type CompileArtefactsResult } from './emit-compiled.js';
