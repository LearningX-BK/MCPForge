// MCPForge — artefact 2/6: `generated/tools/<id>/tool.ts`. W0-B6.
// 02 §2.3: "the object the gateway registers, carrying sensitivity, write
// flag, guardrails, role tags, budget accounting". Sourced entirely from the
// manifest — no policy decision is made here, only transcription into the
// shape the gateway's registry consumes.

import { countTokens } from '@mcpforge/shared/tokens';
import type { ProvenanceInfo } from '../emit/provenance.js';
import { provenanceCommentHeader } from '../emit/provenance.js';
import { formatTsDeterministic } from '../emit/writer.js';
import type { ToolView } from './manifest-view.js';
import { buildResidentDefinition } from './resident-definition.js';

function jsonLiteral(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * `generated/tools/<id>/tool.ts` source. A plain, typed `const` — no
 * behaviour, so there is nothing here for the hand-owned `binding.custom.ts`
 * to import from except the `Ctx`/`Args`/`Result` types, which live in
 * `handler.generated.ts` (02 §2.4's stub already fixes that import path).
 */
export async function buildToolRegistrationTs(
  tool: ToolView,
  provenance: ProvenanceInfo,
  repoRoot?: string,
): Promise<string> {
  const resident = buildResidentDefinition(tool);
  const residentTokens = countTokens(JSON.stringify(resident));

  const registration = {
    id: tool.id,
    version: tool.version,
    title: tool.title,
    purpose: tool.purpose,
    verb: tool.verb,
    entity: tool.entity,
    app: tool.app,
    module: tool.module,
    functionalArea: tool.functionalArea,
    processTags: tool.processTags,
    sensitivity: tool.sensitivity,
    write: tool.write,
    archetype: tool.archetype,
    coreForRoles: tool.coreForRoles,
    binding: {
      type: tool.bindingType,
      technology: tool.bindingTechnology,
      ref: tool.bindingRef,
      refVersion: tool.bindingRefVersion,
      identityCarries: tool.identityCarries,
      custom: tool.bindingCustom,
    },
    writeSafety: tool.writeSafety
      ? {
          dryRunStrategy: tool.writeSafety.dryRunStrategy,
          humanApprovalRequired: tool.writeSafety.humanApprovalRequired,
          reversalClass: tool.writeSafety.reversalClass,
          reversalTool: tool.writeSafety.reversalTool,
          idempotencyScopeHours: tool.writeSafety.idempotencyScopeHours,
          guardrails: tool.writeSafety.guardrails,
        }
      : null,
    governance: {
      reviewPath: tool.reviewPath,
      owner: tool.owner,
      steward: tool.steward,
      policyException: tool.policyException,
    },
    // Budget accounting (02 §2.3, §5.3): the resident-definition token count
    // this tool contributes to a role's ≤1,300-token core-set budget, counted
    // with the same pinned tokenizer `forge validate`'s role-budget rule uses
    // (core/shared/src/tokens — W0-A4), not re-guessed here.
    residentTokenCount: residentTokens,
  } as const;

  const source = [
    provenanceCommentHeader(provenance),
    '',
    "import type { ErrorCode } from '@mcpforge/shared/errors';",
    '',
    '/** The gateway-registration object for this tool. See core/gateway/registry (policy chain consumer). */',
    `export const toolRegistration = ${jsonLiteral(registration)} as const;`,
    '',
    'export type ToolRegistration = typeof toolRegistration;',
    '',
    '/** Every code this tool can return — the closed taxonomy (02 §3.1.5), unfiltered: any tool can hit AUTH_REQUIRED, INTERNAL, etc. */',
    'export type PossibleErrorCode = ErrorCode;',
    '',
  ].join('\n');

  return formatTsDeterministic(source, repoRoot);
}
