// MCPForge — W0-P5b: where the portal server keeps a signed-in viewer's tokens.
//
// SERVER-ONLY. W0-P4 §2: the token lives "in the portal **server**, in an
// httpOnly ... cookie session. It is never readable by browser script and
// never rendered." The cookie carries only an opaque, random, 256-bit session
// id. The access token, the refresh token and the principal stay in this
// process's memory, keyed by that id.
//
// **Why memory, not an encrypted cookie.** An encrypted cookie needs a portal
// sealing key, and non-negotiable 8 forbids `SecretStore.get()` in the portal.
// A map needs no key. The cost, stated: restarting the portal server signs
// everyone out, because the refresh tokens were only here. At Wave 0 the
// portal is one process on one machine (CLAUDE.md §3.1), so that is a
// re-sign-in after a restart and nothing worse.
//
// The map hangs off `globalThis` so Next's dev-mode module reloads do not
// silently drop every session.

import { randomBytes } from 'node:crypto';

import type { GatewayGrant } from './gateway-auth';
import type { Persona } from './personas';

/**
 * What the portal holds for a signed-in viewer. For the local provider it is the
 * gateway's grant. For an OIDC provider (W0-P23) it is built from the provider's
 * token response and the gateway's `/auth/principal` answer; its refresh token is
 * the PROVIDER's and, like every token here, never leaves this process. A provider
 * that issued no refresh token leaves it absent: the session then ends when the
 * access token does.
 */
export type ViewerGrant = Omit<GatewayGrant, 'refreshToken'> & { readonly refreshToken?: string };

export interface StoredSession {
  readonly grant: ViewerGrant;
  /**
   * W0-P23: set for an OIDC session, whose idle limit the portal enforces itself
   * (the gateway enforces the local one through the refresh token). Each use
   * extends `grant.idleExpiresAt` by this much; 12 h absolute still caps it.
   */
  readonly idleMs?: number;
  /** The lens the viewer last chose. Checked against HELD personas on every read. */
  readonly selectedPersona: Persona | null;
}

/** One OIDC sign-in in flight: bound to its `state`, single-use, short-lived. */
export interface PendingSignIn {
  readonly providerId: string;
  readonly verifier: string;
  readonly redirectUri: string;
  readonly returnTo: string;
  readonly expiresAt: number;
}

/** Ten minutes is ample to authenticate at a provider and generous for MFA. */
export const PENDING_SIGN_IN_TTL_MS = 10 * 60_000;

interface StoreState {
  readonly sessions: Map<string, StoredSession>;
  readonly renewals: Map<string, Promise<StoredSession | null>>;
  readonly pending: Map<string, PendingSignIn>;
}

const KEY = Symbol.for('mcpforge.portal.viewer-sessions');

function state(): StoreState {
  const g = globalThis as unknown as Record<symbol, StoreState | undefined>;
  g[KEY] ??= { sessions: new Map(), renewals: new Map(), pending: new Map() };
  return g[KEY];
}

/** 256 random bits, base64url. Opaque: it names a session and proves nothing else. */
export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function createSession(
  grant: ViewerGrant,
  options: { readonly idleMs?: number } = {},
): string {
  const id = newSessionId();
  state().sessions.set(id, {
    grant,
    selectedPersona: null,
    ...(options.idleMs === undefined ? {} : { idleMs: options.idleMs }),
  });
  return id;
}

export function startPendingSignIn(
  stateValue: string,
  pending: Omit<PendingSignIn, 'expiresAt'>,
  now: number = Date.now(),
): void {
  const map = state().pending;
  for (const [key, p] of map) if (p.expiresAt <= now) map.delete(key);
  map.set(stateValue, { ...pending, expiresAt: now + PENDING_SIGN_IN_TTL_MS });
}

/** Single use: a `state` that has been presented once never matches again. */
export function takePendingSignIn(
  stateValue: string,
  now: number = Date.now(),
): PendingSignIn | undefined {
  const map = state().pending;
  const found = map.get(stateValue);
  map.delete(stateValue);
  return found !== undefined && found.expiresAt > now ? found : undefined;
}

export function readSession(id: string): StoredSession | undefined {
  return state().sessions.get(id);
}

export function replaceGrant(id: string, grant: ViewerGrant): StoredSession | undefined {
  const current = state().sessions.get(id);
  if (current === undefined) return undefined;
  const next = { ...current, grant };
  state().sessions.set(id, next);
  return next;
}

export function selectPersona(id: string, persona: Persona | null): void {
  const current = state().sessions.get(id);
  if (current !== undefined) state().sessions.set(id, { ...current, selectedPersona: persona });
}

export function deleteSession(id: string): StoredSession | undefined {
  const current = state().sessions.get(id);
  state().sessions.delete(id);
  return current;
}

/**
 * Run one renewal per session at a time. Two requests racing to renew would
 * both present the same refresh token, and the gateway treats the second
 * presentation as theft and ends the session (W0-P5a). So concurrent callers
 * share the first caller's renewal instead.
 */
export function renewOnce(
  id: string,
  renew: () => Promise<StoredSession | null>,
): Promise<StoredSession | null> {
  const s = state();
  const inFlight = s.renewals.get(id);
  if (inFlight !== undefined) return inFlight;
  const running = renew().finally(() => s.renewals.delete(id));
  s.renewals.set(id, running);
  return running;
}

/** Test-only: forget every session. */
export function resetSessionStoreForTests(): void {
  state().sessions.clear();
  state().renewals.clear();
  state().pending.clear();
}
