// MCPForge — `/api/v1/authoring/{status,suggest,accept}`: model-assisted
// authoring, served by the gateway. W0-Q9b.
//
// Decision D7 of docs/build-plan/w0-q8-assisted-authoring.md (owner, 7 Oct
// 2026: "1, plan it on Opus first", then "Yes, go ahead with all six as
// recommended"). The portal's Suggest panel used to open the secret store
// itself; now it relays here, so no portal process holds a provider key.
//
// WHO MAY. After the read API's front door has resolved a registered consumer
// AND a human (non-negotiable 6):
//
//  1. The consumer attests a human in its loop (D7.5). Authoring is a person's
//     act: an agent consumer gets no authoring endpoint at all, not even status.
//  2. The draft's sensitivity, taken as the HIGHER of the draft's own value and
//     the served catalogue's value for the same tool id (so a draft cannot lower
//     its sensitivity to get past the ceiling), is at or below the consumer's
//     `maxSensitivity`.
//  3. Any established Principal. The acceptor is that Principal's subject, and
//     no request may name one (the request schemas are `.strict()`).
//  4. Suggest is rate limited at the consumer's `limits.callsPerMinute`, per
//     subject (D7.3).
//
// WHAT IS RECORDED. Every attempt past the front door is ONE hash-chained
// `authoring` audit row, refusals included, except a successful `dryRun`
// (D7.2: it sends nothing and writes nothing) and a successful status read.
// The row carries the draft's tool id, the field, the provider, a byte count
// and, for a suggestion, the request id and a sha256 of the suggested text.
// NEVER the prompt, the response text or a key. A suggestion's row id is its
// `suggestionId`; accept is bound to it (D7.4).
//
// THE KEY. This module never dereferences a credential. It hands the gateway's
// `SecretStore` to `@mcpforge/adapter-model`, which is the only code that calls
// `get()` on it (non-negotiable 8, `no-secret-value-escape`).

import { createHash } from 'node:crypto';
import {
  applySuggestion,
  authoringEnabled,
  checkSuggestion,
  createModel,
  loadAuthoringConfig,
  previewPayload,
  provenancePath,
  selectProvider,
  siblingsOf,
  suggestField,
  type AuthoringConfig,
  type DraftContext,
  type FieldTarget,
  type SuggestErrorCode,
} from '@mcpforge/adapter-model';
import {
  AUTHORING_ACCEPT_PATH,
  AUTHORING_STATUS_PATH,
  AUTHORING_SUGGEST_PATH,
  authoringAcceptRequestSchema,
  authoringSuggestRequestSchema,
  type AuthoringAcceptResponse,
  type AuthoringStatusResponse,
  type AuthoringSuggestResponse,
} from '@mcpforge/shared/api/v1';
import { parse as parseYaml } from 'yaml';
import type { RuntimeCatalogue } from '../../assembly/catalogue.js';
import type { EstablishedSession } from '../../assembly/session.js';
import type { ConsumerCallRateLimiter } from '../../caps/consumer-quota.js';
import { sensitivityRank, sensitivityWithinCeiling } from '../../scope/sensitivity.js';
import type { SecretStore } from '../../secrets/index.js';
import type {
  AppendAuditCallInput,
  AuditCallRecord,
  AuditOutcome,
  AuditResultKey,
} from '../../store/audit/types.js';
import type { RuntimeStore } from '../../store/repository.js';
import { ApiRefusal } from './refusal.js';

export const AUTHORING_STATUS_TOOL_ID = 'forge.authoring.status';
export const AUTHORING_SUGGEST_TOOL_ID = 'forge.authoring.suggest';
export const AUTHORING_ACCEPT_TOOL_ID = 'forge.authoring.accept';

/** How long a suggestion stays acceptable (D7.4). One working session, not a day. */
export const AUTHORING_SUGGESTION_TTL_MS = 60 * 60 * 1000;

/** The gateway-only refusal when accept names no suggestion this person may accept. HTTP 409. */
export const AUTHORING_SUGGESTION_UNKNOWN = 'AUTHORING_SUGGESTION_UNKNOWN';

export type AuthoringRoute = 'status' | 'suggest' | 'accept';

