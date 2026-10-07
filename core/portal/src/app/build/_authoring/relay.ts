// MCPForge — W0-Q9b: the Suggest panel's relay to the gateway's authoring
// endpoints (D7 of docs/build-plan/w0-q8-assisted-authoring.md). Server-only.
//
// The portal holds no provider key, opens no secret store and imports no model
// adapter: status, suggestions and acceptance are the gateway's, made as the
// signed-in viewer through the portal's registered consumer (the read client's
// two-halves request). This module only maps the gateway's answer onto the
// panel's closed result shape, and keeps the draft's provenance sidecar.
//
// It never sends an acceptor or provenance: the gateway takes the acceptor from
// the token and the provenance from the suggestion's audit row.
//
// Kept apart from `actions.ts` so tests can inject the read client's deps
// (fetch, token, consumer headers). The server actions never take deps from a
// caller: a browser-supplied base URL would carry the viewer's token elsewhere.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { AuthoringAcceptedField, AuthoringSuggestRequest } from '@mcpforge/shared/api/v1';

import {
  START_GATEWAY_COMMAND,
  acceptAuthoring,
  readAuthoringStatus,
  suggestAuthoring,
  type ReadDeps,
  type ReadResult,
} from '@/lib/gateway-client/read-client';

export interface AuthoringStatus {
  readonly enabled: boolean;
  readonly providers: readonly { readonly id: string; readonly kind: string; readonly available: boolean }[];
  readonly defaultProvider: string | null;
}

/** The linked intake request's business half, when the draft came from one. */
export interface RequestBusiness {
  readonly does: string;
  readonly goodAnswer?: string | undefined;
  readonly inputs?: readonly string[] | undefined;
}

export interface SuggestPayload {
  readonly yaml: string;
  readonly field: string;
  readonly inputName?: string | undefined;
  readonly providerId?: string | undefined;
  readonly request?: RequestBusiness | undefined;
}

export interface AcceptPayload {
  readonly yaml: string;
  readonly field: string;
  readonly inputName?: string | undefined;
  readonly text: string;
  /** The audit call id the suggestion came back with. */
  readonly suggestionId: string;
  /** The draft's sidecar so far. Kept by the portal; never sent to the gateway. */
  readonly provenanceYaml?: string | undefined;
}

export type ActionFailure = { readonly ok: false; readonly code: string; readonly message: string; readonly next: string };

export interface Provenance {
  readonly provider: string;
  readonly model: string;
  readonly requestId: string;
}

const ABSENT: AuthoringStatus = { enabled: false, providers: [], defaultProvider: null };

/** Absent, not broken (note §7): any answer but a clean `enabled` hides the panel. */
export async function relayStatus(deps: ReadDeps = {}): Promise<AuthoringStatus> {
  const r = await readAuthoringStatus(deps);
  if (r.kind !== 'ok' || !r.data.enabled) return ABSENT;
  return { enabled: true, providers: r.data.providers, defaultProvider: r.data.defaultProvider };
}

/** Show before send (D7.2): the gateway's own payload. Nothing is sent and nothing is audited. */
export async function relayPreview(
  payload: SuggestPayload,
  deps: ReadDeps = {},
): Promise<{ ok: true; provider: string; system: string; user: string } | ActionFailure> {
  const r = await suggestAuthoring({ ...suggestBody(payload), dryRun: true }, deps);
  if (r.kind !== 'ok') return failureOf(r);
  if (!r.data.dryRun) return contractMismatch();
  return { ok: true, provider: r.data.provider, system: r.data.system, user: r.data.user };
}

export async function relaySuggest(
  payload: SuggestPayload,
  deps: ReadDeps = {},
): Promise<{ ok: true; text: string; provenance: Provenance; suggestionId: string } | ActionFailure> {
  const r = await suggestAuthoring(suggestBody(payload), deps);
  if (r.kind !== 'ok') return failureOf(r);
  if (r.data.dryRun) return contractMismatch();
  return { ok: true, text: r.data.text, provenance: r.data.provenance, suggestionId: r.data.suggestionId };
}

/**
 * A person accepts ONE field. The gateway re-gates the text, applies it to
 * exactly that path and names the acceptor; this adds that one entry to the
 * draft's sidecar for Save draft to carry.
 */
