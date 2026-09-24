// MCPForge gateway. CLAUDE.md §4: "MCP endpoint, policy chain, audit, store/".
// W0-C1 lands the store and the runtime-info field only; the MCP endpoint, the
// policy chain and the audit path are later tasks and are not stubbed here.

export * from './store/index.js';
// W0-D1 — the identity seam. Everything downstream consumes `Principal` and
// nothing else (02 §4.4); see identity/index.ts for what deliberately does not
// cross this boundary.
export * from './identity/index.js';
export { runtimeInfo, type RuntimeInfo, type RuntimeStoreInfo } from './api/runtime-info.js';
// W0-E1 — the MCP endpoint skeleton: Streamable HTTP, initialize, capability
// negotiation, session state (02 §4.2 step [1]). See transport/index.ts for
// what is and is not in scope here.
export * from './transport/index.js';
// W0-E2 — scope resolution, 02 §4.2 step [4]: visible(session) as a six-way
// intersection of six independent predicates (02 §5.1, 02 §11.3).
export * from './scope/index.js';
// W0-E3 — the policy chain, 02 §4.2 step [6] as extended by 02 §11.4.2: ten
// ordered, fail-closed stages, walked identically by tools/call and forge.invoke.
export * from './policy/index.js';
// W0-G4 — the four always-resident meta-tools (02 §5.2): forge.find,
// forge.describe, forge.activate, forge.invoke. Assembly over W0-G1/G2/G3's
// index and ranker, W0-E2's scope, W0-E3's policy entry points and W0-E5's
// list_changed notifier.
export * from './meta/index.js';
// W0-K2 — headless mode (02 §6.5): `MCPFORGE_MODE=headless` starts this same
// gateway assembly without spawning the portal process.
export {
  GATEWAY_MODES,
  parseGatewayMode,
  launchGateway,
  type GatewayMode,
  type LaunchOptions,
  type LaunchedGateway,
} from './launch.js';
