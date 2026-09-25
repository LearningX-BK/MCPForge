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
