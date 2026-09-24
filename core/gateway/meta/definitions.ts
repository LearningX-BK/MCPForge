// MCPForge — the four meta-tools as ORDINARY MCP tools. W0-G4, 02 §5.2.
//
// "These are ordinary MCP tools. Any client can call them. They are the only
// thing that is *always* in `tools/list`." Nothing about them is
// Claude-specific, nothing about them is a protocol extension, and a client
// that ignores `list_changed` entirely still reaches every tool through
// `forge.find` → `forge.describe` → `forge.invoke` (02 §5.8's degradation
// ladder, rung 2).
//
// THE BUDGET IS THE DESIGN CONSTRAINT ON THIS FILE. 02 §5.2: "Total resident
// cost of the four meta-tools: ~440 tokens. They are written tersely on
// purpose and their budget is CI-enforced like any other tool's." Every word
// below is paying rent in every session of every deployment, which is why the
// descriptions are one line, the parameter descriptions are absent wherever
// the parameter name and type already say it, and the structured filters are
// listed rather than described. `meta.budget.test.ts` measures the four with
// the pinned counter and fails hard above 440.

import { VTC_HARD_CAP } from './vtc.js';

export const FORGE_FIND = 'forge.find';
export const FORGE_DESCRIBE = 'forge.describe';
export const FORGE_ACTIVATE = 'forge.activate';
export const FORGE_INVOKE = 'forge.invoke';

/** The four, in 02 §5.2's order. Always resident, never scoped away. */
export const META_TOOL_IDS = [FORGE_FIND, FORGE_DESCRIBE, FORGE_ACTIVATE, FORGE_INVOKE] as const;
export type MetaToolId = (typeof META_TOOL_IDS)[number];

/** One resident definition, exactly as it appears in `tools/list`. */
export interface MetaToolDefinition {
  readonly name: MetaToolId;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

const STRING = { type: 'string' } as const;

export const META_TOOL_DEFINITIONS: readonly MetaToolDefinition[] = [
  {
    name: FORGE_FIND,
    description: 'Find tools for an intent. Returns ranked cards with an access field, or no_tool.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The intent, in plain words.' },
        app: STRING,
        module: STRING,
        entity: STRING,
        verb: STRING,
        write: { type: 'boolean' },
        bindingType: STRING,
        process: STRING,
        package: STRING,
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
    },
  },
  {
    name: FORGE_DESCRIBE,
    description: 'Get full schemas, examples, errors and write safety for up to 5 tools.',
    inputSchema: {
      type: 'object',
      properties: {
        toolIds: { type: 'array', items: STRING, maxItems: 5 },
      },
      required: ['toolIds'],
    },
  },
  {
    name: FORGE_ACTIVATE,
    description: `Set this session's working scope by role, package or tool ids. Max ${VTC_HARD_CAP} resident tools.`,
    inputSchema: {
      type: 'object',
      properties: {
        role: STRING,
        package: STRING,
        module: STRING,
        toolIds: { type: 'array', items: STRING },
      },
    },
  },
  {
    name: FORGE_INVOKE,
    description: 'Call any tool by id. Same policy, confirmation and audit as a direct call.',
    inputSchema: {
      type: 'object',
      properties: {
        toolId: STRING,
        arguments: { type: 'object' },
        confirm: { type: 'string', description: 'The confirm token from the plan.' },
      },
      required: ['toolId', 'arguments'],
    },
  },
];

/** The four definitions as they go on the wire — what the budget is measured over. */
export function metaResidentWireShape(): readonly MetaToolDefinition[] {
  return META_TOOL_DEFINITIONS;
}
