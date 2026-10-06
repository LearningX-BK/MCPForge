'use server';
// MCPForge — W0-Q9: the portal's model-assisted authoring actions. Server-only.
// Note: docs/build-plan/w0-q8-assisted-authoring.md.
//
// The provider key is never read here: `@mcpforge/adapter-model` dereferences it
// inside `adapters/**`. These actions hand it a SecretStore and the overlay
// config and relay a closed-taxonomy result. A suggestion is only TEXT; the
// browser never receives a patch, and acceptance is a separate act that applies
// the text to exactly one allow-listed field and stamps the acceptor from the
// signed-in session (never from the request).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  UNCONFIGURED,
  applySuggestion,
  authoringEnabled,
  checkSuggestion,
  createModel,
  parseAuthoringConfig,
  previewPayload,
  provenancePath,
  recordAcceptance,
  selectProvider,
  suggestField,
  type AuthoringConfig,
  type FieldTarget,
  type Provenance,
  type RequestBusiness,
  type SiblingTool,
} from '@mcpforge/adapter-model';
import { loadManifestFiles } from '@mcpforge/codegen/validate';
import { EncryptedFileStore } from '@mcpforge/gateway/secrets/server';
import { parse as parseYaml } from 'yaml';

import { getViewer } from '@/lib/viewer/session';
import { gateSaveOrPropose } from '@/lib/viewer/gates';
import { resolveRepoRoot, resolveRuntimeRoot } from '../_lib/repo-root';

export interface AuthoringStatus {
  readonly enabled: boolean;
  readonly providers: readonly { readonly id: string; readonly kind: string; readonly available: boolean }[];
  readonly defaultProvider: string | null;
}

export interface SuggestPayload {
  readonly yaml: string;
  readonly field: string;
  readonly inputName?: string | undefined;
  readonly providerId?: string | undefined;
  /** The linked intake request's business half, when the draft came from one. */
  readonly request?: RequestBusiness | undefined;
}

export type ActionFailure = { readonly ok: false; readonly code: string; readonly message: string; readonly next: string };

const DEPLOYMENT = (): string => process.env['MCPFORGE_DEPLOYMENT'] ?? 'local';

function loadConfig(): AuthoringConfig {
  const file = join(resolveRepoRoot(), 'overlays', DEPLOYMENT(), 'authoring.yaml');
  if (!existsSync(file)) return UNCONFIGURED;
  const parsed = parseAuthoringConfig(readFileSync(file, 'utf8'));
  // A broken overlay is treated as not configured: the feature is absent, never half-on.
  return parsed.ok ? parsed.config : UNCONFIGURED;
}

const store = (): EncryptedFileStore => new EncryptedFileStore({ repoRoot: resolveRuntimeRoot() });

function draftOf(payload: SuggestPayload): { doc: Record<string, unknown>; siblings: SiblingTool[] } | undefined {
  const doc = parseYaml(payload.yaml) as Record<string, unknown> | null;
  if (doc === null || typeof doc !== 'object') return undefined;
  const key = `${String(doc['app'])}.${String(doc['module'])}.${String(doc['entity'])}`;
  const siblings: SiblingTool[] = [];
  for (const m of loadManifestFiles(resolveRepoRoot())) {
    const d = m.doc as Record<string, unknown> | null | undefined;
    if (d?.['kind'] !== 'Tool' || typeof d['id'] !== 'string' || d['id'] === doc['id']) continue;
    if (`${String(d['app'])}.${String(d['module'])}.${String(d['entity'])}` === key) {
      siblings.push({ id: d['id'], purpose: typeof d['purpose'] === 'string' ? d['purpose'] : '' });
    }
  }
  return { doc, siblings };
}

/** Whether to show any authoring affordance at all. Absent, not broken, when it is off. */
export async function authoringStatus(): Promise<AuthoringStatus> {
  const config = loadConfig();
  if (!authoringEnabled(config)) return { enabled: false, providers: [], defaultProvider: null };
  const providers = await Promise.all(
    config.providers.map(async (p) => ({
      id: p.id,
      kind: p.kind,
      available: (await createModel(p, { secrets: store() })).available,
    })),
  );
  return { enabled: true, providers, defaultProvider: config.default ?? config.providers[0]?.id ?? null };
}

