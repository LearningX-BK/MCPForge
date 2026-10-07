// MCPForge — W0-Q9: suggested eval intents. Note §6.
//
// CLAUDE.md §4: `evals/` is authored by module STEWARDS, not tool authors, so a
// model is never the author of record. Three structural rules here:
//
//  1. Candidates go to a SUGGESTIONS file under the proposal, never to `evals/`.
//  2. The intents call is SEPARATE from the copy call and is given a context that
//     excludes the draft's agent-facing copy (purpose, aliases, disambiguation,
//     plan text), so a model cannot write copy that its own intents then flatter.
//  3. Promotion into `evals/` is refused unless the promoter IS the module's
//     named steward, and the record names them.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { selectProvider, sensitivityAllowed, type AuthoringConfig } from './config.js';
import { createModel, type ProviderDeps } from './providers.js';
import type { RequestBusiness } from './payload.js';
import {
  failure,
  type AuthoringModel,
  type Prompt,
  type Provenance,
  type SuggestFailure,
} from './types.js';

export interface IntentCandidate {
  readonly utterance: string;
  readonly expectedTool: string;
}

export interface IntentsInput {
  readonly config: AuthoringConfig;
  readonly toolId: string;
  readonly app: string;
  readonly module: string;
  readonly entity: string;
  readonly verb: string;
  readonly sensitivity: string;
  readonly request?: RequestBusiness;
  readonly providerId?: string;
}

/** Deliberately NOT built from the draft's copy fields. */
export function intentsPrompt(i: IntentsInput): Prompt {
  const lines = [
    `Tool id: ${i.toolId}`,
    `Area: ${i.app} / ${i.module} / ${i.entity} / ${i.verb}`,
    ...(i.request === undefined ? [] : [`What the requester asked for: ${i.request.does}`]),
  ];
  return {
    system:
      'You write realistic questions a business user would type to an assistant. Reply with 10 lines, one question per line, no numbering, no quotes, nothing else.',
    user: ['Write 10 different ways a user might ask for this capability.', '', ...lines].join(
      '\n',
    ),
  };
}

export function parseCandidates(raw: string, toolId: string): IntentCandidate[] {
  return raw
    .split(/[\r\n]+/)
    .map((l) =>
      l
        .replace(/^[-*\d.)\s]+/, '')
        .replace(/^["'`]|["'`]$/g, '')
        .trim(),
    )
    .filter((l) => l.length > 0 && l.length <= 240)
    .slice(0, 10)
    .map((utterance) => ({ utterance, expectedTool: toolId }));
}

export async function suggestIntents(
  input: IntentsInput,
  deps: ProviderDeps,
  model?: AuthoringModel,
): Promise<{ ok: true; candidates: IntentCandidate[]; provenance: Provenance } | SuggestFailure> {
  const picked = selectProvider(input.config, input.providerId);
  if (!picked.ok) return picked;
  const blocked = sensitivityAllowed(picked.provider, input.sensitivity);
  if (blocked !== undefined) return blocked;
  const adapter = model ?? (await createModel(picked.provider, deps));
  if (!adapter.available) {
    return failure(
      'AUTHORING_PROVIDER_UNAVAILABLE',
      `Provider "${picked.provider.id}" is not available.`,
      `Store its key with "forge secrets put ${picked.provider.keyRef}", or choose another configured provider (--provider on the CLI, the Provider chooser in the portal).`,
    );
  }
  const r = await adapter.complete(intentsPrompt(input));
  if (!r.ok) return r;
  const candidates = parseCandidates(r.text, input.toolId);
  if (candidates.length === 0) {
    return failure(
      'AUTHORING_RESPONSE_UNRECOGNISED',
      'No usable intents were returned.',
      'Nothing was written. Ask again, or author the intents by hand.',
    );
  }
  return { ok: true, candidates, provenance: r.provenance };
}

/** The file a proposal carries. `.mcpforge/proposals/<id>/suggested-intents.yaml`: never `evals/`. */
export function suggestedIntentsYaml(
  toolId: string,
  candidates: readonly IntentCandidate[],
  provenance: Provenance,
): string {
  return stringifyYaml(
    {
      apiVersion: 'mcpforge/v1',
      kind: 'SuggestedIntents',
      toolId,
      note: 'Suggestions only. The module steward promotes an intent into evals/ by name; a model is never the author of record.',
      provenance,
      candidates,
    },
    { lineWidth: 0 },
  );
}

export type PromoteResult =
  { ok: true; intentsYaml: string } | { ok: false; message: string; next: string };

/** Append one candidate to an `evals/<server>/intents.yaml` document, as the named steward only. */
export function promoteIntent(
  intentsYaml: string,
  candidate: IntentCandidate,
  promoter: string,
  steward: string,
  promotedAt: string,
): PromoteResult {
  if (promoter !== steward) {
    return {
      ok: false,
      message: `Only the module steward (${steward}) may promote an intent into evals/; ${promoter} is not the steward.`,
      next: `Ask ${steward} to promote it, or have ${steward} be recorded as the steward of this module through a change proposal.`,
    };
  }
  const doc = (parseYaml(intentsYaml) as { intents?: Record<string, unknown>[] } | null) ?? {};
  const intents = [
    ...(doc.intents ?? []),
    {
      utterance: candidate.utterance,
      expectedTool: candidate.expectedTool,
      authoredBy: promoter,
      promotedFromSuggestion: true,
      promotedAt,
    },
  ];
  return { ok: true, intentsYaml: stringifyYaml({ ...doc, intents }, { lineWidth: 0 }) };
}
