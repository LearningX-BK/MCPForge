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

export interface StoredSession {
  readonly grant: GatewayGrant;
  /** The lens the viewer last chose. Checked against HELD personas on every read. */
  readonly selectedPersona: Persona | null;
}

interface StoreState {
  readonly sessions: Map<string, StoredSession>;
  readonly renewals: Map<string, Promise<StoredSession | null>>;
}

const KEY = Symbol.for('mcpforge.portal.viewer-sessions');

function state(): StoreState {
  const g = globalThis as unknown as Record<symbol, StoreState | undefined>;
  g[KEY] ??= { sessions: new Map(), renewals: new Map() };
  return g[KEY];
}

/** 256 random bits, base64url. Opaque: it names a session and proves nothing else. */
export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function createSession(grant: GatewayGrant): string {
  const id = newSessionId();
  state().sessions.set(id, { grant, selectedPersona: null });
  return id;
}

export function readSession(id: string): StoredSession | undefined {
  return state().sessions.get(id);
}

export function replaceGrant(id: string, grant: GatewayGrant): StoredSession | undefined {
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
}
