// MCPForge — W0-P23: renewing a viewer's grant, whichever provider issued it.
//
// SERVER-ONLY. The local provider renews through the gateway's own endpoint
// (W0-P5a). An OIDC provider is renewed at the PROVIDER's token endpoint with the
// refresh token the portal server holds, and the gateway is then asked again who
// the new access token is, so a change in the person's groups at the provider
// reaches the next request. Any failure ends the portal session (./viewer.ts).

import {
  fetchPrincipal,
  fetchProviders,
  gatewayRefresh,
  ViewerAuthError,
  type GatewayAuthOptions,
  type GatewayPrincipal,
  type PublicProvider,
} from './gateway-auth';
import { refreshProviderTokens, type OidcEndpoints, type ProviderTokens } from './oidc-client';
import type { ViewerGrant } from './session-store';

export const LOCAL_PROVIDER_ID = 'local';

/** The endpoints a portal needs for one OIDC provider, or `null` if the gateway did not publish them. */
export function oidcEndpoints(provider: PublicProvider): OidcEndpoints | null {
  const { authorizationEndpoint, tokenEndpoint, clientId, scopes } = provider;
  if (
    provider.kind !== 'oidc' ||
    authorizationEndpoint === undefined ||
    tokenEndpoint === undefined ||
    clientId === undefined
  ) {
    return null;
  }
  return { authorizationEndpoint, tokenEndpoint, clientId, scopes: scopes ?? ['openid'] };
}

/**
 * The grant for a fresh OIDC sign-in. The portal sets the idle and absolute
 * limits itself, from the deployment's `identity.sessionLimits` as the gateway
 * published them. The access token's own expiry is the provider's.
 */
export function grantFromProvider(
  tokens: ProviderTokens,
  principal: GatewayPrincipal,
  limits: { readonly idleSeconds: number; readonly absoluteSeconds: number },
  now: Date = new Date(),
): ViewerGrant {
  const at = (ms: number): string => new Date(now.getTime() + ms).toISOString();
  return {
    tokenType: 'Bearer',
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: at(tokens.expiresInSeconds * 1000),
    ...(tokens.refreshToken === undefined ? {} : { refreshToken: tokens.refreshToken }),
    idleExpiresAt: at(limits.idleSeconds * 1000),
    sessionExpiresAt: at(limits.absoluteSeconds * 1000),
    principal,
  };
}

export async function refreshGrant(
  grant: ViewerGrant,
  options: GatewayAuthOptions & { readonly now?: Date } = {},
): Promise<ViewerGrant> {
  const providerId = grant.principal.providerId;
  if (providerId === LOCAL_PROVIDER_ID) {
    if (grant.refreshToken === undefined) throw noRefreshToken();
    return gatewayRefresh(grant.refreshToken, options);
  }
  if (grant.refreshToken === undefined) throw noRefreshToken();
  const { providers } = await fetchProviders(options);
  const provider = providers.find((p) => p.id === providerId);
  const endpoints = provider === undefined ? null : oidcEndpoints(provider);
  if (endpoints === null) {
    throw new ViewerAuthError(
      'REFUSED',
      `The deployment no longer configures the identity provider "${providerId}".`,
      'Sign in again with one of the providers the sign-in page offers.',
    );
  }
  const tokens = await refreshProviderTokens(endpoints, grant.refreshToken, options.fetch);
  const principal = await fetchPrincipal(tokens.accessToken, options);
  const now = options.now ?? new Date();
  return {
    tokenType: 'Bearer',
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: new Date(now.getTime() + tokens.expiresInSeconds * 1000).toISOString(),
    // A provider may rotate the refresh token; keep the one in force.
    refreshToken: tokens.refreshToken ?? grant.refreshToken,
    idleExpiresAt: grant.idleExpiresAt,
    sessionExpiresAt: grant.sessionExpiresAt,
    principal,
  };
}

function noRefreshToken(): ViewerAuthError {
  return new ViewerAuthError(
    'REFUSED',
    'This sign-in has no refresh token, so it cannot be renewed.',
    'Sign in again.',
  );
}
