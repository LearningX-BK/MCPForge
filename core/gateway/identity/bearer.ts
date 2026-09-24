// MCPForge — pulling the bearer token off a request. W0-D1.
//
// Small, and separate, because it is the one place a raw credential is read out
// of an HTTP request, and it must be reviewable in isolation. `Authorization:
// Bearer <token>` is what the MCP spec's OAuth 2.1 flow uses, so the Wave 0
// local provider and W0-D3's OIDC provider read the credential identically —
// only the verification differs.

import { forgeError } from '@mcpforge/shared/errors';

const PREFIX = 'bearer ';

/**
 * Return the compact JWS from the `Authorization` header.
 *
 * Throws `AUTH_REQUIRED` when there is none. There is no "or the query string",
 * no "or a cookie", and above all no "or the configured default subject" — a
 * request without a credential is refused, never defaulted (CLAUDE.md
 * non-negotiable 1).
 */
export function bearerToken(req: Request, correlationId: string): string {
  const header = req.headers.get('authorization');
  const refuse = (message: string): never => {
    throw forgeError('AUTH_REQUIRED', message, correlationId);
  };
  if (header === null || header.length === 0) {
    return refuse('No Authorization header was presented.');
  }
  // RFC 7235 makes the scheme case-insensitive; the token after it is not.
  if (!header.toLowerCase().startsWith(PREFIX)) {
    return refuse('The Authorization header is not a Bearer credential.');
  }
  const token = header.slice(PREFIX.length).trim();
  if (token.length === 0) {
    return refuse('The Bearer credential is empty.');
  }
  return token;
}
