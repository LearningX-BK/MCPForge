// MCPForge — the two identity routes every provider kind shares. W0-P23.
//
//   GET /auth/providers   -> the configured providers, public facts only
//   GET /auth/principal   -> the Principal a bearer token resolves to
//
// **Why the portal needs them.** W0-P4 §2: the portal signs its viewer in
// THROUGH the gateway and verifies nothing itself. For the local provider the
// gateway is the token endpoint (`/auth/local/*`). For an OIDC provider the
// portal runs authorization code + PKCE against the provider, and then has an
// access token it must not interpret: `/auth/principal` is where the gateway,
// the only verifier, says who that token is (against the provider's own JWKS,
// issuer and audience), with the same issuer-qualified subject and groups a
// `/mcp` session would get. `/auth/providers` is where the portal learns which
// providers to offer and each OIDC provider's authorization and token endpoint
// (from the discovery the gateway already ran at startup), so the portal never
// reads the overlay and never runs a second discovery.
//
// **Not a REST facade** (W0-P2 §7): no tool discovery, invocation or governance
// data. Like `/auth/local/token`, a token alone opens nothing: every `/mcp`
// session and every `/api/v1/**` read still needs a registered consumer too
// (non-negotiable 6). `/auth/principal` tells a token's holder only what the
// token already says about them.
//
// **What never leaves this file:** no secret (the overlay has none to give), no
// token echoed in an error. Responses are `Cache-Control: no-store`.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { ForgeError, forgeError } from '@mcpforge/shared/errors';
import type { IdentityConfig, MultiProviderIdentity } from '../identity/index.js';
import { providerIdOfSubject } from '../identity/index.js';

export const PROVIDERS_PATH = '/auth/providers';
export const PRINCIPAL_PATH = '/auth/principal';

const NO_STORE = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  pragma: 'no-cache',
} as const;

const STATUS_FOR: Readonly<Record<string, number>> = {
  AUTH_REQUIRED: 401,
  IDENTITY_UNRESOLVED: 403,
};

export function isIdentityRoutePath(pathname: string): boolean {
  return pathname === PROVIDERS_PATH || pathname === PRINCIPAL_PATH;
}

export interface IdentityRoutes {
  readonly identity: MultiProviderIdentity;
  readonly config: IdentityConfig;
}

/** The public description of one provider. Values from the overlay and discovery only. */
export interface PublicProvider {
  readonly id: string;
  readonly kind: 'local' | 'oidc';
  readonly displayName: string;
  readonly issuer?: string;
  readonly authorizationEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly clientId?: string;
  readonly scopes?: readonly string[];
}

export function publicProviders(routes: IdentityRoutes): PublicProvider[] {
  return routes.config.providers.map((p): PublicProvider => {
    if (p.kind === 'local') return { id: p.id, kind: 'local', displayName: p.displayName };
    const m = routes.identity.metadataFor(p.id);
    return {
      id: p.id,
      kind: 'oidc',
      displayName: p.displayName,
      issuer: p.issuer,
      ...(m?.authorizationEndpoint == null
        ? {}
        : { authorizationEndpoint: m.authorizationEndpoint }),
      ...(m?.tokenEndpoint == null ? {} : { tokenEndpoint: m.tokenEndpoint }),
      clientId: p.clientId,
      scopes: [...p.scopes],
    };
  });
}

function send(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, NO_STORE).end(JSON.stringify(body));
}

function unexpected(correlationId: string): ForgeError {
  return forgeError('INTERNAL', 'The identity endpoint failed unexpectedly.', correlationId, {
    condition: 'An error outside the identity contract occurred; its detail is withheld here.',
    next: 'Report this correlationId to your MCPForge operator, who can read the gateway log, then sign in again.',
  });
}

/** Serve `/auth/providers` or `/auth/principal`. The caller has matched the path. */
export async function handleIdentityRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  routes: IdentityRoutes,
): Promise<void> {
  const correlationId = randomUUID();
  if (req.method !== 'GET') {
    res.writeHead(405, { ...NO_STORE, allow: 'GET' }).end();
    return;
  }
  if (pathname === PROVIDERS_PATH) {
    send(res, 200, {
      providers: publicProviders(routes),
      sessionLimits: routes.config.sessionLimits,
    });
    return;
  }
  try {
    const headers = new Headers();
    const authorization = req.headers['authorization'];
    if (typeof authorization === 'string') headers.set('authorization', authorization);
    headers.set('x-correlation-id', correlationId);
    const request = new Request('http://mcpforge.invalid/auth/principal', { headers });
    const principal = await routes.identity.authenticate(request);
    const groups = await routes.identity.resolveGroups(principal);
    send(res, 200, {
      principal: {
        subject: principal.subject,
        displayName: principal.displayName,
        ...(principal.email === undefined ? {} : { email: principal.email }),
        groups: [...groups],
        idp: principal.idp,
        providerId: providerIdOfSubject(principal.subject),
        amr: [...principal.amr],
        authTime: principal.authTime.toISOString(),
      },
    });
  } catch (error) {
    const e = error instanceof ForgeError ? error : unexpected(correlationId);
    const shape = e.toJSON();
    send(res, STATUS_FOR[shape.code] ?? 500, { error: shape });
  }
}