/** Which authoring endpoint `pathname` is, if any. */
export function authoringRoute(pathname: string): AuthoringRoute | undefined {
  if (pathname === AUTHORING_STATUS_PATH) return 'status';
  if (pathname === AUTHORING_SUGGEST_PATH) return 'suggest';
  if (pathname === AUTHORING_ACCEPT_PATH) return 'accept';
  return undefined;
}

/** The method each endpoint serves. */
export const AUTHORING_METHOD: Readonly<Record<AuthoringRoute, 'GET' | 'POST'>> = {
  status: 'GET',
  suggest: 'POST',
  accept: 'POST',
};

/** The authoring seam the launch assembly provides. Absent: the endpoints are not served. */
export interface AuthoringSource {
  /** The gateway's own vault. Handed to the model adapter; never read here. */
  readonly secretStore: SecretStore;
  /** Where `manifests/` and `overlays/<deployment>/authoring.yaml` live. */
  readonly definitionsRoot: string;
  /** The overlay directory under `overlays/`. */
  readonly deployment: string;
  /** TEST ONLY: the provider transport. Production uses the global fetch. */
  readonly fetch?: typeof fetch;
  /** Provider timeout; the adapter's default (60 s) when absent. */
  readonly timeoutMs?: number;
}

export interface AuthoringDeps {
  readonly store: Pick<RuntimeStore, 'audit' | 'transaction'>;
  readonly source: AuthoringSource;
  /** The catalogue serving this request: the served sensitivity of a draft's tool id. */
  readonly catalogue: Pick<RuntimeCatalogue, 'entries'>;
  /** The consumer's declared `limits.callsPerMinute`; undefined when it has no record. */
  readonly callsPerMinute: (consumerId: string) => number | undefined;
  /** One per gateway process, keyed per consumer AND subject. */
  readonly rateLimiter: ConsumerCallRateLimiter;
  readonly gatewayVersion: string;
  readonly now: () => Date;
}

export interface AuthoringActor {
  readonly session: EstablishedSession;
  readonly subject: string;
  readonly correlationId: string;
}

type DeniedRule =
  | 'authoring.consumer_no_human'
  | 'authoring.consumer_unlimited'
  | 'authoring.sensitivity_above_ceiling'
  | 'authoring.acceptor_not_requestable'
  | 'authoring.input_invalid'
  | 'authoring.rate_limited'
  | 'authoring.suggestion_unknown'
  | 'authoring.refused';

/** What a row records about the request. Never the prompt, the response or a key. */
interface RowArgs {
  readonly draftToolId: string | null;
  readonly field: string | null;
  readonly inputName: string | null;
  readonly providerId: string | null;
  readonly bytesSent: number;
}

const NO_ARGS: RowArgs = {
  draftToolId: null,
  field: null,
  inputName: null,
  providerId: null,
  bytesSent: 0,
};

// --- status ------------------------------------------------------------------------

/** `GET /api/v1/authoring/status`. Reads key METADATA only, through the adapter. */
export async function authoringStatus(
  deps: AuthoringDeps,
  actor: AuthoringActor,
): Promise<AuthoringStatusResponse> {
  await requireHumanConsumer(deps, actor, AUTHORING_STATUS_TOOL_ID, NO_ARGS);
  const asOf = deps.now().toISOString();
  const config = loadConfig(deps.source);
  if (!config.ok || !authoringEnabled(config.config)) {
    // Absent, not broken (note §7): a broken overlay is not configured.
    return { asOf, enabled: false, providers: [], defaultProvider: null };
  }
  const providers = [];
  for (const p of config.config.providers) {
    const model = await createModel(p, providerDeps(deps.source));
    providers.push({ id: p.id, kind: p.kind, available: model.available });
  }
  return {
    asOf,
    enabled: true,
    providers,
    defaultProvider: config.config.default ?? config.config.providers[0]?.id ?? null,
  };
}

// --- suggest -----------------------------------------------------------------------

/**
 * `POST /api/v1/authoring/suggest`. A dry run returns exactly what would be
 * sent and writes nothing. Otherwise exactly one `authoring` row is committed
 * BEFORE the suggestion is returned, and its id is the `suggestionId`.
 */
