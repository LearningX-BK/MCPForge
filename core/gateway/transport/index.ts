// MCPForge — transport public surface. W0-E1.
//
// This is the MCP endpoint skeleton: Streamable HTTP, `initialize`,
// capability negotiation, session state (02 §4.2 step [1]). It deliberately
// exposes only the stub tool used to prove the handshake — see
// ./REVIEW_CHECKLIST.md and ./server.ts for what is explicitly out of scope.

export { createGatewayMcpServer, STUB_TOOL_ID, type GatewayServerInfo } from './server.js';
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
