'use server';
// MCPForge — W0-P5b: sign in, sign out, choose a lens. W0-P4 §2 and §6.
//
// Server actions, so the password and the tokens never touch browser script.
// Sign-in goes THROUGH the gateway (`POST /auth/local/token`); the portal
// verifies nothing itself. The cookie holds an opaque session id, httpOnly,
// `SameSite=Strict`, and `Secure` whenever the portal is not on loopback.

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { gatewaySignIn, gatewaySignOut, ViewerAuthError } from './gateway-auth';
import { isPersona, PERSONA_LABEL } from './personas';
import { createSession, deleteSession, selectPersona } from './session-store';
import { getViewer, SESSION_COOKIE, sessionIdFromCookies } from './session';

export interface ActionRefusal {
  readonly message: string;
  readonly next: string;
}

export interface SignInState {
  readonly error?: ActionRefusal;
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Only a same-origin path may be a post-sign-in destination. */
export async function safeReturnTo(value: unknown): Promise<string> {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.includes('\\') || value.startsWith('/sign-in')) return '/';
  return value;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export async function signInAction(_prev: SignInState, form: FormData): Promise<SignInState> {
  const username = field(form, 'username').trim();
  const password = field(form, 'password');
  const totpCode = field(form, 'totpCode').trim();
  if (username.length === 0 || password.length === 0) {
    return {
      error: {
        message: 'Enter your username and password.',
        next: 'Fill in both fields (and your 6-digit code if your account is enrolled), then sign in.',
      },
    };
  }
  let sessionExpiresAt: string;
  let id: string;
  try {
    const grant = await gatewaySignIn({
      username,
      password,
      ...(totpCode.length > 0 ? { totpCode } : {}),
    });
    id = createSession(grant);
    sessionExpiresAt = grant.sessionExpiresAt;
  } catch (error) {
    if (error instanceof ViewerAuthError)
      return { error: { message: error.message, next: error.next } };
    return {
      error: {
        message: 'Sign-in failed unexpectedly.',
        next: 'Check the portal server log, then sign in again.',
      },
    };
  }
  const host = (await headers()).get('host') ?? '';
  (await cookies()).set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'strict',
    secure: !LOOPBACK.test(host),
    path: '/',
    expires: new Date(sessionExpiresAt),
  });
  redirect(await safeReturnTo(form.get('returnTo')));
}

export async function signOutAction(): Promise<void> {
  const id = await sessionIdFromCookies();
  if (id !== undefined) {
    const session = deleteSession(id);
    if (session !== undefined) {
      // Best effort: the portal session is gone either way, and a gateway that
      // is down cannot renew the token anyway.
      await gatewaySignOut(session.grant.refreshToken).catch(() => undefined);
    }
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/sign-in');
}

export type SelectPersonaResult = { readonly ok: true } | ({ readonly ok: false } & ActionRefusal);

/** Choose a lens. Only a HELD persona is accepted; the choice never changes a gate. */
export async function selectPersonaAction(persona: string): Promise<SelectPersonaResult> {
  const viewer = await getViewer();
  const id = await sessionIdFromCookies();
  if (viewer === null || id === undefined) {
    return {
      ok: false,
      message: 'You are not signed in.',
      next: 'Sign in, then choose a persona.',
    };
  }
  if (!isPersona(persona) || !viewer.personas.includes(persona)) {
    const label = isPersona(persona) ? PERSONA_LABEL[persona] : persona;
    return {
      ok: false,
      message: `You do not hold the ${label} persona.`,
      next: 'Ask your MCPForge operator to add one of your groups to that persona in the deployment mapping (overlays/<deployment>/mappings/groups-to-roles.yaml); it is a reviewed change.',
    };
  }
  selectPersona(id, persona);
  return { ok: true };
}