export async function authoringSuggest(
  deps: AuthoringDeps,
  actor: AuthoringActor,
  readBody: () => Promise<unknown>,
): Promise<AuthoringSuggestResponse> {
  const toolId = AUTHORING_SUGGEST_TOOL_ID;
  // The consumer half first: an agent consumer's draft is not even read.
  await requireHumanConsumer(deps, actor, toolId, NO_ARGS);
  const body = await readRequestBody(deps, actor, toolId, readBody);
  const parsed = authoringSuggestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return refuseBadRequest(deps, actor, toolId, body, parsed.error.issues[0]);
  }
  const req = parsed.data;
  const doc = await parseDraft(deps, actor, toolId, req.yaml, req);
  const args: RowArgs = {
    draftToolId: typeof doc['id'] === 'string' ? doc['id'] : null,
    field: req.field,
    inputName: req.inputName ?? null,
    providerId: req.providerId ?? null,
    bytesSent: 0,
  };

  const sensitivity = await requireSensitivityWithinCeiling(deps, actor, toolId, args, doc);

  const loaded = await requireConfig(deps, actor, toolId, args);
  const target = targetOf(req);
  const draft: DraftContext = {
    // The higher sensitivity is what the provider's own gate sees too.
    doc: { ...doc, sensitivity },
    siblings: siblingsOf(deps.source.definitionsRoot, doc),
    ...(req.request === undefined ? {} : { request: businessOf(req.request) }),
  };
  const input = {
    config: loaded,
    target,
    draft,
    ...(req.providerId === undefined ? {} : { providerId: req.providerId }),
  };

  // What would leave the machine. Built from the gateway's own definitions root.
  const preview = previewPayload(input);
  if (!preview.ok) {
    await appendRefusal(
      deps,
      actor,
      toolId,
      args,
      preview.code,
      preview.message,
      'authoring.refused',
    );
    throw new ApiRefusal(preview.code, preview.message, preview.next);
  }
  const chosen: RowArgs = { ...args, providerId: preview.provider };
  if (req.dryRun === true) {
    // D7.2: show before send. Nothing is sent and no row is written.
    return {
      asOf: deps.now().toISOString(),
      dryRun: true,
      sent: false,
      provider: preview.provider,
      system: preview.system,
      user: preview.user,
      next: `Nothing was sent. Ask for the suggestion without dryRun to send exactly this to provider "${preview.provider}"; nothing else from the draft leaves the gateway.`,
    };
  }

  await requireWithinRate(deps, actor, toolId, chosen);

  const bytes = Buffer.byteLength(preview.system, 'utf8') + Buffer.byteLength(preview.user, 'utf8');
  const keyRef = loaded.providers.find((p) => p.id === preview.provider)?.keyRef;
  const result = await suggestField(input, providerDeps(deps.source));
  if (!result.ok) {
    const reached = PROVIDER_REACHED.has(result.code);
    await appendRow(deps, {
      ...baseRow(deps, actor, toolId, { ...chosen, bytesSent: reached ? bytes : 0 }, sensitivity),
      outcome: outcomeFor(result.code, result.message),
      errorCode: result.code,
      errorMessageAgent: result.message,
      deniedByRule: 'authoring.refused' satisfies DeniedRule,
      ...(reached && keyRef !== undefined
        ? { credentialRefs: [{ secretRef: keyRef, version: null }] }
        : {}),
    });
    throw new ApiRefusal(result.code, result.message, result.next);
  }

  // Evidence before effect: the row is committed before the text is returned.
  const recorded = await appendRow(deps, {
    ...baseRow(deps, actor, toolId, { ...chosen, bytesSent: bytes }, sensitivity),
    outcome: 'ok',
    resultKeys: [
      { keyName: 'requestId', keyValue: result.provenance.requestId },
      { keyName: 'provider', keyValue: result.provenance.provider },
      { keyName: 'model', keyValue: result.provenance.model },
      { keyName: 'textSha256', keyValue: sha256(result.text) },
    ],
    ...(keyRef === undefined ? {} : { credentialRefs: [{ secretRef: keyRef, version: null }] }),
  });
  return {
    asOf: deps.now().toISOString(),
    dryRun: false,
    suggestionId: recorded.id,
    field: target.field,
    inputName: target.inputName ?? null,
    text: result.text,
    provenance: result.provenance,
    next: 'This is a suggestion only and nothing in the draft has changed. Accept this one field to apply it, or write the field by hand.',
  };
}

