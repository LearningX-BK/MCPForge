// MCPForge — W0-J13: the three agent-facing representations, built from a
// `ToolManifest` for the Agent view (03 §10.4).
//
// The CARD shape mirrors `core/codegen/src/templates/card.ts`'s
// `buildDiscoveryCard` field-for-field, verified against
// `palette/card-fields.ts`'s comment ("Field names verified against the real
// generator ... `id`, `purpose`, `verb`, `entity`, `write`, `binding`,
// `sensitivity`, `roles`, `status`") and against `@mcpforge/shared`'s own
// golden-file token test, which pins the identical field set and order to
// exactly 57 tokens. The RESIDENT and DESCRIBE shapes are not generated
// anywhere the portal can import (codegen is not a portal dependency — see
// `core/gateway/meta/types.ts`'s file header, "THE SEAMS BELOW EXIST BECAUSE
// THE GATEWAY MAY NOT IMPORT CODEGEN"), so they are built here as
// plausible representative shapes of `tools/list`'s resident definition and
// `forge.describe`'s full payload (02 §5.3(b)/(c)), from real manifest
// fields only — never invented copy. This is the same judgment call
// `write-path/types.ts` documents for the whole write-path component family:
// prop/data-driven now, a mapping (not a redesign) once the real codegen
// artefacts are readable from the portal.
import { countTokens, type ToolManifest } from '@mcpforge/shared';

export interface AgentRepresentation {
  readonly label: string;
  readonly json: Record<string, unknown>;
  readonly tokens: number;
  readonly budget: number;
  readonly withinBudget: boolean;
}

function asRepresentation(label: string, json: Record<string, unknown>, budget: number): AgentRepresentation {
  const tokens = countTokens(JSON.stringify(json));
  return { label, json, tokens, budget, withinBudget: tokens <= budget };
}

/** What `forge.find` returns — the ≤60-token card. */
export function buildCard(manifest: ToolManifest): AgentRepresentation {
  const json = {
    id: manifest.id,
    purpose: manifest.purpose,
    verb: manifest.verb,
    entity: manifest.entity,
    write: manifest.write,
    binding: manifest.binding.type,
    sensitivity: manifest.sensitivity,
    roles: manifest.coreForRoles ?? [],
    status: 'unresolved',
  };
  return asRepresentation('Card (forge.find)', json, 60);
}

/** What `tools/list` carries for a resident tool — ≤200 typical / 400 hard. */
export function buildResidentDefinition(manifest: ToolManifest): AgentRepresentation {
  const json = {
    name: manifest.id,
    description: manifest.purpose,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(
        manifest.input.map((i) => [i.name, { type: i.type, description: i.desc }]),
      ),
      required: manifest.input.filter((i) => i.required).map((i) => i.name),
    },
  };
  return asRepresentation('Resident definition (tools/list)', json, 200);
}

/** What `forge.describe` returns — the full ≤600-token payload (02 §5.3(c)). */
export function buildDescribePayload(manifest: ToolManifest): AgentRepresentation {
  const json: Record<string, unknown> = {
    id: manifest.id,
    version: manifest.version,
    purpose: manifest.purpose,
    disambiguation: manifest.disambiguation ?? null,
    write: manifest.write,
    binding: { type: manifest.binding.type, identityCarries: manifest.binding.identity.carries },
    sensitivity: manifest.sensitivity,
    input: manifest.input,
    output: manifest.output,
    ...(manifest.writeSafety
      ? {
          writeSafety: {
            dryRunStrategy: manifest.writeSafety.dryRun.strategy,
            planTemplate: manifest.writeSafety.confirm.planTemplate,
            reversalClass: manifest.writeSafety.reversal.class,
            humanApprovalRequired: manifest.writeSafety.humanApprovalRequired,
          },
        }
      : {}),
  };
  return asRepresentation('Full description (forge.describe)', json, 600);
}
