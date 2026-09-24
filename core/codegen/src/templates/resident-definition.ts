// MCPForge — the ≤200/400-token "resident definition" (02 §5.3(b)) and the
// ≤60-token "card" (02 §5.3(a)). Two representations, same source fields,
// deliberately built in one module: the card is a strict subset of the
// resident definition's fields (id/purpose/verb/entity/write/binding/
// sensitivity/roles/status — 02 §5.3's own worked example), and keeping them
// beside each other is what stops them drifting apart as separate hand
// edits.

import type { ToolView } from './manifest-view.js';

/**
 * What `tools/list` would carry for this tool: name + description (`purpose`,
 * reused, never a second prose blob) + input schema. This module returns the
 * plain object form; `card.ts` derives the ≤60-token card from a subset of
 * it and `handler.ts`/tests measure both with the pinned counter.
 */
export function buildResidentDefinition(tool: ToolView): Record<string, unknown> {
  return {
    name: tool.id,
    description: tool.purpose,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(
        tool.input.map((i) => [
          i.name,
          {
            type: i.type,
            description: i.desc,
            ...(i.enumRef !== undefined ? { 'x-enumRef': i.enumRef } : {}),
          },
        ]),
      ),
      required: tool.input.filter((i) => i.required).map((i) => i.name),
    },
  };
}