// --- accept ------------------------------------------------------------------------

/**
 * `POST /api/v1/authoring/accept`. The text must be the one THIS person was
 * given for THIS field of THIS draft, recently; provenance is read from that
 * suggestion's audit row, and the acceptor is the session. One row per attempt.
 */
export async function authoringAccept(
  deps: AuthoringDeps,
  actor: AuthoringActor,
  readBody: () => Promise<unknown>,
): Promise<AuthoringAcceptResponse> {
  const toolId = AUTHORING_ACCEPT_TOOL_ID;
  await requireHumanConsumer(deps, actor, toolId, NO_ARGS);
  const body = await readRequestBody(deps, actor, toolId, readBody);
  const parsed = authoringAcceptRequestSchema.safeParse(body);
  if (!parsed.success) {
    return refuseBadRequest(deps, actor, toolId, body, parsed.error.issues[0]);
  }
  const req = parsed.data;
  const doc = await parseDraft(deps, actor, toolId, req.yaml, req);
  const draftToolId = typeof doc['id'] === 'string' && doc['id'].length > 0 ? doc['id'] : null;
  const args: RowArgs = {
    draftToolId,
    field: req.field,
    inputName: req.inputName ?? null,
    providerId: null,
    bytesSent: 0,
  };

  const sensitivity = await requireSensitivityWithinCeiling(deps, actor, toolId, args, doc);
  if (draftToolId === null) {
    await appendRefusal(
      deps,
      actor,
      toolId,
      args,
      'INPUT_INVALID',
      'The draft has no tool id.',
      'authoring.input_invalid',
    );
    throw new ApiRefusal(
      'INPUT_INVALID',
      'The draft has no tool id, so an accepted field cannot be recorded against it.',
      'Give the tool an id in the draft, ask for a suggestion for that draft, then accept the field.',
    );
  }

  // D7.4: bound to a real suggestion. One answer for every mismatch, so the
  // refusal does not tell a caller which of someone else's rows exist.
  const suggestion = await deps.store.audit.get(req.suggestionId);
  if (!isAcceptable(deps, actor, suggestion, { ...req, draftToolId })) {
    await appendRefusal(
      deps,
      actor,
      toolId,
      args,
      AUTHORING_SUGGESTION_UNKNOWN,
      'No suggestion this person may accept matches the request.',
      'authoring.suggestion_unknown',
      [{ keyName: 'suggestionId', keyValue: req.suggestionId }],
    );
    throw new ApiRefusal(
      AUTHORING_SUGGESTION_UNKNOWN,
      `Suggestion ${req.suggestionId} cannot be accepted here: a suggestion can be accepted only by the person who asked for it, for the same field of the same draft, with its text unchanged, within ${AUTHORING_SUGGESTION_TTL_MS / 60_000} minutes.`,
      'Ask for a new suggestion for this field and accept that one, or write the field by hand.',
    );
  }
  const provenance = provenanceOf(suggestion);
  const withProvider: RowArgs = { ...args, providerId: provenance.provider };

  // The provider must still be one this deployment configures.
  const loaded = await requireConfig(deps, actor, toolId, withProvider);
  const picked = selectProvider(loaded, provenance.provider);
  if (!picked.ok) {
    await appendRefusal(
      deps,
      actor,
      toolId,
      withProvider,
      picked.code,
      picked.message,
      'authoring.refused',
    );
    throw new ApiRefusal(picked.code, picked.message, picked.next);
  }

  // The gate again, at acceptance, then exactly one path is written.
  const target = targetOf(req);
  const draft: DraftContext = { doc, siblings: siblingsOf(deps.source.definitionsRoot, doc) };
  const gated = checkSuggestion(target, req.text, draft);
  if (!gated.ok) {
    await appendRefusal(
      deps,
      actor,
      toolId,
      withProvider,
      gated.code,
      gated.message,
      'authoring.refused',
    );
    throw new ApiRefusal(gated.code, gated.message, gated.next);
  }
  const applied = applySuggestion(req.yaml, target, gated.text);
  if (!applied.ok) {
    await appendRefusal(
      deps,
      actor,
      toolId,
      withProvider,
      applied.code,
      applied.message,
      'authoring.refused',
    );
    throw new ApiRefusal(applied.code, applied.message, applied.next);
  }

  const acceptedAt = deps.now().toISOString();
  const recorded = await appendRow(deps, {
    ...baseRow(deps, actor, toolId, withProvider, sensitivity),
    outcome: 'ok',
    resultKeys: [
      { keyName: 'suggestionId', keyValue: suggestion.id },
      { keyName: 'requestId', keyValue: provenance.requestId },
      { keyName: 'provider', keyValue: provenance.provider },
      { keyName: 'model', keyValue: provenance.model },
      { keyName: 'textSha256', keyValue: sha256(req.text) },
    ],
  });
  return {
    asOf: acceptedAt,
    yaml: applied.yaml,
    provenancePath: provenancePath(draftToolId),
    accepted: {
      field: target.field,
      ...(target.inputName === undefined ? {} : { inputName: target.inputName }),
      provider: provenance.provider,
      model: provenance.model,
      requestId: provenance.requestId,
      // The session's subject. Never a request value.
      acceptedBy: actor.session.principal.subject,
      acceptedAt,
    },
    auditCallId: recorded.id,
    next: 'The field is applied to your draft and recorded as model-drafted, with you as the acceptor. Save draft, then Propose; forge validate runs on the proposal like any change.',
  };
}