function target(p: SuggestPayload): FieldTarget {
  return { field: p.field as FieldTarget['field'], ...(p.inputName === undefined ? {} : { inputName: p.inputName }) };
}

const signedIn = async (): Promise<{ subject: string } | ActionFailure> => {
  const viewer = await getViewer();
  const gate = gateSaveOrPropose(viewer);
  if (!gate.allowed || viewer === null) {
    return { ok: false, code: 'CHANGE_SIGN_IN_REQUIRED', message: 'You are not signed in.', next: 'Sign in, then ask for a suggestion again.' };
  }
  return { subject: viewer.subject };
};

/** §4 "show before send": exactly what would be sent. Nothing is sent. */
export async function authoringPreview(
  payload: SuggestPayload,
): Promise<{ ok: true; provider: string; system: string; user: string } | ActionFailure> {
  const who = await signedIn();
  if ('ok' in who) return who;
  const draft = draftOf(payload);
  if (draft === undefined) return { ok: false, code: 'INPUT_INVALID', message: 'The draft is not valid YAML.', next: 'Fix the YAML, then try again.' };
  const r = previewPayload({
    config: loadConfig(),
    target: target(payload),
    draft: { ...draft, ...(payload.request === undefined ? {} : { request: payload.request }) },
    ...(payload.providerId === undefined ? {} : { providerId: payload.providerId }),
  });
  return r.ok ? { ok: true, provider: r.provider, system: r.system, user: r.user } : r;
}

export async function authoringSuggest(
  payload: SuggestPayload,
): Promise<{ ok: true; text: string; provenance: Provenance } | ActionFailure> {
  const who = await signedIn();
  if ('ok' in who) return who;
  const draft = draftOf(payload);
  if (draft === undefined) return { ok: false, code: 'INPUT_INVALID', message: 'The draft is not valid YAML.', next: 'Fix the YAML, then try again.' };
  const r = await suggestField(
    {
      config: loadConfig(),
      target: target(payload),
      draft: { ...draft, ...(payload.request === undefined ? {} : { request: payload.request }) },
      ...(payload.providerId === undefined ? {} : { providerId: payload.providerId }),
    },
    { secrets: store() },
  );
  return r.ok ? { ok: true, text: r.text, provenance: r.provenance } : r;
}

/**
 * A person accepts ONE field. The text is re-gated and applied to exactly that
 * path server-side, and the acceptor is the session. Returns the new YAML and the
 * updated provenance sidecar for the draft's Save draft to carry.
 */
export async function authoringAccept(
  payload: SuggestPayload & { readonly text: string; readonly provenance: Provenance; readonly provenanceYaml?: string | undefined },
): Promise<{ ok: true; yaml: string; provenanceYaml: string; provenancePath: string } | ActionFailure> {
  const who = await signedIn();
  if ('ok' in who) return who;
  const draft = draftOf(payload);
  if (draft === undefined) return { ok: false, code: 'INPUT_INVALID', message: 'The draft is not valid YAML.', next: 'Fix the YAML, then try again.' };
  const toolId = typeof draft.doc['id'] === 'string' ? draft.doc['id'] : undefined;
  if (toolId === undefined) return { ok: false, code: 'INPUT_INVALID', message: 'The draft has no tool id.', next: 'Give the tool an id, then accept the field.' };
  // The accepted text must be one a provider of this overlay could have produced: re-check the gate here, not only at suggest time.
  const gated = checkSuggestion(target(payload), payload.text, draft);
  if (!gated.ok) return gated;
  const picked = selectProvider(loadConfig(), payload.provenance.provider);
  if (!picked.ok) return picked;
  const applied = applySuggestion(payload.yaml, target(payload), gated.text);
  if (!applied.ok) return applied;
  return {
    ok: true,
    yaml: applied.yaml,
    provenanceYaml: recordAcceptance(
      payload.provenanceYaml,
      toolId,
      target(payload),
      payload.provenance,
      who.subject,
      new Date().toISOString(),
    ),
    provenancePath: provenancePath(toolId),
  };
}
