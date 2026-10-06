// MCPForge — W0-P23: the portal's side of authorization code + PKCE for an OIDC
// provider. W0-P4 §2.1.
//
// SERVER-ONLY. The portal is a PUBLIC client at the provider: there is no client
// secret anywhere (non-negotiable 8 forbids `SecretStore.get()` in the portal,
// and the overlay has no field for one). PKCE (RFC 7636, S256) is what binds the
// code to this browser's sign-in.
//
// **The portal interprets no token.** It exchanges the code, then asks the
// gateway (`GET /auth/principal`) who the access token is: the gateway is the
// only verifier, against the provider's own JWKS, issuer and audience. So there
// is no ID-token parsing and no nonce check here, because nothing here would
// trust an ID token's contents. `state` + PKCE carry the login-CSRF defence.
//
// The provider's refresh token is held only in the portal's server session
// (./session-store.ts), never in a cookie and never rendered.

import { createHash, randomBytes } from 'node:crypto';

import { ViewerAuthError, type FetchLike } from './gateway-auth';

/** `<portal origin>/sign-in/oidc/callback`, the redirect URI a human registers at the provider. */
export const OIDC_CALLBACK_PATH = '/sign-in/oidc/callback';

const b64url = (bytes: Buffer): string => bytes.toString('base64url');

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
}

/** A fresh PKCE pair: a 256-bit verifier and its S256 challenge. */
export function newPkce(): Pkce {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

/** 256 random bits, base64url: names one pending sign-in and proves nothing else. */
export function newState(): string {
  return b64url(randomBytes(32));
}

export interface OidcEndpoints {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
}

export function authorizationUrl(
  endpoints: OidcEndpoints,
  args: { readonly redirectUri: string; readonly state: string; readonly challenge: string },
): string {
  const url = new URL(endpoints.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', endpoints.clientId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('scope', endpoints.scopes.join(' '));
  url.searchParams.set('state', args.state);
  url.searchParams.set('code_challenge', args.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface ProviderTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  /** Seconds until the access token expires, as the provider said. */
  readonly expiresInSeconds: number;
}

const DEFAULT_EXPIRES_IN = 300;

async function tokenRequest(
  endpoints: OidcEndpoints,
  body: Record<string, string>,
  fetchImpl: FetchLike | undefined,
): Promise<ProviderTokens> {
  const doFetch = fetchImpl ?? ((input, init) => fetch(input, init));
  let response: Response;
  try {
    response = await doFetch(endpoints.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: endpoints.clientId, ...body }).toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ViewerAuthError(
      'GATEWAY_UNREACHABLE',
      'The identity provider did not answer the sign-in.',
      'Check that the provider is reachable from the portal server, then sign in again.',
    );
  }
  const json = (await response.json().catch(() => undefined)) as
    Record<string, unknown> | undefined;
  if (!response.ok || json === undefined || typeof json['access_token'] !== 'string') {
    // The provider's error code is useful; its description may echo input, so it is not shown.
    const code = typeof json?.['error'] === 'string' ? ` (${json['error']})` : '';
    throw new ViewerAuthError(
      'REFUSED',
      `The identity provider refused the sign-in${code}.`,
      'Sign in again from the start. If it keeps happening, ask your MCPForge operator to check this provider’s client registration and redirect URI.',
      'PROVIDER_REFUSED',
    );
  }
  const expiresIn = json['expires_in'];
  return {
    accessToken: json['access_token'],
    ...(typeof json['refresh_token'] === 'string' && json['refresh_token'].length > 0
      ? { refreshToken: json['refresh_token'] }
      : {}),
    expiresInSeconds:
      typeof expiresIn === 'number' && expiresIn > 0 ? Math.floor(expiresIn) : DEFAULT_EXPIRES_IN,
  };
}

export function exchangeCode(
  endpoints: OidcEndpoints,
  args: { readonly code: string; readonly redirectUri: string; readonly verifier: string },
  fetchImpl?: FetchLike,
): Promise<ProviderTokens> {
  return tokenRequest(
    endpoints,
    {
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: args.redirectUri,
      code_verifier: args.verifier,
    },
    fetchImpl,
  );
}

export function refreshProviderTokens(
  endpoints: OidcEndpoints,
  refreshToken: string,
  fetchImpl?: FetchLike,
): Promise<ProviderTokens> {
  return tokenRequest(
    endpoints,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    fetchImpl,
  );
}