// --- checks --------------------------------------------------------------------------

async function requireHumanConsumer(
  deps: AuthoringDeps,
  actor: AuthoringActor,
  toolId: string,
  args: RowArgs,
): Promise<void> {
  const consumer = actor.session.scopeSession.consumer;
  if (consumer.attestation.humanInTheLoop) return;
  await appendRefusal(
    deps,
    actor,
    toolId,
    args,
    'CONSUMER_NOT_AUTHORIZED',
    'The consumer does not attest a human in its loop.',
    'authoring.consumer_no_human',
  );
  throw new ApiRefusal(
    'CONSUMER_NOT_AUTHORIZED',
    `Consumer ${consumer.consumerId} may not use model-assisted authoring: that needs a registration that attests a human in the loop. An agent consumer gets no authoring endpoint.`,
    'Draft copy from the MCPForge portal (whose registration attests a human in the loop) or with forge suggest on the gateway host. A consumer registration changes only through a reviewed change proposal.',
  );
}

/** The higher of the draft's and the served catalogue's sensitivity, within the consumer's ceiling. */
async function requireSensitivityWithinCeiling(
  deps: AuthoringDeps,
  actor: AuthoringActor,
  toolId: string,
  args: RowArgs,
  doc: Readonly<Record<string, unknown>>,
): Promise<string> {
  const ceiling = actor.session.scopeSession.consumer.authorizations.maxSensitivity;
  const drafted = typeof doc['sensitivity'] === 'string' ? doc['sensitivity'] : 'internal';
  const served =
    args.draftToolId === null
      ? undefined
      : deps.catalogue.entries.find((e) => e.toolId === args.draftToolId)?.sensitivity;
  const effective = served === undefined ? drafted : higher(drafted, served);
  if (effective !== undefined && sensitivityWithinCeiling(effective, ceiling)) return effective;

  const shown = effective ?? drafted;
  await appendRefusal(
    deps,
    actor,
    toolId,
    args,
    'AUTHORING_SENSITIVITY_BLOCKED',
    `Sensitivity ${shown} is above the consumer's ceiling ${ceiling}.`,
    'authoring.sensitivity_above_ceiling',
  );
  throw new ApiRefusal(
    'AUTHORING_SENSITIVITY_BLOCKED',
    sensitivityRank(shown) === null
      ? `The draft's sensitivity "${shown}" is not a sensitivity class, so no model may see it.`
      : `This tool is ${shown}${served !== undefined && served !== drafted ? ` (the served catalogue's value; the draft says ${drafted})` : ''}, above consumer ${actor.session.scopeSession.consumer.consumerId}'s ceiling of ${ceiling}, so its draft is not sent to a model from here.`,
    "Write this copy by hand, or use a consumer whose registered maxSensitivity covers this tool. A draft cannot lower a served tool's sensitivity to pass this check.",
  );
}

/** Undefined when either value is not a sensitivity class: fail closed. */
function higher(a: string, b: string): string | undefined {
  const ra = sensitivityRank(a);
  const rb = sensitivityRank(b);
  if (ra === null || rb === null) return undefined;
  return ra >= rb ? a : b;
}

async function requireWithinRate(
  deps: AuthoringDeps,
  actor: AuthoringActor,
  toolId: string,
  args: RowArgs,
): Promise<void> {
  const consumerId = actor.session.scopeSession.consumer.consumerId;
  const limit = deps.callsPerMinute(consumerId);
  const key = `${consumerId}\u0000${actor.session.principal.subject}`;
  const at = deps.now().getTime();
  if (limit === undefined) {
    await appendRefusal(
      deps,
      actor,
      toolId,
      args,
      'CONSUMER_NOT_AUTHORIZED',
      'The consumer has no declared call limit.',
      'authoring.consumer_unlimited',
    );
    throw new ApiRefusal(
      'CONSUMER_NOT_AUTHORIZED',
      `Consumer ${consumerId} has no registration limits this gateway can apply, so no model call is made for it.`,
      'Restart the gateway so it loads the consumer registry again, or ask the consumer owner to declare limits.callsPerMinute in its registration.',
    );
  }
  if (deps.rateLimiter.count(key, at) >= limit) {
    const resetAt = new Date(Math.ceil((at + 1) / 60_000) * 60_000).toISOString();
    await appendRefusal(
      deps,
      actor,
      toolId,
      args,
      'RATE_LIMITED',
      `More than ${limit} suggestions this minute.`,
      'authoring.rate_limited',
    );
    throw new ApiRefusal(
      'RATE_LIMITED',
      `You have asked for ${limit} suggestions in the last minute through ${consumerId}, its declared limit of calls per minute.`,
      `Wait until ${resetAt} (UTC) and ask again, or write the field by hand. The limit is the consumer's limits.callsPerMinute, applied per person.`,
    );
  }
  deps.rateLimiter.record(key, at);
}

