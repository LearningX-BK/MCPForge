// MCPForge — W0-P3b: the portal's ONE client for the gateway's read API.
//
// W0-P2 §4(b): "One client module ... The client is the only file that knows a
// URL. Types come from a shared contract, never hand-copied into the portal."
// So every response is parsed with `@mcpforge/shared/api/v1`'s zod schemas,
// the same ones the gateway's tests hold it to.
//
// SERVER-ONLY. Every request carries BOTH halves non-negotiable 6 requires:
// the portal's registered consumer (`consumerAssertionHeaders()`, a fresh
// single-use `private-key-jwt` assertion per request, W0-P24) and the viewer's
// own access token from the server-side session (W0-P5b). Neither the token
// nor the assertion ever reaches the browser: pages receive a `ReadResult`.
//
// W0-P2 §4(c): gateway-down must never look like empty. So a read never
// throws to a page and never returns `[]` for a failure. It returns one of
// five states, and the page renders each one distinctly.

import {
  API_V1_PATHS,
  apiErrorSchema,
  approvalDetailResponseSchema,
  approvalsResponseSchema,
  auditVerifyResponseSchema,
  callDetailResponseSchema,
  callsPageSchema,
  consumerUsageResponseSchema,
  deploymentResponseSchema,
  enablementResponseSchema,
  type ApprovalDetailResponse,
  type ApprovalsResponse,
  type AuditVerifyResponse,
  type CallDetailResponse,
  type CallsPage,
  type ConsumerUsageResponse,
  type DeploymentResponse,
  type EnablementResponse,
  type UsageWindow,
} from '@mcpforge/shared/api/v1';
import type { ZodType } from 'zod';

import { gatewayBaseUrl, gatewayRefresh, type FetchLike } from '../viewer/gateway-auth';
import { heldPersonas } from '../viewer/mapping';
import { sessionIdFromCookies } from '../viewer/session';
import { resolveSession } from '../viewer/viewer';
import { ConsumerCredentialError, consumerAssertionHeaders } from './consumer-assertion';

/** The command a developer runs to bring the gateway up (CLAUDE.md §3.1, local-first). */
export const START_GATEWAY_COMMAND =
  'MCPFORGE_MODE=headless MCPFORGE_GATEWAY_PORT=3939 npx tsx core/gateway/launch.ts';

export type ReadResult<T> =
  | { readonly kind: 'ok'; readonly data: T }
  /** No portal session. A fact about the viewer, not about the system. */
  | { readonly kind: 'signed-out'; readonly next: string }
  /** The gateway did not answer. A fact about the connection, not about the system. */
  | { readonly kind: 'gateway-down'; readonly endpoint: string; readonly next: string }
  /** The gateway answered and refused, or the portal could not present its consumer. */
  | {
      readonly kind: 'refused';
      readonly code: string;
      readonly message: string;
      readonly next: string;
      readonly correlationId?: string;
    }
  /** The record does not exist, or it exists outside the viewer's read authority. */
  | { readonly kind: 'not-found'; readonly message: string; readonly next: string };

export interface ReadDeps {
  readonly fetch?: FetchLike;
  readonly baseUrl?: string;
  /** The viewer's access token. Default: the current request's session. */
  readonly accessToken?: () => Promise<string | null>;
  /** The consumer half. Default: `consumerAssertionHeaders()` over the portal's key. */
  readonly consumerHeaders?: () => Promise<Record<string, string>>;
}

/** The current request's access token, renewed when due, or `null` when signed out. */
async function sessionAccessToken(): Promise<string | null> {
  const id = await sessionIdFromCookies();
  if (id === undefined || id.length === 0) return null;
  const session = await resolveSession(id, {
    refresh: (refreshToken) => gatewayRefresh(refreshToken),
    personasFor: (groups) => heldPersonas(groups),
  });
  return session?.grant.accessToken ?? null;
}

