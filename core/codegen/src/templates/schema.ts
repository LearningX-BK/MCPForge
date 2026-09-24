// MCPForge — artefact 1/6: `generated/tools/<id>/schema.json`. W0-B6.
// Reads: 02 §2.3 (artefact table), §3.1.1 (the `confirm` field), §5.3(b)
// (resident-definition schema rules: one-line ≤12-word param descriptions,
// no nesting deeper than two levels, enums >12 values become `enumRef`
// rather than inlined).
//
// Draft 2020-12, the same draft `core/codegen/src/schema/index.ts` compiles
// the manifest schemas against (02 §2.3 names the draft explicitly).

import type { ProvenanceInfo } from '../emit/provenance.js';
import { provenanceJsonFields } from '../emit/provenance.js';
import type { ToolView, ViewInput } from './manifest-view.js';

function jsonSchemaType(type: string): string {
  // Manifest `type` is one of INPUT_TYPES (string/number/integer/boolean) —
  // already exactly JSON Schema's own vocabulary for those four.
  return type;
}

/**
 * One input's JSON Schema property. `enumRef` is NOT inlined (02 §5.3(b) —
 * "enums longer than 12 values become enumRef and are fetched via a lookup
 * tool, not inlined"); this generator does not distinguish long vs. short
 * enumRef-declared enums by re-reading the enum file's length (that file
 * lives under `enums/**`, outside this tool's own manifest, and re-deriving
 * it here would make schema.json's shape depend on a second file changing
 * without this tool's own manifest changing — the opposite of the
 * `manifest-sha256` provenance contract). JUDGMENT CALL, documented rather
 * than guessed: every `enumRef` is treated as look-up-only in the generated
 * schema (a plain `string`, annotated with the non-standard `x-enumRef`
 * vendor field so a client can still discover which lookup tool to call) —
 * an inline `enum` on the manifest is still inlined directly, since that is
 * a bounded, already-short list by construction (`forge validate`'s
 * `inline-enum-too-long` rule is what enforces the length ceiling upstream).
 */
function inputProperty(input: ViewInput): Record<string, unknown> {
  const prop: Record<string, unknown> = {
    type: jsonSchemaType(input.type),
    description: input.desc,
  };
  if (input.minimum !== undefined) prop['minimum'] = input.minimum;
  if (input.maximum !== undefined) prop['maximum'] = input.maximum;
  if (input.format !== undefined) prop['format'] = input.format;
  if (input.example !== undefined) prop['examples'] = [input.example];
  if (input.enumRef !== undefined) {
    prop['x-enumRef'] = input.enumRef;
  } else if (input.enum !== undefined && input.enum.length > 0) {
    prop['enum'] = input.enum;
  }
  return prop;
}

/**
 * The `confirm` field, 02 §3.1.1 verbatim: "Omit or null to PLAN (no change
 * is made). Pass the confirmToken returned by the plan to EXECUTE." Present
 * only on write tools — a read tool has nothing to confirm.
 */
function confirmProperty(): Record<string, unknown> {
  return {
    type: ['string', 'null'],
    description:
      'Omit or null to PLAN (no change is made). Pass the confirmToken returned by the plan to EXECUTE.',
  };
}

/** Build the draft-2020-12 input schema object for one tool. Not yet serialized/formatted. */
export function buildSchemaJson(
  tool: ToolView,
  provenance: ProvenanceInfo,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const input of tool.input) {
    properties[input.name] = inputProperty(input);
    if (input.required) required.push(input.name);
  }
  if (tool.write) {
    properties['confirm'] = confirmProperty();
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://mcpforge.ltm/schema/generated/tools/${tool.id}/schema.json`,
    title: `${tool.id} input`,
    type: 'object',
    properties,
    required,
    additionalProperties: false,
    ...provenanceJsonFields(provenance),
  };
}