async function requireConfig(
  deps: AuthoringDeps,
  actor: AuthoringActor,
  toolId: string,
  args: RowArgs,
): Promise<AuthoringConfig> {
  const loaded = loadConfig(deps.source);
  if (loaded.ok && authoringEnabled(loaded.config)) return loaded.config;
  const message = loaded.ok
    ? 'Model-assisted authoring is not configured for this deployment.'
    : loaded.message;
  await appendRefusal(
    deps,
    actor,
    toolId,
    args,
    'AUTHORING_NOT_CONFIGURED',
    message,
    'authoring.refused',
  );
  throw new ApiRefusal(
    'AUTHORING_NOT_CONFIGURED',
    message,
    loaded.ok
      ? 'Nothing else depends on it. To enable it, add overlays/<deployment>/authoring.yaml with enabled: true and a provider through a change proposal, store the provider key on the gateway host with forge secrets put, and restart the gateway.'
      : loaded.next,
  );
}

function isAcceptable(
  deps: AuthoringDeps,
  actor: AuthoringActor,
  row: AuditCallRecord | undefined,
  req: { field: string; inputName?: string | undefined; text: string; draftToolId: string },
): row is AuditCallRecord {
  if (row === undefined) return false;
  if (
    row.phase !== 'authoring' ||
    row.toolId !== AUTHORING_SUGGEST_TOOL_ID ||
    row.outcome !== 'ok'
  ) {
    return false;
  }
  if (row.callerSubject !== actor.session.principal.subject) return false;
  const at = deps.now();
  if (row.deploymentId !== actor.session.scopeAt(at).deployment.deploymentId) return false;
  const args = asRecord(row.argsRedacted);
  if (args['field'] !== req.field) return false;
  if ((args['inputName'] ?? null) !== (req.inputName ?? null)) return false;
  if (args['draftToolId'] !== req.draftToolId) return false;
  const textSha = row.resultKeys.find((k) => k.keyName === 'textSha256')?.keyValue;
  if (textSha === undefined || textSha !== sha256(req.text)) return false;
  const age = at.getTime() - Date.parse(row.ts);
  return Number.isFinite(age) && age >= 0 && age <= AUTHORING_SUGGESTION_TTL_MS;
}

