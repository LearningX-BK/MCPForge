// MCPForge — W0-P5b: the portal server's calls to the gateway's local token
// endpoint (W0-P5a: `POST /auth/local/token | refresh | signout`).
//
// SERVER-ONLY. Never import from a client component: these calls carry a
// password and refresh tokens, and W0-P4 §2 requires that neither ever reaches
// the browser. R8 (02 §6.5) is kept: the portal reaches the gateway over HTTP
// and imports nothing from `@mcpforge/gateway` to sign anyone in. It never
// reads the user store and never verifies a password itself.
//
// A gateway refusal is passed through with the gateway's own message and
// `next` (W0-P4 §3: "the gateway's own ForgeError, rendered verbatim").

import { z } from 'zod';

const principalSchema = z.object({
  subject: z.string().min(1),
  displayName: z.string(),
  email: z.string().optional(),
  groups: z.array(z.string()),
  idp: z.string(),
  providerId: z.string(),
  amr: z.array(z.string()),
  authTime: z.string(),
});

const grantSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.string().min(1),
  refreshToken: z.string().min(1),
  idleExpiresAt: z.string().min(1),
  sessionExpiresAt: z.string().min(1),
  principal: principalSchema,
});

export type GatewayGrant = z.infer<typeof grantSchema>;
export type GatewayPrincipal = z.infer<typeof principalSchema>;

const refusalSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), next: z.string() }),
});

export type ViewerAuthErrorCode = 'REFUSED' | 'GATEWAY_UNREACHABLE' | 'GATEWAY_ERROR';

/** A sign-in, renewal or sign-out that did not succeed, with its `next`. */
export class ViewerAuthError extends Error {
  readonly code: ViewerAuthErrorCode;
  /** The gateway's own error code when it refused, e.g. `AUTH_REQUIRED`. */
  readonly gatewayCode: string | undefined;
  readonly next: string;

  constructor(code: ViewerAuthErrorCode, message: string, next: string, gatewayCode?: string) {
    super(message);
    this.name = 'ViewerAuthError';
    this.code = code;
    this.next = next;
    this.gatewayCode = gatewayCode;
  }
}

/**
 * Where the gateway listens. `MCPFORGE_GATEWAY_URL` wins; otherwise the same
 * `MCPFORGE_GATEWAY_PORT` the gateway's own entrypoint reads (default 3939),
 * on loopback.
 */
export function gatewayBaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const explicit = env['MCPFORGE_GATEWAY_URL'];
  if (explicit !== undefined && explicit.length > 0) return explicit.replace(/\/+$/, '');
  return `http://127.0.0.1:${env['MCPFORGE_GATEWAY_PORT'] ?? '3939'}`;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface GatewayAuthOptions {
  readonly baseUrl?: string;
  readonly fetch?: FetchLike;
}

async function post(path: string, body: unknown, options: GatewayAuthOptions): Promise<Response> {
  const url = `${options.baseUrl ?? gatewayBaseUrl()}${path}`;
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  try {
    return await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ViewerAuthError(
      'GATEWAY_UNREACHABLE',
      'The MCPForge gateway is not reachable, so nobody can sign in right now.',
      `Start the gateway (it listens on ${options.baseUrl ?? gatewayBaseUrl()}), then sign in again.`,
    );
  }
}

async function readGrant(response: Response): Promise<GatewayGrant> {
  const json: unknown = await response.json().catch(() => undefined);
  if (response.ok) {
    const parsed = grantSchema.safeParse(json);
    if (parsed.success) return parsed.data;
    throw new ViewerAuthError(
      'GATEWAY_ERROR',
      'The gateway answered the sign-in with a response the portal does not understand.',
      'Check that the portal and gateway come from the same MCPForge build, then sign in again.',
    );
  }
  return refusal(json, response.status);
}

function refusal(json: unknown, status: number): never {
  const parsed = refusalSchema.safeParse(json);
  if (parsed.success) {
    const { code, message, next } = parsed.data.error;
    throw new ViewerAuthError('REFUSED', message, next, code);
  }
  throw new ViewerAuthError(
    'GATEWAY_ERROR',
    `The gateway refused the request (HTTP ${status}) without saying why.`,
    'Check the gateway log for this request, then sign in again.',
  );
}

export interface SignInCredentials {
  readonly username: string;
  readonly password: string;
  readonly totpCode?: string;
}

export async function gatewaySignIn(
  credentials: SignInCredentials,
  options: GatewayAuthOptions = {},
): Promise<GatewayGrant> {
  return readGrant(await post('/auth/local/token', credentials, options));
}

export async function gatewayRefresh(
  refreshToken: string,
  options: GatewayAuthOptions = {},
): Promise<GatewayGrant> {
  return readGrant(await post('/auth/local/refresh', { refreshToken }, options));
}

export async function gatewaySignOut(
  refreshToken: string,
  options: GatewayAuthOptions = {},
): Promise<void> {
  const response = await post('/auth/local/signout', { refreshToken }, options);
  if (!response.ok) refusal(await response.json().catch(() => undefined), response.status);
}

// ---------------------------------------------------------------------------
// W0-P23 — which providers to offer, and who an OIDC access token is.
// ---------------------------------------------------------------------------

const publicProviderSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['local', 'oidc']),
  displayName: z.string(),
  issuer: z.string().optional(),
  authorizationEndpoint: z.string().optional(),
  tokenEndpoint: z.string().optional(),
  clientId: z.string().optional(),
  scopes: z.array(z.string()).optional(),
});

const providersSchema = z.object({
  providers: z.array(publicProviderSchema),
  sessionLimits: z.object({
    idleSeconds: z.number().positive(),
    absoluteSeconds: z.number().positive(),
  }),
});

export type PublicProvider = z.infer<typeof publicProviderSchema>;
export type ProvidersResponse = z.infer<typeof providersSchema>;

async function get(
  path: string,
  headers: Record<string, string>,
  options: GatewayAuthOptions,
): Promise<Response> {
  const url = `${options.baseUrl ?? gatewayBaseUrl()}${path}`;
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  try {
    return await doFetch(url, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ViewerAuthError(
      'GATEWAY_UNREACHABLE',
      'The MCPForge gateway is not reachable, so nobody can sign in right now.',
      `Start the gateway (it listens on ${options.baseUrl ?? gatewayBaseUrl()}), then sign in again.`,
    );
  }
}

/** The providers the deployment configures, public facts only (`GET /auth/providers`). */
export async function fetchProviders(options: GatewayAuthOptions = {}): Promise<ProvidersResponse> {
  const response = await get('/auth/providers', {}, options);
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) return refusal(json, response.status);
  const parsed = providersSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  throw new ViewerAuthError(
    'GATEWAY_ERROR',
    'The gateway answered with a provider list the portal does not understand.',
    'Check that the portal and gateway come from the same MCPForge build, then sign in again.',
  );
}

/**
 * Who `accessToken` is, according to the gateway, the only verifier (against the
 * provider's own JWKS, issuer and audience). The portal interprets no token.
 */
export async function fetchPrincipal(
  accessToken: string,
  options: GatewayAuthOptions = {},
): Promise<GatewayPrincipal> {
  const response = await get(
    '/auth/principal',
    { authorization: `Bearer ${accessToken}` },
    options,
  );
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) return refusal(json, response.status);
  const parsed = z.object({ principal: principalSchema }).safeParse(json);
  if (parsed.success) return parsed.data.principal;
  throw new ViewerAuthError(
    'GATEWAY_ERROR',
    'The gateway answered with a principal the portal does not understand.',
    'Check that the portal and gateway come from the same MCPForge build, then sign in again.',
  );
}