async function read<T>(path: string, schema: ZodType<T>, deps: ReadDeps): Promise<ReadResult<T>> {
  const token = await (deps.accessToken ?? sessionAccessToken)();
  if (token === null) {
    return {
      kind: 'signed-out',
      next: 'Sign in to see live data. Every read is made as you, through the portal’s registered consumer, and shows only what your roles allow.',
    };
  }

  let consumer: Record<string, string>;
  try {
    consumer = await (deps.consumerHeaders ?? (() => consumerAssertionHeaders()))();
  } catch (error) {
    if (error instanceof ConsumerCredentialError) {
      return { kind: 'refused', code: error.code, message: error.message, next: error.next };
    }
    throw error;
  }

  const base = deps.baseUrl ?? gatewayBaseUrl();
  const endpoint = `${base}${path}`;
  let res: Response;
  try {
    res = await (deps.fetch ?? ((input, init) => fetch(input, init)))(endpoint, {
      method: 'GET',
      headers: { ...consumer, authorization: `Bearer ${token}`, accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    return {
      kind: 'gateway-down',
      endpoint: base,
      next: `Start the gateway (${START_GATEWAY_COMMAND}), then reload. Nothing is shown because nothing could be read, not because nothing happened.`,
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  if (res.ok) {
    const parsed = schema.safeParse(body);
    if (parsed.success) return { kind: 'ok', data: parsed.data };
    return {
      kind: 'refused',
      code: 'CONTRACT_MISMATCH',
      message: `The gateway's answer from ${path} does not match the /api/v1 contract this portal was built against.`,
      next: 'The portal and gateway are from different builds. Rebuild and restart both from the same checkout.',
    };
  }

  const refusal = apiErrorSchema.safeParse(body);
  if (!refusal.success) {
    return {
      kind: 'gateway-down',
      endpoint: base,
      next: `The gateway answered ${res.status} with no MCPForge error body; it may be starting up or something else holds the port. Check the gateway process, then reload.`,
    };
  }
  const e = refusal.data.error;
  if (res.status === 404 && e.code === 'NOT_FOUND') {
    return { kind: 'not-found', message: e.message, next: e.next };
  }
  return {
    kind: 'refused',
    code: e.code,
    message: e.message,
    next: e.next,
    correlationId: e.correlationId,
  };
}

// --- the eight reads -------------------------------------------------------------

export interface ListCallsQuery {
  readonly cursor?: string;
  readonly limit?: number;
  readonly tool?: string;
  readonly consumer?: string;
  readonly outcome?: string;
}

export function readCalls(
  query: ListCallsQuery = {},
  deps: ReadDeps = {},
): Promise<ReadResult<CallsPage>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, String(v));
  const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
  return read(`${API_V1_PATHS.calls}${suffix}`, callsPageSchema, deps);
}

export function readCall(
  callId: string,
  deps: ReadDeps = {},
): Promise<ReadResult<CallDetailResponse>> {
  return read(API_V1_PATHS.call(callId), callDetailResponseSchema, deps);
}

export function readAuditVerify(deps: ReadDeps = {}): Promise<ReadResult<AuditVerifyResponse>> {
  return read(API_V1_PATHS.auditVerify, auditVerifyResponseSchema, deps);
}

export function readApprovals(
  status: 'pending' | 'decided' = 'pending',
  deps: ReadDeps = {},
): Promise<ReadResult<ApprovalsResponse>> {
  return read(`${API_V1_PATHS.approvals}?status=${status}`, approvalsResponseSchema, deps);
}

export function readApproval(
  id: string,
  deps: ReadDeps = {},
): Promise<ReadResult<ApprovalDetailResponse>> {
  return read(API_V1_PATHS.approval(id), approvalDetailResponseSchema, deps);
}

export function readConsumerUsage(
  window: UsageWindow = '24h',
  deps: ReadDeps = {},
): Promise<ReadResult<ConsumerUsageResponse>> {
  return read(`${API_V1_PATHS.consumerUsage}?window=${window}`, consumerUsageResponseSchema, deps);
}

export function readEnablement(deps: ReadDeps = {}): Promise<ReadResult<EnablementResponse>> {
  return read(API_V1_PATHS.enablement, enablementResponseSchema, deps);
}

export function readDeployment(deps: ReadDeps = {}): Promise<ReadResult<DeploymentResponse>> {
  return read(API_V1_PATHS.deployment, deploymentResponseSchema, deps);
}
