// MCPForge — the real `AisClient`, over HTTP. W0-P14, 02 §3.5.
//
// The same seam the in-process fake implements (`../testing/mock-ais-server.ts`),
// so the executor above it is unchanged: the orchestration name still arrives
// only from the frozen descriptor, the payload is still the closed mapping's
// output, and the timeout is still the executor's abort signal.
//
// What this client adds is the one thing a fake never had to do: authenticate
// AS THE CALLER. Every request carries a per-user AIS token obtained through
// `AisTokenProvider` for `request.principalSubject` (02 §3.5 option (a)). No
// subject, or a subject the token provider does not know, means the
// orchestration request is never sent (`AisIdentityRefused` ->
// IDENTITY_UNRESOLVED). There is no constructor option for a static token,
// a service user or a default subject, so none can be configured.
//
// The request shape is the AIS orchestration REST call:
//   POST <baseUrl>/v3/orchestrator/<orchestration>
//   jde-AIS-Auth: <per-user token>
//   Content-Type: application/json
//   <mapped inputs as a JSON object>
// plus two informational headers: the orchestration version the manifest
// pinned and the correlation id, so the target's own logs join to our audit.
//
// Response mapping, matching how the fake reports the same conditions:
//   2xx                -> { status, body }
//   401                -> the token was rejected: invalidated, and the call is
//                         refused as IDENTITY_UNRESOLVED (nothing ran)
//   400/409/412/422    -> targetError { precondition: true }   (TARGET_PRECONDITION_FAILED)
//   any other non-2xx  -> targetError { precondition: false }  (TARGET_ERROR)
// A body's own `precondition: true` also marks a precondition failure. The
// message is the target's `message` field when there is one.

import type { AisClient, AisRequest, AisResponse } from '../types.js';
import { AisIdentityRefused, type AisTokenProvider } from './token-provider.js';

export const AIS_AUTH_HEADER = 'jde-AIS-Auth';
export const ORCHESTRATION_VERSION_HEADER = 'x-mcpforge-orchestration-version';
export const CORRELATION_HEADER = 'x-mcpforge-correlation-id';

const PRECONDITION_STATUSES = new Set([400, 409, 412, 422]);

export interface HttpAisClientOptions {
  /** The AIS server's REST root, e.g. `http://127.0.0.1:4545/jderest`. From the overlay. */
  readonly baseUrl: string;
  readonly tokens: AisTokenProvider;
  readonly fetch?: typeof fetch;
}

export function createHttpAisClient(options: HttpAisClientOptions): AisClient {
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = options.baseUrl.replace(/\/+$/, '');

  return {
    async call(request: AisRequest): Promise<AisResponse> {
      const subject = request.principalSubject;
      if (subject === undefined || subject.trim().length === 0) {
        throw new AisIdentityRefused('no caller subject reached the AIS client');
      }
      const token = await options.tokens.tokenFor(subject, request.signal);

      const headers: Record<string, string> = {
        [AIS_AUTH_HEADER]: token,
        'content-type': 'application/json',
        [CORRELATION_HEADER]: request.correlationId,
      };
      if (request.orchestrationVersion !== null) {
        headers[ORCHESTRATION_VERSION_HEADER] = request.orchestrationVersion;
      }

      const response = await doFetch(
        `${base}/v3/orchestrator/${encodeURIComponent(request.orchestration)}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(request.inputs),
          signal: request.signal,
        },
      );
      const body = await response.text();

      if (response.ok) return { status: response.status, body };

      if (response.status === 401) {
        // Rejected before the orchestration ran. Re-exchanging on the next call
        // is safe; retrying THIS call silently is not this layer's decision.
        options.tokens.invalidate(subject);
        throw new AisIdentityRefused(
          `the AIS server rejected the per-user token for "${subject}" (HTTP 401)`,
        );
      }

      const { message, precondition } = readTargetError(body);
      return {
        status: response.status,
        body,
        targetError: {
          message: message ?? `HTTP ${response.status}`,
          precondition: precondition || PRECONDITION_STATUSES.has(response.status),
        },
      };
    },
  };
}

function readTargetError(body: string): { message: string | null; precondition: boolean } {
  try {
    const doc = JSON.parse(body) as Record<string, unknown>;
    const message = typeof doc['message'] === 'string' ? doc['message'] : null;
    return { message, precondition: doc['precondition'] === true };
  } catch {
    return { message: null, precondition: false };
  }
}
