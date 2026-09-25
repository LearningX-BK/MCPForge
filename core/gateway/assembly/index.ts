// MCPForge — the gateway assembly. W0-P13: the runtime catalogue resolver.
export {
  CatalogueLoadRefused,
  loadRuntimeCatalogue,
  type CatalogueLoadFailure,
  type LoadRuntimeCatalogueOptions,
  type ResolvedTool,
  type RuntimeCatalogue,
} from './catalogue.js';
// W0-P15 — session establishment: consumer ∩ human -> the real ScopeContext.
export {
  createSessionAssembly,
  SessionAssemblyUnavailable,
  type EstablishedSession,
  type SessionAssembly,
  type SessionAssemblyOptions,
  type SessionOutcome,
} from './session.js';
export {
  DeploymentConfigInvalid,
  deploymentConfigPath,
  loadDeploymentConfig,
  type DeploymentConfig,
} from './deployment.js';
// W0-P16 — the served surface: meta-tools, scoped tools/list, tools/call -> the chain.
export {
  createServedSurface,
  type ProceedHandler,
  type ProceedInput,
  type ServedSurface,
  type ServedSurfaceOptions,
} from './surface.js';
export {
  loadSurfaceArtefacts,
  SurfaceArtefactsUnavailable,
  type SurfaceArtefacts,
} from './surface-artefacts.js';
// W0-P17 — execute, shape and audit behind the surface's seams.
export {
  createCallExecution,
  rowCountOf,
  type CallExecution,
  type CallExecutionOptions,
  type DecisionRecord,
} from './execute.js';
export type { DecisionRecordHandler } from './surface.js';
