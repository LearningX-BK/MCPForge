// MCPForge — W0-P23: the two halves of an OIDC sign-in, request-free so they can
// be tested without Next. `app/sign-in/oidc/{start,callback}/route.ts` are thin
// wrappers that add the cookie and the redirect.
//
// SERVER-ONLY.

import {
  fetchPrincipal,
  fetchProviders,
  ViewerAuthError,
  type GatewayAuthOptions,
} from './gateway-auth';
import {
  authorizationUrl,
  exchangeCode,
  newPkce,
  newState,
  OIDC_CALLBACK_PATH,
} from './oidc-client';
import { grantFromProvider, oidcEndpoints } from './refresh';
import {
  createSession,
  startPendingSignIn,
  takePendingSignIn,
  type ViewerGrant,
} from './session-store';

export interface FlowOptions extends GatewayAuthOptions {
  readonly now?: Date;
}

export function callbackUri(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${OIDC_CALLBACK_PATH}`;
}

/** Begin a sign-in at `providerId`: the provider's authorization URL, with this sign-in's state held server-side. */
export async function beginOidcSignIn(
  args: { readonly providerId: string; readonly origin: string; readonly returnTo: string },
  options: FlowOptions = {},
): Promise<{ readonly url: string; readonly state: string }> {
  const { providers } = await fetchProviders(options);
  const provider = providers.find((p) => p.id === args.providerId);
  const endpoints = provider === undefined ? null : oidcEndpoints(provider);
  if (endpoints === null) {
    throw new ViewerAuthError(
      'REFUSED',
      'That sign-in provider is not available.',
      'Choose one of the providers the sign-in page offers.',
    );
  }
  const redirectUri = callbackUri(args.origin);
  const { verifier, challenge } = newPkce();
  const state = newState();
  startPendingSignIn(state, {
    providerId: args.providerId,
    verifier,
    redirectUri,
    returnTo: args.returnTo,
  });
  return { url: authorizationUrl(endpoints, { redirectUri, state, challenge }), state };
}

export interface CompletedSignIn {
  readonly sessionId: string;
  readonly grant: ViewerGrant;
  readonly returnTo: string;
}

/**
 * Finish a sign-in: the `state` must be one this portal started and has not seen
 * before, the code is exchanged with the PKCE verifier, and the GATEWAY says who
 * the access token is. A person the gateway cannot resolve (`IDENTITY_UNRESOLVED`)
 * gets no session.
 */
export async function completeOidcSignIn(
  args: { readonly code: string; readonly state: string },
  options: FlowOptions = {},
): Promise<CompletedSignIn> {
  const pending = takePendingSignIn(args.state);
  if (pending === undefined) {
    throw new ViewerAuthError(
      'REFUSED',
      'This sign-in did not start here, or it has expired or was already used.',
      'Start again from the sign-in page.',
      'STATE_MISMATCH',
    );
  }
  const { providers, sessionLimits } = await fetchProviders(options);
  const provider = providers.find((p) => p.id === pending.providerId);
  const endpoints = provider === undefined ? null : oidcEndpoints(provider);
  if (endpoints === null) {
    throw new ViewerAuthError(
      'REFUSED',
      'That sign-in provider is no longer configured.',
      'Choose one of the providers the sign-in page offers.',
    );
  }
  const tokens = await exchangeCode(
    endpoints,
    { code: args.code, redirectUri: pending.redirectUri, verifier: pending.verifier },
    options.fetch,
  );
  const principal = await fetchPrincipal(tokens.accessToken, options);
  if (principal.providerId !== pending.providerId) {
    // A token that resolves under another provider than the one signed in at.
    throw new ViewerAuthError(
      'REFUSED',
      'The sign-in resolved to a different provider than the one chosen.',
      'Start again from the sign-in page and choose your provider.',
      'PROVIDER_MISMATCH',
    );
  }
  const grant = grantFromProvider(tokens, principal, sessionLimits, options.now);
  return {
    sessionId: createSession(grant, { idleMs: sessionLimits.idleSeconds * 1000 }),
    grant,
    returnTo: pending.returnTo,
  };
}
