// MCPForge — W0-P23: begin an OIDC sign-in (authorization code + PKCE).
// GET /sign-in/oidc/start?provider=<id>&returnTo=<path>

import { NextResponse, type NextRequest } from 'next/server';

import { safeReturnTo } from '@/lib/viewer/actions';
import { ViewerAuthError } from '@/lib/viewer/gateway-auth';
import { beginOidcSignIn } from '@/lib/viewer/oidc-flow';
import { portalOrigin } from '@/lib/viewer/origin';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const providerId = request.nextUrl.searchParams.get('provider') ?? '';
  const returnTo = await safeReturnTo(request.nextUrl.searchParams.get('returnTo'));
  const origin = portalOrigin(request.headers);
  try {
    const { url, state } = await beginOidcSignIn({ providerId, origin, returnTo });
    const response = NextResponse.redirect(url);
    // Binds the state to THIS browser (login CSRF). Lax, not Strict: the provider's
    // redirect back is a cross-site top-level navigation, which Strict would drop.
    response.cookies.set('mcpforge_oidc_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: origin.startsWith('https:'),
      path: '/sign-in/oidc',
      maxAge: 600,
    });
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
    return NextResponse.redirect(url);
  }
}
