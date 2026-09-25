// MCPForge — W0-E1's stub tool, kept as TEST SUPPORT only. W0-P16.
//
// The transport and consumer-access suites prove properties of the door
// (no session without [2a], no call without a session) and need one harmless
// tool behind it to show that a call through the door does succeed. The
// production server no longer serves it (./server.ts). `.test-support.ts` is
// excluded from the build and from the trust-boundary production walk.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGatewayMcpServer } from './server.js';

export const STUB_TOOL_ID = 'forge.transport.stub.get';

/** A server serving exactly the stub tool, which echoes its `echo` argument. */
export function createStubMcpServer(): McpServer {
  return createGatewayMcpServer(undefined, {
    listTools: () => [
      {
        name: STUB_TOOL_ID,
        description:
          'W0-E1 proof fixture only. Returns the echo argument. Not a manifest tool; carries no write, no binding.',
        inputSchema: {
          type: 'object',
          properties: { echo: { type: 'string', description: 'Value to echo back' } },
          required: ['echo'],
        },
      },
    ],
    callTool: (name, args) =>
      Promise.resolve(
        name === STUB_TOOL_ID
          ? { content: [{ type: 'text', text: `ok:${String(args['echo'])}` }] }
          : { isError: true, content: [{ type: 'text', text: `unknown tool ${name}` }] },
      ),
  });
}
