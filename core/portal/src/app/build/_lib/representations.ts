// MCPForge — W0-J14: the centre pane's four live previews (03 §5.3 "Build"):
// the card, the resident definition, the `forge.describe` payload, and the
// generated JSON Schema — each measured against its real budget.
//
// Every builder below is the REAL codegen artefact generator, reused via the
// `@mcpforge/codegen/templates` and `@mcpforge/codegen/budget` subpath
// exports (the one addition this task made to `core/codegen/package.json` —
// see the task report) — not a re-implementation:
//   card      -> `buildDiscoveryCard` + `cardWireShape`  (templates/card.ts)
//   resident  -> `buildResidentDefinition`                (templates/resident-definition.ts)
//   describe  -> `buildDescribeResponse`                  (budget/describe.ts — the real `forge.describe` wire-shape builder, W0-G5)
//   schema    -> `buildSchemaJson`                        (templates/schema.ts)
// and the one pinned counter, `countTokens`/`TOKEN_BUDGETS` from
// `@mcpforge/shared` — the SAME counter and SAME budget constants W0-J13's
// Agent view measures the catalog's read-only tools against
// (`catalog/agent-representations.ts`), so a number shown here and a number
// shown there are never two different measurements of the same idea.
//
// This module is pure and filesystem-free (`readTool` is tolerant of a
// partial/invalid document, exactly as `core/codegen/src/compile/model.ts`'s
// header documents for the same reason) so it runs live, client-side, on
// every edit — there is no debounce here; CodeMirror's own `onChange` is the
// only governor.
import { parse as parseYaml } from 'yaml';
import {
  readTool,
  buildDiscoveryCard,
  cardWireShape,
  buildResidentDefinition,
  buildSchemaJson,
  type ToolView,
} from '@mcpforge/codegen/templates';
import { buildDescribeResponse } from '@mcpforge/codegen/budget';
import { countTokens, TOKEN_BUDGETS } from '@mcpforge/shared';
import type { ProvenanceInfo } from '@mcpforge/codegen/emit';

/**
 * Provenance content is stripped from the card's measured wire shape
 * (`cardWireShape`) and is not part of `schema.json`'s measured content
 * either — `core/codegen/src/budget/gate.ts`'s `measureTool` makes the same
 * choice, for the same reason ("this gate measures what a client actually
 * receives over the wire, not codegen bookkeeping"). A live draft has no
 * real `manifestSha256`/`codegenVersion` yet (it is not on disk), so this is
 * a placeholder, never a fabricated hash.
 */
const DRAFT_PROVENANCE: ProvenanceInfo = {
  manifestPath: '(unsaved draft)',
  manifestSha256: '',
  codegenVersion: 'draft',
};

export interface LivePreview {
  readonly label: string;
  readonly json: Record<string, unknown>;
  readonly tokens: number;
  /** `undefined` means 02 §5.3 declares no budget for this representation (the generated schema). */
  readonly budget: number | undefined;
  readonly withinBudget: boolean;
}

function preview(label: string, json: Record<string, unknown>, budget: number | undefined): LivePreview {
  const tokens = countTokens(JSON.stringify(json));
  return { label, json, tokens, budget, withinBudget: budget === undefined || tokens <= budget };
}

export interface BuildPreviews {
  readonly toolView: ToolView;
  readonly card: LivePreview;
  readonly resident: LivePreview;
  readonly describe: LivePreview;
  readonly schema: LivePreview;
}

/** Build every live preview for one draft's YAML text. Never throws. */
export function buildPreviews(yamlText: string): BuildPreviews {
  let doc: unknown = {};
  try {
    doc = parseYaml(yamlText) ?? {};
  } catch {
    doc = {};
  }
  const tool = readTool(doc);

  const card = cardWireShape(buildDiscoveryCard(tool, DRAFT_PROVENANCE));
  const resident = buildResidentDefinition(tool);
  const describe = buildDescribeResponse(tool);
  const schema = buildSchemaJson(tool, DRAFT_PROVENANCE);

  return {
    toolView: tool,
    card: preview('Card (forge.find)', card, TOKEN_BUDGETS.card),
    resident: preview('Resident definition (tools/list)', resident, TOKEN_BUDGETS.residentHard),
    describe: preview('Full description (forge.describe)', describe, TOKEN_BUDGETS.describe),
    schema: preview('Generated JSON Schema (schema.json)', schema, undefined),
  };
}
