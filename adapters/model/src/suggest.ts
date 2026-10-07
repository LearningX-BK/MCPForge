// MCPForge — W0-Q9: one suggestion, end to end. Note §5.
//
//   provider selected (no silent fallback) -> sensitivity allowed -> field on the
//   allow-list -> payload built from the positive list -> model called ->
//   structural gate -> text returned.
//
// This returns a SUGGESTION. It does not write anything: a person accepts a field
// (`applySuggestion`), and the acceptance is what is recorded in provenance
// (./provenance.ts). There is no "accept all".

import { selectProvider, sensitivityAllowed, type AuthoringConfig } from './config.js';
import { checkSuggestion } from './gate.js';
import { buildSuggestRequest, renderPrompt, type DraftContext } from './payload.js';
import { createModel, type ProviderDeps } from './providers.js';
import {
  failure,
  type AuthoringModel,
  type FieldTarget,
  type Provenance,
  type SuggestFailure,
  type SuggestRequest,
} from './types.js';

export interface SuggestInput {
  readonly config: AuthoringConfig;
  readonly target: FieldTarget;
  readonly draft: DraftContext;
  /** Which overlay provider; the overlay default when omitted. */
  readonly providerId?: string;
}

export interface Suggestion {
  readonly ok: true;
  readonly target: FieldTarget;
  readonly text: string;
  readonly provenance: Provenance;
}

/** The authoring surfaces ask this to decide whether to show a "Suggest" affordance at all. */
export function authoringEnabled(config: AuthoringConfig): boolean {
  return config.enabled && config.providers.length > 0;
}

/** §4 "show before send": exactly what would leave the machine, and nothing is sent. */
export function previewPayload(
  input: SuggestInput,
):
  | { ok: true; provider: string; system: string; user: string; request: SuggestRequest }
  | SuggestFailure {
  const picked = selectProvider(input.config, input.providerId);
  if (!picked.ok) return picked;
  const built = buildSuggestRequest(input.target, input.draft);
  if (!built.ok) return built;
  const { system, user } = renderPrompt(built.request);
  return { ok: true, provider: picked.provider.id, system, user, request: built.request };
}

export async function suggestField(
  input: SuggestInput,
  deps: ProviderDeps,
  /** Injected for tests; the real path builds the adapter from the overlay entry. */
  model?: AuthoringModel,
): Promise<Suggestion | SuggestFailure> {
  const picked = selectProvider(input.config, input.providerId);
  if (!picked.ok) return picked;

  // Field allow-list first: a refused field never reaches a provider.
  const built = buildSuggestRequest(input.target, input.draft);
  if (!built.ok) return built;

  const sensitivity =
    typeof input.draft.doc['sensitivity'] === 'string'
      ? input.draft.doc['sensitivity']
      : 'internal';
  const blocked = sensitivityAllowed(picked.provider, sensitivity);
  if (blocked !== undefined) return blocked;

  const adapter = model ?? (await createModel(picked.provider, deps));
  if (!adapter.available) {
    return failure(
      'AUTHORING_PROVIDER_UNAVAILABLE',
      `Provider "${picked.provider.id}" is not available (no key stored, or it is not fully configured).`,
      `Store its key with "forge secrets put ${picked.provider.keyRef}", or choose another configured provider (--provider on the CLI, the Provider chooser in the portal). No provider is switched to automatically.`,
    );
  }

  const result = await adapter.suggest(built.request);
  if (!result.ok) return result;

  const gated = checkSuggestion(input.target, result.text, input.draft);
  if (!gated.ok) return gated;
  return { ok: true, target: input.target, text: gated.text, provenance: result.provenance };
}
