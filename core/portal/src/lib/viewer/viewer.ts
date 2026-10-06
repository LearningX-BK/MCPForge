// MCPForge — W0-P5b: who is looking at the portal, resolved on the server.
//
// SERVER-ONLY. The request-free core of `./session.ts`: given a session id,
// produce the `Viewer`, renewing the access token silently first when it is
// near expiry (W0-P4 §9 decision 6, "seamless, not a 15-minute re-prompt").
// Kept free of `next/headers` so it is testable on its own.
//
// **Personas are resolved on every request, from git.** They are never stored
// on the session and never taken from the token. So a reviewed change to the
// mapping's `personas:` block applies to signed-in viewers on their next
// request, and a persona can only come from a file a reviewer approved.

import { effectivePersona, type Persona } from './personas';
import {
  deleteSession,
  readSession,
  renewOnce,
  replaceGrant,
  type StoredSession,
  type ViewerGrant,
} from './session-store';

/** Renew when the access token has less than this left, so a request never carries an expired one. */
export const RENEW_BEFORE_EXPIRY_MS = 60_000;

/**
 * The viewer as the portal's UI and actions may see it. It carries no token:
 * a `Viewer` can be handed to a client component without leaking a
 * credential. `subject` is the only identity value the portal may store (an
 * author, a requester), per 02 §4.4 item 3.
 */
export interface Viewer {
  readonly subject: string;
  readonly displayName: string;
  readonly email?: string;
  readonly groups: readonly string[];
  /** Personas the viewer HOLDS, from the git mapping. The only input to a gate. */
  readonly personas: readonly Persona[];
  /** The lens in effect: a held persona, or null when none is held. Never a gate input. */
  readonly persona: Persona | null;
  readonly sessionExpiresAt: string;
}

export interface ResolveViewerDeps {
  readonly now?: () => Date;
  /** Renews a grant. Which provider does it is the caller's dispatch on `grant.principal.providerId`. */
  readonly refresh: (grant: ViewerGrant) => Promise<ViewerGrant>;
  /** W0-P23: personas are looked up under the member's own provider, so the subject is needed. */
  readonly personasFor: (member: {
    readonly subject: string;
    readonly groups: readonly string[];
  }) => readonly Persona[];
}

function viewerFrom(session: StoredSession, deps: ResolveViewerDeps): Viewer {
  const p = session.grant.principal;
  const personas = deps.personasFor({ subject: p.subject, groups: p.groups });
  return {
    subject: p.subject,
    displayName: p.displayName,
    ...(p.email === undefined ? {} : { email: p.email }),
    groups: p.groups,
    personas,
    persona: effectivePersona(session.selectedPersona, personas),
    sessionExpiresAt: session.grant.sessionExpiresAt,
  };
}

/**
 * The live session for `id`, renewed when due, or `null`. Renewal failure of
 * any kind ends the portal session. The viewer is then simply signed out, and
 * the gateway has already refused the old token.
 */
export async function resolveSession(
  id: string,
  deps: ResolveViewerDeps,
): Promise<StoredSession | null> {
  const session = readSession(id);
  if (session === undefined) return null;
  const now = (deps.now ?? (() => new Date()))().getTime();
  if (now >= Date.parse(session.grant.sessionExpiresAt)) {
    deleteSession(id);
    return null;
  }
  // W0-P23: an OIDC session's idle limit is the portal's to enforce. Use extends it.
  if (session.idleMs !== undefined) {
    if (now >= Date.parse(session.grant.idleExpiresAt)) {
      deleteSession(id);
      return null;
    }
    const idleExpiresAt = new Date(
      Math.min(now + session.idleMs, Date.parse(session.grant.sessionExpiresAt)),
    ).toISOString();
    replaceGrant(id, { ...session.grant, idleExpiresAt });
  }
  const live = readSession(id) ?? session;
  if (Date.parse(live.grant.accessTokenExpiresAt) - now > RENEW_BEFORE_EXPIRY_MS) {
    return live;
  }
  return renewOnce(id, async () => {
    // Re-read inside the single flight: a concurrent caller may have renewed.
    const current = readSession(id);
    if (current === undefined) return null;
    if (Date.parse(current.grant.accessTokenExpiresAt) - now > RENEW_BEFORE_EXPIRY_MS) {
      return current;
    }
    try {
      return replaceGrant(id, await deps.refresh(current.grant)) ?? null;
    } catch {
      deleteSession(id);
      return null;
    }
  });
}

export async function resolveViewer(id: string, deps: ResolveViewerDeps): Promise<Viewer | null> {
  const session = await resolveSession(id, deps);
  return session === null ? null : viewerFrom(session, deps);
}