function provenanceOf(row: AuditCallRecord): {
  provider: string;
  model: string;
  requestId: string;
} {
  const key = (name: string): string =>
    row.resultKeys.find((k) => k.keyName === name)?.keyValue ?? '';
  return { provider: key('provider'), model: key('model'), requestId: key('requestId') };
}

// --- request parsing ---------------------------------------------------------------

async function readRequestBody(
  deps: AuthoringDeps,
  actor: AuthoringActor,
  toolId: string,
  readBody: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await readBody();
  } catch (error) {
    if (error instanceof ApiRefusal) {
      await appendRefusal(
        deps,
        actor,
        toolId,
        NO_ARGS,
        error.code,
        error.message,
        'authoring.input_invalid',
      );
    }
    throw error;
  }
}

/** Spoofed acceptor or provenance: refused, audited, with the reason. */
const NOT_REQUESTABLE = ['acceptedBy', 'acceptedAt', 'provenance'] as const;

async function refuseBadRequest(
  deps: AuthoringDeps,
  actor: AuthoringActor,
  toolId: string,
  body: unknown,
  issue: { path: (string | number)[]; message: string } | undefined,
): Promise<never> {
  const named = NOT_REQUESTABLE.filter((k) => Object.hasOwn(asRecord(body), k));
  const b = asRecord(body);
  const args: RowArgs = {
    ...NO_ARGS,
    field: typeof b['field'] === 'string' ? b['field'].slice(0, 200) : null,
  };
  if (named.length > 0) {
    await appendRefusal(
      deps,
      actor,
      toolId,
      args,
      'INPUT_INVALID',
      `The request named ${named.join(', ')}.`,
      'authoring.acceptor_not_requestable',
      undefined,
      'policy_denied',
    );
    throw new ApiRefusal(
      'INPUT_INVALID',
      `A request may not name ${named.join(' or ')}: the acceptor is taken from your sign-in, and provenance is read from the audited suggestion.`,
      'Remove those fields and send the request again with only the fields the endpoint takes: yaml, field, inputName, and either providerId, request and dryRun (suggest) or text and suggestionId (accept).',
    );
  }
  const where = issue === undefined || issue.path.length === 0 ? 'the body' : issue.path.join('.');
  await appendRefusal(
    deps,
    actor,
    toolId,
    args,
    'INPUT_INVALID',
    `Invalid request: ${where}.`,
    'authoring.input_invalid',
  );
  throw new ApiRefusal(
    'INPUT_INVALID',
    `The request is not valid at ${where}: ${issue?.message ?? 'expected a JSON object'}.`,
    'Send a JSON object with only the fields the endpoint takes: yaml and field (with inputName for input.desc and input.example), plus providerId, request and dryRun for a suggestion, or text and suggestionId to accept one.',
  );
}

async function parseDraft(
  deps: AuthoringDeps,
  actor: AuthoringActor,
  toolId: string,
  yaml: string,
  req: { field: string; inputName?: string | undefined; providerId?: string | undefined },
): Promise<Record<string, unknown>> {
  let doc: unknown;
  try {
    doc = parseYaml(yaml);
  } catch {
    doc = undefined;
  }
  if (typeof doc === 'object' && doc !== null && !Array.isArray(doc)) {
    return doc as Record<string, unknown>;
  }
  const args: RowArgs = {
    ...NO_ARGS,
    field: req.field,
    inputName: req.inputName ?? null,
    providerId: req.providerId ?? null,
  };
  await appendRefusal(
    deps,
    actor,
    toolId,
    args,
    'INPUT_INVALID',
    'The draft is not a YAML mapping.',
    'authoring.input_invalid',
  );
  throw new ApiRefusal(
    'INPUT_INVALID',
    'The draft is not a YAML mapping, so no field of it can be drafted.',
    'Fix the draft YAML in the editor (the Checks pane names the problem), then ask for the suggestion again.',
  );
}

function businessOf(r: {
  does: string;
  goodAnswer?: string | undefined;
  inputs?: string[] | undefined;
}): NonNullable<DraftContext['request']> {
  return {
    does: r.does,
    ...(r.goodAnswer === undefined ? {} : { goodAnswer: r.goodAnswer }),
    ...(r.inputs === undefined ? {} : { inputs: r.inputs }),
  };
}

