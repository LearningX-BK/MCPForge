// MCPForge — `forge.describe`. W0-G4, 02 §5.2 tool 2, §5.3(c).
//
// Returns the full definition — schema, examples, error catalogue,
// write-safety summary, sensitivity — for up to five tools. "Examples and
// error catalogues live here and nowhere else" (02 §5.2), which is what keeps
// the resident definition inside its 200/400-token budget.
//
// WHAT IT DESCRIBES, AND WHAT IT REFUSES. The findable set, not the listable
// one. An agent that reached a `disabled` or `requires_grant` card through
// `forge.find` must be able to read what the tool would need — that is the
// same "no dead ends" reasoning §4.5 applied to the card itself, and the
// `access` annotation travels with the description so the agent is never
// misled into thinking it can call it. A tool outside the findable set is
// `TOOL_NOT_IN_SCOPE`, with the reason `scopeRefusalError` would give.

import { forgeError, type ForgeError } from '@mcpforge/shared';
import { resolveDiscovery } from './visibility.js';
import type { AccessLevel, MetaContext, MetaToolDetail } from './types.js';

/** 02 §5.2: "max 5 per call". */
export const DESCRIBE_MAX_TOOLS = 5;

export interface DescribeInput {
  readonly toolIds: readonly string[];
}

export interface DescribedTool {
  readonly id: string;
  readonly access: AccessLevel;
  readonly agentMessage?: string;
  readonly detail: MetaToolDetail;
}

export type DescribeResponse =
  | { readonly result: 'tools'; readonly tools: readonly DescribedTool[] }
  | { readonly result: 'error'; readonly error: ForgeError };

export function forgeDescribe(
  ctx: MetaContext,
  input: DescribeInput,
  correlationId: string,
): DescribeResponse {
  const ids = input.toolIds;

  if (ids.length === 0) {
    return {
      result: 'error',
      error: forgeError(
        'INPUT_INVALID',
        'forge.describe requires at least one tool id.',
        correlationId,
        {
          condition: 'toolIds was empty.',
          next: 'Call forge.find first and pass the ids of the cards it returned to forge.describe.',
        },
      ),
    };
  }

  if (ids.length > DESCRIBE_MAX_TOOLS) {
    return {
      result: 'error',
      error: forgeError(
        'INPUT_INVALID',
        `forge.describe accepts at most ${DESCRIBE_MAX_TOOLS} tool ids per call; ${ids.length} were given.`,
        correlationId,
        {
          condition: `toolIds carried ${ids.length} entries against a maximum of ${DESCRIBE_MAX_TOOLS}.`,
          next: `Split the request: call forge.describe with at most ${DESCRIBE_MAX_TOOLS} ids, then again with the rest.`,
        },
      ),
    };
  }

  const discovery = resolveDiscovery(ctx);
  const tools: DescribedTool[] = [];

  for (const id of ids) {
    if (!discovery.findable.has(id)) {
      return {
        result: 'error',
        error: forgeError(
          'TOOL_NOT_IN_SCOPE',
          `${id} is not in the resolved scope of this session.`,
          correlationId,
          {
            condition: `${id} is not visible to this session, and is not a tool this session may discover.`,
            next: `Call forge.find to locate a tool your roles do grant for this task. You are not granted ${id}.`,
          },
        ),
      };
    }

    const detail = ctx.details.detailFor(id);
    if (detail === null) {
      return {
        result: 'error',
        error: forgeError(
          'INTERNAL',
          `No generated description is loaded for ${id}.`,
          correlationId,
          {
            condition: `${id} is in scope but its generated description artefact is not loaded in this gateway.`,
            next: `Report correlationId ${correlationId} to the MCPForge operator: the deployed bundle is missing this tool's description. Use the card forge.find returned meanwhile; do not guess arguments.`,
          },
        ),
      };
    }

    const access = discovery.access.get(id) ?? { level: 'available' as const };
    tools.push(
      access.agentMessage === undefined
        ? { id, access: access.level, detail }
        : { id, access: access.level, agentMessage: access.agentMessage, detail },
    );
  }

  return { result: 'tools', tools };
}
