// MCPForge — the `forge.describe` full-definition wire shape, measured
// against the ≤600-token budget (02 §5.3(c)). W0-G5.
//
// 02 §5.3(c): "What `forge.describe` returns: everything above [the
// resident definition] plus examples, the error catalogue with `next`
// hints, write-safety details and the reversal contract."
//
// JUDGMENT CALL (documented per CLAUDE.md §8): `ToolView` (W0-B6,
// `templates/manifest-view.ts`) does not yet carry an `examples` field or a
// per-tool declared error catalogue — no manifest schema field for either
// exists in the repo yet (the closed error taxonomy is a shared,
// cross-tool file, not a per-manifest list — see `core/shared/errors`).
// Building those into `forge.describe`'s wire shape is therefore out of
// this task's `touches: core/codegen/budget/**` scope: it would mean
// authoring a new manifest field and a schema rule, which belongs to
// whichever task actually introduces per-tool examples/errors to the
// manifest shape. This builder assembles the full description from every
// field `ToolView` DOES carry today — the resident definition plus
// sensitivity, disambiguation, aliases and the complete write-safety /
// reversal block — so the ≤600 budget is enforced for real against the
// real current shape, and grows correctly (with no second writer to
// update) once examples/errors land on `ToolView`.

import { buildResidentDefinition } from '../templates/resident-definition.js';
import type { ToolView } from '../templates/manifest-view.js';

function writeSafetySummary(tool: ToolView): Record<string, unknown> | undefined {
  const ws = tool.writeSafety;
  if (!ws) return undefined;
  return {
    dryRunStrategy: ws.dryRunStrategy,
    confirmTokenTtlSeconds: ws.confirmTokenTtlSeconds,
    planTemplate: ws.planTemplate,
    humanApprovalRequired: ws.humanApprovalRequired,
    reversal: {
      class: ws.reversalClass,
      tool: ws.reversalTool,
      argMap: ws.reversalArgMap,
    },
    idempotencyScopeHours: ws.idempotencyScopeHours,
    guardrails: ws.guardrails.map((g) => ({
      kind: g.kind,
      ...(g.field !== undefined ? { field: g.field } : {}),
      ...(g.value !== undefined ? { value: g.value } : {}),
      ...(g.message !== undefined ? { message: g.message } : {}),
    })),
  };
}

/**
 * Build the `forge.describe` wire object for one tool, the representation
 * this module measures against the ≤600-token budget. Not yet
 * serialized/formatted — callers `JSON.stringify` it the same way `card.ts`
 * and `resident-definition.ts` leave serialization to their callers.
 */
export function buildDescribeResponse(tool: ToolView): Record<string, unknown> {
  const resident = buildResidentDefinition(tool);
  const ws = writeSafetySummary(tool);
  return {
    ...resident,
    sensitivity: tool.sensitivity,
    write: tool.write,
    archetype: tool.archetype,
    aliases: tool.aliases,
    disambiguation: tool.disambiguation,
    ...(ws !== undefined ? { writeSafety: ws } : {}),
  };
}
