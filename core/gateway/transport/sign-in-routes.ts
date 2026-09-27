// MCPForge — the local provider's token endpoint, over HTTP. W0-P5a, W0-P4 §2.
//
//   POST /auth/local/token    { username, password, totpCode? }  -> grant
//   POST /auth/local/refresh  { refreshToken }                   -> grant (rotated)
//   POST /auth/local/signout  { refreshToken }                   -> 204
//
// **Not a REST facade** (W0-P2 §7, CLAUDE.md §3). These routes serve no tool
// discovery, invocation or governance data. They are the local provider's
// token endpoint, which 02 §4.4 already assumes ("the gateway itself issues
// short-lived signed JWTs"). They exist only when a local provider is
// configured; under an OIDC-only deployment the IdP is the token endpoint and
// every path here is a 404.
//
// **What never leaves this file.** Neither a password nor a refresh token is
// echoed in an error, and an unexpected failure is reported as a generic
// INTERNAL without its message, because a message is where a value leaks.
// Responses carry `Cache-Control: no-store` (RFC 6749 §5.1).
//
// **Browsers.** Only `application/json` bodies are accepted. That makes a
// cross-site form post impossible and forces a CORS preflight for any script,
// which this server never answers, so a page on another origin cannot sign a
// visitor in or out. The portal calls these routes from its server, not from
// the browser (W0-P4 §2: the token lives in a portal-server httpOnly session).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { ForgeError, forgeError } from '@mcpforge/shared/errors';
import type { LocalSignInService, SignInGrant } from '../identity/index.js';

export const SIGN_IN_PATH_PREFIX = '/auth/local/';
const MAX_BODY_BYTES = 16 * 1024;

const STATUS_FOR: Readonly<Record<string, number>> = {
  INPUT_INVALID: 400,
  AUTH_REQUIRED: 401,
  IDENTITY_UNRESOLVED: 403,
};

const NO_STORE = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  pragma: 'no-cache',
} as const;

export function isSignInPath(pathname: string): boolean {
  return pathname.startsWith(SIGN_IN_PATH_PREFIX);
}

/** The wire shape of a grant. `sessionId` stays server-side on purpose. */
function grantBody(grant: SignInGrant): object {
  return {
    tokenType: 'Bearer',
    accessToken: grant.accessToken,
    accessTokenExpiresAt: grant.accessTokenExpiresAt,
    refreshToken: grant.refreshToken,
    idleExpiresAt: grant.idleExpiresAt,
    sessionExpiresAt: grant.sessionExpiresAt,
    principal: grant.principal,
  };
}

function malformed(correlationId: string, what: string): ForgeError {
  return forgeError('INPUT_INVALID', `The sign-in request is malformed: ${what}.`, correlationId, {
    condition:
      'The body must be a JSON object sent with Content-Type: application/json, at most 16 KiB.',
    next: 'Send POST /auth/local/token with {"username","password"} (plus "totpCode" when enrolled), or POST /auth/local/refresh or /auth/local/signout with {"refreshToken"}.',
  });
}

function unexpected(correlationId: string): ForgeError {
  return forgeError('INTERNAL', 'The sign-in endpoint failed unexpectedly.', correlationId, {
    condition: 'An error outside the sign-in contract occurred; its detail is withheld here.',
    next: 'Report this correlationId to your MCPForge operator, who can read the gateway log; no session was changed by this request.',
  });
}

function send(res: ServerResponse, status: number, body?: object): void {
  res.writeHead(status, NO_STORE).end(body === undefined ? undefined : JSON.stringify(body));
}

function sendError(res: ServerResponse, error: ForgeError): void {
  const shape = error.toJSON();
  send(res, STATUS_FOR[shape.code] ?? 500, { error: shape });
}

async function readBody(
  req: IncomingMessage,
  correlationId: string,
): Promise<Record<string, unknown>> {
  const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json')
    throw malformed(correlationId, 'Content-Type is not application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw malformed(correlationId, 'the body is larger than 16 KiB');
    chunks.push(chunk);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw malformed(correlationId, 'the body is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw malformed(correlationId, 'the body is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, name: string, correlationId: string): string {
  const value = body[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw malformed(correlationId, `"${name}" must be a non-empty string`);
  }
  return value;
}

/**
 * Serve one `/auth/local/*` request. The caller has already matched the prefix.
 */
export async function handleSignInRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  service: LocalSignInService,
): Promise<void> {
  const correlationId = randomUUID();
  const action = pathname.slice(SIGN_IN_PATH_PREFIX.length);
  if (action !== 'token' && action !== 'refresh' && action !== 'signout') {
    res.writeHead(404).end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { ...NO_STORE, allow: 'POST' }).end();
    return;
  }
  try {
    const body = await readBody(req, correlationId);
    if (action === 'token') {
      const totp = body['totpCode'];
      if (totp !== undefined && typeof totp !== 'string') {
        throw malformed(correlationId, '"totpCode" must be a string');
      }
      const grant = await service.signIn(
        {
          username: stringField(body, 'username', correlationId),
          password: stringField(body, 'password', correlationId),
          ...(typeof totp === 'string' && totp.length > 0 ? { totpCode: totp } : {}),
        },
        correlationId,
      );
      send(res, 200, grantBody(grant));
      return;
    }
    const refreshToken = stringField(body, 'refreshToken', correlationId);
    if (action === 'refresh') {
      send(res, 200, grantBody(await service.refresh(refreshToken, correlationId)));
      return;
    }
    await service.signOut(refreshToken, correlationId);
    send(res, 204);
  } catch (error) {
    sendError(res, error instanceof ForgeError ? error : unexpected(correlationId));
  }
}