export async function relayAccept(
  payload: AcceptPayload,
  deps: ReadDeps = {},
): Promise<{ ok: true; yaml: string; provenanceYaml: string; provenancePath: string } | ActionFailure> {
  const r = await acceptAuthoring(
    {
      yaml: payload.yaml,
      field: payload.field,
      ...(payload.inputName === undefined ? {} : { inputName: payload.inputName }),
      text: payload.text,
      suggestionId: payload.suggestionId,
    },
    deps,
  );
  if (r.kind !== 'ok') return failureOf(r);
  const toolId = r.data.provenancePath.replace(/^provenance\//, '').replace(/\.authoring\.yaml$/, '');
  return {
    ok: true,
    yaml: r.data.yaml,
    provenanceYaml: mergeAcceptedField(payload.provenanceYaml, toolId, r.data.accepted),
    provenancePath: r.data.provenancePath,
  };
}

/**
 * The provenance sidecar (`provenance/<toolId>.authoring.yaml`, W0-Q9 note
 * §11.2): one entry per accepted field. Re-accepting a field replaces its
 * entry, so the record states who accepted what is in the draft NOW. The entry
 * is exactly what the gateway returned; nothing here names an acceptor.
 */
export function mergeAcceptedField(
  existing: string | undefined,
  toolId: string,
  entry: AuthoringAcceptedField,
): string {
  let prior: AuthoringAcceptedField[] = [];
  if (existing !== undefined && existing.trim().length > 0) {
    try {
      const doc = parseYaml(existing) as { toolId?: unknown; fields?: unknown } | null;
      if (doc?.toolId === toolId && Array.isArray(doc.fields)) prior = doc.fields as AuthoringAcceptedField[];
    } catch {
      prior = [];
    }
  }
  const key = (f: { field: string; inputName?: string | undefined }): string => `${f.field}#${f.inputName ?? ''}`;
  const ordered: AuthoringAcceptedField = {
    field: entry.field,
    ...(entry.inputName === undefined ? {} : { inputName: entry.inputName }),
    provider: entry.provider,
    model: entry.model,
    requestId: entry.requestId,
    acceptedBy: entry.acceptedBy,
    acceptedAt: entry.acceptedAt,
  };
  const fields = [...prior.filter((f) => key(f) !== key(ordered)), ordered];
  return stringifyYaml({ apiVersion: 'mcpforge/v1', kind: 'AuthoringProvenance', toolId, fields }, { lineWidth: 0 });
}

function suggestBody(p: SuggestPayload): AuthoringSuggestRequest {
  const request =
    p.request === undefined || p.request.does.trim().length === 0
      ? undefined
      : {
          does: p.request.does,
          ...(p.request.goodAnswer === undefined || p.request.goodAnswer === '' ? {} : { goodAnswer: p.request.goodAnswer }),
          ...(p.request.inputs === undefined || p.request.inputs.length === 0 ? {} : { inputs: [...p.request.inputs] }),
        };
  return {
    yaml: p.yaml,
    field: p.field,
    ...(p.inputName === undefined ? {} : { inputName: p.inputName }),
    ...(p.providerId === undefined ? {} : { providerId: p.providerId }),
    ...(request === undefined ? {} : { request }),
  };
}

function failureOf(r: Exclude<ReadResult<unknown>, { kind: 'ok' }>): ActionFailure {
  switch (r.kind) {
    case 'signed-out':
      return {
        ok: false,
        code: 'CHANGE_SIGN_IN_REQUIRED',
        message: 'You are not signed in.',
        next: 'Sign in, then ask for the suggestion again.',
      };
    case 'gateway-down':
      return {
        ok: false,
        code: 'GATEWAY_UNREACHABLE',
        message: `The gateway at ${r.endpoint} did not answer, so no suggestion could be made.`,
        next: `Start the gateway (${START_GATEWAY_COMMAND}), then ask again. Nothing was written to your draft.`,
      };
    case 'not-found':
      return {
        ok: false,
        code: 'AUTHORING_NOT_SERVED',
        message: r.message,
        next: 'Restart the gateway with this deployment\'s overlay (overlays/<deployment>/authoring.yaml), or write the field by hand.',
      };
    case 'refused':
      return { ok: false, code: r.code, message: r.message, next: r.next };
  }
}

function contractMismatch(): ActionFailure {
  return {
    ok: false,
    code: 'CONTRACT_MISMATCH',
    message: 'The gateway answered a suggestion request with the wrong kind of answer.',
    next: 'The portal and gateway are from different builds. Rebuild and restart both from the same checkout.',
  };
}