function targetOf(req: { field: string; inputName?: string | undefined }): FieldTarget {
  return {
    field: req.field as FieldTarget['field'],
    ...(req.inputName === undefined ? {} : { inputName: req.inputName }),
  };
}

function loadConfig(source: AuthoringSource): ReturnType<typeof loadAuthoringConfig> {
  return loadAuthoringConfig(source.definitionsRoot, source.deployment);
}

function providerDeps(source: AuthoringSource) {
  return {
    secrets: source.secretStore,
    ...(source.fetch === undefined ? {} : { fetch: source.fetch }),
    ...(source.timeoutMs === undefined ? {} : { timeoutMs: source.timeoutMs }),
  };
}

// --- outcomes and rows -----------------------------------------------------------------

/** Failures that happen after the prompt left the gateway. */
const PROVIDER_REACHED: ReadonlySet<SuggestErrorCode> = new Set<SuggestErrorCode>([
  'AUTHORING_PROVIDER_FAILED',
  'AUTHORING_RESPONSE_UNRECOGNISED',
  'AUTHORING_GATE_REFUSED',
]);

function outcomeFor(code: string, message: string): AuditOutcome {
  if (code === 'AUTHORING_SENSITIVITY_BLOCKED' || code === 'CONSUMER_NOT_AUTHORIZED') {
    return 'policy_denied';
  }
  if (code === 'AUTHORING_PROVIDER_FAILED') {
    return /TimeoutError|AbortError/.test(message) ? 'timeout' : 'binding_error';
  }
  if (code === 'AUTHORING_RESPONSE_UNRECOGNISED') return 'binding_error';
  return 'business_error';
}

function appendRow(deps: AuthoringDeps, row: AppendAuditCallInput): Promise<AuditCallRecord> {
  return deps.store.transaction(() => deps.store.audit.append(row));
}

async function appendRefusal(
  deps: AuthoringDeps,
  actor: AuthoringActor,
  toolId: string,
  args: RowArgs,
  errorCode: string,
  message: string,
  rule: DeniedRule,
  resultKeys?: readonly AuditResultKey[],
  outcome?: AuditOutcome,
): Promise<void> {
  await appendRow(deps, {
    ...baseRow(deps, actor, toolId, args, undefined),
    outcome:
      outcome ??
      (rule === 'authoring.input_invalid' || rule === 'authoring.refused'
        ? outcomeFor(errorCode, message)
        : 'policy_denied'),
    errorCode,
    errorMessageAgent: message,
    deniedByRule: rule,
    ...(resultKeys === undefined ? {} : { resultKeys }),
  });
}

/** The columns every `authoring` row carries, as `probe-run.ts` writes its own. */
function baseRow(
  deps: AuthoringDeps,
  actor: AuthoringActor,
  toolId: string,
  args: RowArgs,
  sensitivity: string | undefined,
): Omit<AppendAuditCallInput, 'outcome'> {
  const at = deps.now();
  const scope = actor.session.scopeAt(at);
  const session = actor.session.scopeSession;
  const principal = actor.session.principal;
  return {
    ts: at.toISOString(),
    correlationId: actor.correlationId,
    sessionId: actor.session.sessionId,
    callerSubject: principal.subject,
    ...(principal.displayName === undefined ? {} : { callerDisplay: principal.displayName }),
    ...(principal.idp === undefined ? {} : { callerIdp: principal.idp }),
    ...(principal.amr === undefined ? {} : { callerAmr: principal.amr.join(' ') }),
    callerRoles: [...session.heldRoleIds],

    consumerId: session.consumer.consumerId,
    consumerRecordSha: session.consumerSession.recordSha,
    consumerAuthMethod: session.consumerSession.authMethod,
    consumerSessionId: session.consumerSession.consumerSessionId,
    humanInTheLoop: session.consumer.attestation.humanInTheLoop,

    toolId,
    // Drafting copy changes no target and no definition: a person still proposes it.
    isWrite: false,
    ...(sensitivity === undefined ? {} : { sensitivityClass: sensitivity }),

    deploymentId: scope.deployment.deploymentId,
    gatewayVersion: deps.gatewayVersion,

    phase: 'authoring',
    argsRedacted: { ...args },
  };
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
