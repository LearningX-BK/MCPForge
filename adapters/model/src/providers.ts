// MCPForge — W0-Q9: the provider adapters. THE ONLY PLACE A MODEL-PROVIDER KEY IS
// DEREFERENCED (note §3): `revealSecretValue()` appears here, in `adapters/**`,
// where the `no-secret-value-escape` rule allows it, and the revealed string goes
// straight into the outbound header. It is never stored, logged, put in an error
// message, or returned.
//
// Three kinds behind one interface: `blueverse` (the default; contract in note
// §2.2, taken from the WILL app's llm_client.py), `anthropic`, and
// `openai-compatible` (any OpenAI-style endpoint, including a local one).
//
// There is no fallback between providers: a failing provider returns a failure
// and the caller decides (note §2.1).

import { parseSecretRef, type SecretStore } from '@mcpforge/gateway/secrets';

import type { ProviderConfig } from './config.js';
import { renderPrompt } from './payload.js';
import {
  failure,
  type AuthoringModel,
  type Prompt,
  type SuggestFailure,
  type SuggestRequest,
  type SuggestResult,
} from './types.js';

export interface ProviderDeps {
  readonly secrets: SecretStore;
  readonly fetch?: typeof fetch;
  readonly newRequestId?: () => string;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function requestId(deps: ProviderDeps): string {
  return deps.newRequestId?.() ?? globalThis.crypto.randomUUID();
}

/** True when the key reference resolves in the store. Reads metadata only: never the value. */
async function keyPresent(provider: ProviderConfig, secrets: SecretStore): Promise<boolean> {
  try {
    await secrets.metadata(parseSecretRef(provider.keyRef));
    return true;
  } catch {
    return false;
  }
}

async function revealKey(
  provider: ProviderConfig,
  secrets: SecretStore,
): Promise<{ ok: true; key: string } | SuggestFailure> {
  try {
    const value = await secrets.get(parseSecretRef(provider.keyRef));
    return { ok: true, key: value.revealSecretValue() };
  } catch {
    return failure(
      'AUTHORING_KEY_MISSING',
      `No key is stored for provider "${provider.id}".`,
      `Store it with "forge secrets put ${provider.keyRef}" (the value is read from a prompt or stdin, never argv), then try again.`,
    );
  }
}

type PostResult = { ok: true; json: unknown; text: string } | SuggestFailure;

async function post(
  provider: ProviderConfig,
  deps: ProviderDeps,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<PostResult> {
  const doFetch = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (e) {
    return failure(
      'AUTHORING_PROVIDER_FAILED',
      `Provider "${provider.id}" could not be reached: ${e instanceof Error ? e.name : 'network error'}.`,
      `Check the network and the baseUrl in the overlay, or choose another provider with --provider (no provider is switched to automatically). Nothing was written.`,
    );
  }
  const text = await res.text();
  if (!res.ok) {
    return failure(
      'AUTHORING_PROVIDER_FAILED',
      `Provider "${provider.id}" answered HTTP ${res.status}.`,
      res.status === 401 || res.status === 403
        ? `The key for "${provider.id}" was refused. Rotate it with "forge secrets put ${provider.keyRef}", or choose another provider with --provider.`
        : `Try again later, or choose another provider with --provider (no provider is switched to automatically). Nothing was written.`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { ok: true, json, text };
}

// ---------------------------------------------------------------------------
// BlueVerse
// ---------------------------------------------------------------------------

const BLUEVERSE_KEYS = ['output', 'answer', 'response', 'text', 'result', 'message', 'content'];

function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * BlueVerse returns several shapes (WILL app's `_extract_blueverse_text`). Try the
 * known ones. UNLIKE that client there is NO "dump the whole JSON" fallback: an
 * unrecognised shape is a failure, because a JSON blob must never reach a draft
 * field looking like copy.
 */
export function extractBlueVerseText(data: unknown): string | undefined {
  if (typeof data === 'string') return nonEmpty(data);
  if (typeof data !== 'object' || data === null) return undefined;
  const d = data as Record<string, unknown>;
  for (const k of BLUEVERSE_KEYS) {
    const v = nonEmpty(d[k]);
    if (v !== undefined) return v;
  }
  for (const nest of ['data', 'result']) {
    const n = d[nest];
    if (typeof n === 'object' && n !== null) {
      for (const k of BLUEVERSE_KEYS) {
        const v = nonEmpty((n as Record<string, unknown>)[k]);
        if (v !== undefined) return v;
      }
    }
  }
  const choices = d['choices'];
  if (Array.isArray(choices)) {
    const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
    return nonEmpty(content);
  }
  return undefined;
}

function blueverse(provider: Extract<ProviderConfig, { kind: 'blueverse' }>, deps: ProviderDeps, present: boolean): CompleteModel {
  const configured = provider.spaceName.length > 0 && provider.flowId.length > 0;
  return {
    id: provider.id,
    available: present && configured,
    async complete(prompt: Prompt): Promise<SuggestResult> {
      if (!configured) {
        return failure(
          'AUTHORING_PROVIDER_UNAVAILABLE',
          `BlueVerse provider "${provider.id}" has no spaceName and flowId.`,
          'Set spaceName and flowId for the BlueVerse space and flow created for copy drafting, in overlays/<deployment>/authoring.yaml.',
        );
      }
      const key = await revealKey(provider, deps.secrets);
      if (!key.ok) return key;
      const { system, user } = prompt;
      // BlueVerse has no separate system field: the instructions travel in the query.
      const sent = await post(
        provider,
        deps,
        provider.baseUrl,
        { Authorization: `Bearer ${key.key}` },
        { query: `${system}\n\n${user}`, space_name: provider.spaceName, flowId: provider.flowId },
      );
      if (!sent.ok) return sent;
      const text = extractBlueVerseText(sent.json ?? sent.text);
      if (text === undefined) {
        return failure(
          'AUTHORING_RESPONSE_UNRECOGNISED',
          'BlueVerse returned a response shape this adapter does not recognise.',
          'Nothing was written. Check the flow returns its answer in a field such as output, answer or response, or choose another provider with --provider.',
        );
      }
      // BlueVerse selects the model inside the flow, so the model is the flow.
      return { ok: true, text, provenance: { provider: provider.id, model: `flow:${provider.flowId}`, requestId: requestId(deps) } };
    },
  };
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

function anthropic(provider: Extract<ProviderConfig, { kind: 'anthropic' }>, deps: ProviderDeps, present: boolean): CompleteModel {
  return {
    id: provider.id,
    available: present,
    async complete(prompt: Prompt): Promise<SuggestResult> {
      const key = await revealKey(provider, deps.secrets);
      if (!key.ok) return key;
      const { system, user } = prompt;
      const sent = await post(
        provider,
        deps,
        provider.baseUrl,
        { 'x-api-key': key.key, 'anthropic-version': '2023-06-01' },
        { model: provider.model, max_tokens: 512, system, messages: [{ role: 'user', content: user }] },
      );
      if (!sent.ok) return sent;
      const content = (sent.json as { content?: { type?: string; text?: unknown }[] } | undefined)?.content;
      const text = nonEmpty(content?.find((c) => c.type === 'text' || c.type === undefined)?.text);
      if (text === undefined) {
        return failure(
          'AUTHORING_RESPONSE_UNRECOGNISED',
          'The Anthropic response had no text content.',
          'Nothing was written. Try again, or choose another provider with --provider.',
        );
      }
      return { ok: true, text, provenance: { provider: provider.id, model: provider.model, requestId: requestId(deps) } };
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible
// ---------------------------------------------------------------------------

function openaiCompatible(provider: Extract<ProviderConfig, { kind: 'openai-compatible' }>, deps: ProviderDeps, present: boolean): CompleteModel {
  const url = provider.baseUrl.includes('completions')
    ? provider.baseUrl
    : `${provider.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  return {
    id: provider.id,
    available: present,
    async complete(prompt: Prompt): Promise<SuggestResult> {
      const key = await revealKey(provider, deps.secrets);
      if (!key.ok) return key;
      const { system, user } = prompt;
      const sent = await post(
        provider,
        deps,
        url,
        { Authorization: `Bearer ${key.key}` },
        {
          model: provider.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        },
      );
      if (!sent.ok) return sent;
      const content = (sent.json as { choices?: { message?: { content?: unknown } }[] } | undefined)
        ?.choices?.[0]?.message?.content;
      const text = nonEmpty(content);
      if (text === undefined) {
        return failure(
          'AUTHORING_RESPONSE_UNRECOGNISED',
          'The response had no choices[0].message.content.',
          'Nothing was written. Check the endpoint is OpenAI-compatible, or choose another provider with --provider.',
        );
      }
      return { ok: true, text, provenance: { provider: provider.id, model: provider.model, requestId: requestId(deps) } };
    },
  };
}

/** The low-level half each provider implements; `suggest` is derived from it once, below. */
type CompleteModel = Pick<AuthoringModel, 'id' | 'available' | 'complete'>;

/** Build the adapter for one overlay entry. `available` is false when its key is not in the store. */
export async function createModel(provider: ProviderConfig, deps: ProviderDeps): Promise<AuthoringModel> {
  const present = await keyPresent(provider, deps.secrets);
  const low: CompleteModel =
    provider.kind === 'blueverse'
      ? blueverse(provider, deps, present)
      : provider.kind === 'anthropic'
        ? anthropic(provider, deps, present)
        : openaiCompatible(provider, deps, present);
  return withSuggest(low);
}

/** A field suggestion is a completion of the prompt rendered from its request. */
export function withSuggest(low: CompleteModel): AuthoringModel {
  return {
    ...low,
    suggest: (request: SuggestRequest) => low.complete(renderPrompt(request)),
  };
}
