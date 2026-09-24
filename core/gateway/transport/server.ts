// MCPForge — the MCP server skeleton. W0-E1, 02 §4.2 steps [1] and [5].
//
// This builds one `McpServer` (from the official `@modelcontextprotocol/sdk`,
// which is a generic implementation of the spec, not a Claude-specific one —
// see ../transport/REVIEW_CHECKLIST.md) advertising exactly the capabilities
// this skeleton actually has, and registers **one stub tool** to prove
// `tools/list` -> `tools/call` end to end.
//
// What this deliberately does NOT do, because it is out of this task's scope
// (see the four meta-tools' own later task, and W0-E2/E3 for scope + policy):
//   - no `forge.find` / `forge.describe` / `forge.activate` / `forge.invoke`
//   - no role-scoped `tools/list` (02 §5) — this server always lists the one
//     stub tool; scope resolution is W0-E2
//   - no policy chain (02 §4.2 step [6]) — a real write tool must never be
//     reachable through this skeleton
//
// The stub tool id follows the closed-verb convention (CLAUDE.md §5) even
// though it is test fixture, not a manifest tool, so nothing about it needs a
// special case in tooling that assumes the naming convention.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export const STUB_TOOL_ID = 'forge.transport.stub.get';

export interface GatewayServerInfo {
  readonly name: string;
  readonly version: string;
}

const DEFAULT_SERVER_INFO: GatewayServerInfo = {
  name: 'mcpforge-gateway',
  version: '0.0.0',
};

/**
 * Builds a fresh `McpServer` instance. The SDK's Streamable HTTP transport
 * expects one server (or at least one server per logical connection) — see
 * ./http.ts, which calls this once per new session.
 */
export function createGatewayMcpServer(info: GatewayServerInfo = DEFAULT_SERVER_INFO): McpServer {
  const server = new McpServer(
    { name: info.name, version: info.version },
    {
      // Only the capability this skeleton actually implements. No `resources`,
      // no `prompts`, no `logging` — advertising a capability the server does
      // not implement is itself a spec violation, not a convenience.
      capabilities: { tools: {} },
    },
  );

  server.registerTool(
    STUB_TOOL_ID,
    {
      title: 'Transport skeleton stub',
      description:
        'W0-E1 proof fixture only. Returns the echo argument. Not a manifest tool; carries no write, no binding.',
      inputSchema: {
        echo: z.string().describe('Value to echo back'),
      },
    },
    async ({ echo }) => {
      return {
        content: [{ type: 'text', text: `ok:${echo}` }],
      };
    },
  );

  return server;
}
