// MCPForge — W0-P15. Binding a resolved human + consumer session to an MCP session.
//
// The transport does not know what a session contains; it knows WHEN one must
// be established and when it must be checked again:
//
//   * at `initialize`, only after `[2a]` succeeded: `establish`. A refusal
//     means no MCP session exists, no McpServer is built and no tools/list can
//     ever be served (non-negotiable #6).
//   * on EVERY later request carrying that session's id: `reverify`, before
//     the request reaches the MCP SDK. 05 §11.8: per-user identity is required
//     on every call. A session id is a correlation handle, never an identity,
//     so a request that does not re-authenticate as the same human is refused.
//
// The gateway assembly (`../assembly/session.ts`) implements this interface.

import type { ForgeError } from '@mcpforge/shared/errors';
import type { ConsumerAuthSuccess } from './consumer-auth/index.js';

export type SessionBindingOutcome<S> =
  { readonly ok: true; readonly session: S } | { readonly ok: false; readonly error: ForgeError };

export interface SessionEstablisher<S> {
  establish(input: {
    readonly auth: ConsumerAuthSuccess;
    readonly request: Request;
    readonly sessionId: string;
    readonly correlationId: string;
  }): Promise<SessionBindingOutcome<S>>;
  reverify(session: S, request: Request, correlationId: string): Promise<SessionBindingOutcome<S>>;
}

/** What the per-session McpServer factory receives: the latest VERIFIED session. */
export interface SessionHandle<S> {
  readonly sessionId: string;
  current(): S;
}

/**
 * The identity-bearing part of a Node request, as a Fetch `Request` for the
 * `IdentityProvider` seam. Only `Authorization` is carried: it is the one
 * header an identity provider reads (identity/bearer.ts), and copying nothing
 * else keeps every other header out of the identity path.
 */
export function identityRequestFrom(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): Request {
  const out = new Headers();
  const raw = headers['authorization'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value !== undefined) out.set('authorization', value);
  return new Request('http://mcpforge.gateway/mcp', { method: 'POST', headers: out });
}
