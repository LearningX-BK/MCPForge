// MCPForge — the per-session MCP server. W0-E1 built the skeleton; W0-P16
// replaced its stub tool with the served surface. 02 §4.2 steps [1] and [5].
//
// This builds one `McpServer` (from the official `@modelcontextprotocol/sdk`,
// which is a generic implementation of the spec, not a Claude-specific one —
// see ../transport/REVIEW_CHECKLIST.md) and answers `tools/list` and
// `tools/call` from a `ToolSurface`. The transport does not know what a
// surface contains: which tools are listed and how a call is decided belong
// to the gateway assembly (`../assembly/surface.ts`), which runs scope, the
// four meta-tools and the policy chain. This file only puts them on the wire.
//
// Raw JSON Schema, not zod. The resident definitions are codegen's own
// `buildResidentDefinition` output (02 §5.3(b)), the shape the token-budget
// gate measures, so they are served verbatim through the low-level request
// handlers rather than re-expressed through `registerTool`'s zod shapes. A
// second expression of the schema would be a second thing to keep in step
// with the budget.
//
// WITH NO SURFACE, NOTHING IS SERVED. `tools/list` is empty and every
// `tools/call` refuses. A gateway that was never given a surface is
// misconfigured, and the answer to that is an empty door, never a default
// tool (W0-E1's stub is gone; it lives on only as test support).

import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { forgeError } from '@mcpforge/shared/errors';

export interface GatewayServerInfo {
  readonly name: string;
  readonly version: string;
}

const DEFAULT_SERVER_INFO: GatewayServerInfo = {
  name: 'mcpforge-gateway',
  version: '0.0.0',
};

/** One resident definition as `tools/list` carries it: name, description, input schema. */
export interface ServedToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** What one session's server serves. Implemented by the gateway assembly. */
export interface ToolSurface {
  listTools(): Promise<readonly ServedToolDefinition[]> | readonly ServedToolDefinition[];
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<CallToolResult>;
}

/** The surface a server gets when none was supplied: nothing listed, every call refused. */
const NO_SURFACE: ToolSurface = {
  listTools: () => [],
  callTool: (name) => {
    const error = forgeError(
      'INTERNAL',
      `This gateway serves no tools, so ${name} cannot be called.`,
      randomUUID(),
      {
        condition: 'The gateway was started without a tool surface (02 §4.2 step [5]).',
        next: 'Report this correlationId to the MCPForge operator: the gateway must be started with its assembly wired in. Nothing was executed.',
      },
    );
    return Promise.resolve({
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(error.toJSON()) }],
    });
  },
};

/**
 * Builds a fresh `McpServer` for one session (./http.ts calls the factory once
 * per established session). `tools.listChanged` is advertised because the
 * surface emits it, on activation and on kill-switch changes (02 §5.8).
 */
export function createGatewayMcpServer(
  info: GatewayServerInfo = DEFAULT_SERVER_INFO,
  surface: ToolSurface = NO_SURFACE,
): McpServer {
  const server = new McpServer(
    { name: info.name, version: info.version },
    {
      // Only the capability this server implements. No `resources`, no
      // `prompts`, no `logging` — advertising a capability the server does
      // not implement is itself a spec violation, not a convenience.
      capabilities: { tools: { listChanged: true } },
    },
  );

  server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await surface.listTools();
    return { tools: tools.map((t) => ({ ...t }) as Tool) };
  });

  server.server.setRequestHandler(CallToolRequestSchema, (request) =>
    surface.callTool(request.params.name, request.params.arguments ?? {}),
  );

  return server;
}
