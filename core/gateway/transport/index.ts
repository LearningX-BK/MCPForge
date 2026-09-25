// MCPForge — transport public surface. W0-E1.
//
// The MCP endpoint: Streamable HTTP, `initialize`, capability negotiation,
// session state (02 §4.2 step [1]), and the per-session server that serves a
// `ToolSurface` (step [5], W0-P16). What the surface contains is the gateway
// assembly's (`../assembly/surface.ts`), not the transport's.

export {
  createGatewayMcpServer,
  type GatewayServerInfo,
  type ServedToolDefinition,
  type ToolSurface,
} from './server.js';
export {
  createGatewayHttpTransport,
  type ConsumerAuthGate,
  type GatewayHttpTransport,
  type GatewayHttpTransportOptions,
  type PublishedMetadata,
} from './http.js';
// W0-N2 — step [2a], consumer authentication and the registration check.
export * from './consumer-auth/index.js';
export { inMemorySessionStore, type McpSessionRecord, type McpSessionStore } from './session.js';
// W0-P15 — steps [2] and [3], bound to the MCP session.
export {
  identityRequestFrom,
  type SessionBindingOutcome,
  type SessionEstablisher,
  type SessionHandle,
} from './session-binding.js';
