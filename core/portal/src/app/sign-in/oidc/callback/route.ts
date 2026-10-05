// MCPForge — W0-P23: finish an OIDC sign-in. The redirect URI a human registers at
// the provider is `<portal origin>/sign-in/oidc/callback`.

import { NextResponse, type NextRequest } from 'next/server';

import { ViewerAuthError } from '@/lib/viewer/gateway-auth';
import { completeOidcSignIn } from '@/lib/viewer/oidc-flow';
import { portalOrigin } from '@/lib/viewer/origin';
import { SESSION_COOKIE } from '@/lib/viewer/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = portalOrigin(request.headers);
  const params = request.nextUrl.searchParams;
  const state = params.get('state') ?? '';
  const code = params.get('code') ?? '';
  const bound = request.cookies.get('mcpforge_oidc_state')?.value;
  try {
    if (params.get('error') !== null) {
      throw new ViewerAuthError(
        'REFUSED',
        'The identity provider did not complete the sign-in.',
        'Sign in again. If the provider keeps refusing, ask your MCPForge operator to check this provider’s client registration.',
        'PROVIDER_REFUSED',
      );
    }
    if (state.length === 0 || code.length === 0 || bound !== state) {
      throw new ViewerAuthError(
        'REFUSED',
        'This sign-in did not start in this browser.',
        'Start again from the sign-in page.',
        'STATE_MISMATCH',
      );
    }
    const done = await completeOidcSignIn({ code, state });
    const response = NextResponse.redirect(new URL(done.returnTo, origin));
    response.cookies.set(SESSION_COOKIE, done.sessionId, {
      httpOnly: true,
      sameSite: 'strict',
      secure: origin.startsWith('https:'),
      path: '/',
      expires: new Date(done.grant.sessionExpiresAt),
    });
    response.cookies.delete('mcpforge_oidc_state');
    return response;
  } catch (error) {
    const url = new URL('/sign-in', origin);
    url.searchParams.set(
      'error',
      error instanceof ViewerAuthError ? error.message : 'Sign-in failed unexpectedly.',
    );
    url.searchParams.set(
      'next',
      error instanceof ViewerAuthError
        ? error.next
        : 'Check the portal server log, then sign in again.',
    );
    const response = NextResponse.redirect(url);
    response.cookies.delete('mcpforge_oidc_state');
    return response;
  }
}
