// MCPForge — artefact 5/6: `generated/docs/tools/<id>.md`. W0-B6.
// Human-readable documentation generated from the manifest. No behaviour
// lives here; it is a transcription, same as `tool.ts`.

import type { ProvenanceInfo } from '../emit/provenance.js';
import { provenanceLine1, provenanceLine2 } from '../emit/provenance.js';
import type { ToolView } from './manifest-view.js';

function inputRow(i: ToolView['input'][number]): string {
  const constraints: string[] = [];
  if (i.minimum !== undefined) constraints.push(`min ${i.minimum}`);
  if (i.maximum !== undefined) constraints.push(`max ${i.maximum}`);
  if (i.format !== undefined) constraints.push(`format ${i.format}`);
  if (i.enumRef !== undefined) constraints.push(`enumRef ${i.enumRef}`);
  if (i.enum !== undefined) constraints.push(`enum [${i.enum.join(', ')}]`);
  return `| \`${i.name}\` | ${i.type} | ${i.required ? 'yes' : 'no'} | ${i.desc} | ${constraints.join('; ') || '—'} |`;
}

function resultKeyRow(k: ToolView['resultKeys'][number]): string {
  return `| \`${k.name}\` | \`${k.path}\` |`;
}

/** Build the markdown document body (already the final content — Markdown has no formatter dependency here). */
export function buildDocsMarkdown(tool: ToolView, provenance: ProvenanceInfo): string {
  const lines: string[] = [
    `<!-- ${provenanceLine1(provenance)} -->`,
    `<!-- ${provenanceLine2(provenance)} -->`,
    '',
    `# ${tool.id}`,
    '',
    tool.title,
    '',
    `**Purpose:** ${tool.purpose}`,
    '',
    `- App / module / entity / verb: \`${tool.app}\` / \`${tool.module}\` / \`${tool.entity}\` / \`${tool.verb}\``,
    `- Archetype: \`${tool.archetype}\``,
    `- Sensitivity: \`${tool.sensitivity}\``,
    `- Write: \`${tool.write}\``,
    `- Binding type: \`${tool.bindingType}\` (\`${tool.bindingTechnology}\`, ref \`${tool.bindingRef}\`${tool.bindingRefVersion ? ` v${tool.bindingRefVersion}` : ''})`,
    `- Identity carries: \`${tool.identityCarries}\``,
    tool.coreForRoles.length > 0 ? `- Core tool for roles: ${tool.coreForRoles.map((r) => `\`${r}\``).join(', ')}` : '',
    '',
  ];

  if (tool.disambiguation) {
    lines.push('## Disambiguation', '', tool.disambiguation.trim(), '');
  }

  if (tool.aliases.length > 0) {
    lines.push('## Aliases', '', tool.aliases.map((a) => `- ${a}`).join('\n'), '');
  }

  lines.push(
    '## Inputs',
    '',
    '| Name | Type | Required | Description | Constraints |',
    '|---|---|---|---|---|',
    ...tool.input.map(inputRow),
    '',
  );

  if (tool.write) {
    lines.push('This is a **write tool**. Every call is two-phase (02 §3.1.1):', '');
    lines.push(
      "1. Call without `confirm` (or `confirm: null`) to PLAN — no change is made, and the response carries the plan text, a `confirmToken`, and the reversal contract.",
      '2. Show the plan to the human. If approved, call again with identical arguments plus `confirm: <confirmToken>` to EXECUTE.',
      '',
    );
  }

  lines.push(
    '## Output',
    '',
    `Summary template: \`${tool.summaryTemplate}\``,
    '',
    '| Result key | Path |',
    '|---|---|',
    ...tool.resultKeys.map(resultKeyRow),
    '',
  );

  if (tool.writeSafety) {
    const ws = tool.writeSafety;
    lines.push(
      '## Write safety',
      '',
      `- Dry-run strategy: \`${ws.dryRunStrategy}\`${ws.dryRunRef ? ` (ref \`${ws.dryRunRef}\`)` : ''}`,
      `- Confirm token TTL: ${ws.confirmTokenTtlSeconds}s`,
      `- Human approval required: \`${ws.humanApprovalRequired}\``,
      `- Reversal class: \`${ws.reversalClass}\`${ws.reversalTool ? ` -> \`${ws.reversalTool}\`` : ''}`,
      `- Idempotency scope: ${ws.idempotencyScopeHours}h`,
      '',
    );
    if (ws.guardrails.length > 0) {
      lines.push(
        '### Guardrails',
        '',
        ...ws.guardrails.map(
          (g) =>
            `- \`${g.kind}\`${g.field ? ` on \`${g.field}\`` : ''}${
              g.value !== undefined ? ` (${JSON.stringify(g.value)})` : ''
            }${g.message ? ` — ${g.message}` : ''}`,
        ),
        '',
      );
    }
    if (ws.planTemplate) {
      lines.push('### Plan template', '', ws.planTemplate.trim(), '');
    }
  }

  lines.push(
    '## Governance',
    '',
    `- Review path: \`${tool.reviewPath}\``,
    `- Owner: ${tool.owner}`,
    `- Steward: ${tool.steward}`,
    tool.policyException ? `- Policy exception: ${tool.policyException}` : '',
    '',
  );

  lines.push(
    'Every error path this tool can return carries a non-empty, agent-actionable `next` (02 §3.1.5); see the closed error taxonomy in `@mcpforge/shared/errors`.',
    '',
  );

  return lines.join('\n');
}
