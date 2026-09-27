// MCPForge — the local provider's sign-in, renewal and sign-out. W0-P5a.
//
// W0-P4 §2 and §9 decision 6. The gateway is the local provider's token
// endpoint. The portal, or any client a human signs in through, asks it for a
// token and never verifies a password itself. This module composes three
// pieces that already exist, and adds only the renewal:
//
//   LocalUserStore.authenticate  ->  LocalIdentityProvider.issueToken  ->  auth_session
//   (the credential check, W0-D2)    (the 15-minute JWT, W0-D1)            (the renewal)
//
// **What a sign-in grants, and what it does not.** A token proves who the human
// is, and nothing more. Every `/mcp` session, and later every `/api/v1/**`
// read, still needs a registered consumer as well as this human
// (non-negotiable 6). The owner decided on 27 Sep 2026 that the sign-in
// endpoint itself asks for the human only, as any IdP token endpoint does;
// brute force is held by `LocalUserStore`'s lockout.
//
// **The refresh token is a credential.** It is 256 random bits, returned to the
// caller once per issue, and stored only as its SHA-256. It is never logged,
// never put in an error, and never written to audit. Rotation and reuse
// detection are the repository's (`store/identity/auth-session.ts`).

import { createHash, randomBytes } from 'node:crypto';
import { forgeError, type ForgeError } from '@mcpforge/shared/errors';
import type { AuthSessionRecord, RuntimeStore } from '../../store/index.js';
import type { LocalIdentityProvider } from '../local.js';
import type { IdentityProviderKind } from '../types.js';
import type { LocalSignIn, LocalUserStore } from './store.js';

/** W0-P4 §9 decision 6: 8 hours idle. */
export const DEFAULT_SESSION_IDLE_SECONDS = 8 * 60 * 60;
/** W0-P4 §9 decision 6: 12 hours absolute. */
export const DEFAULT_SESSION_ABSOLUTE_SECONDS = 12 * 60 * 60;
/** Recognisable in a secret scan; carries no meaning beyond that. */
export const REFRESH_TOKEN_PREFIX = 'mfr_' as const;
const REFRESH_TOKEN_BYTES = 32;

/** The provider id sessions from this module carry. */
export const LOCAL_PROVIDER_ID = 'local' as const;

export interface SessionLimits {
  readonly idleSeconds: number;
  readonly absoluteSeconds: number;
}

/**
 * The human a grant names: presentation plus the audit key. `subject` is the
 * only field a caller may store as an identity value (02 §4.4 item 3).
 */
export interface SignedInPrincipal {
  readonly subject: string;
  readonly displayName: string;
  readonly email?: string;
  readonly groups: readonly string[];
  readonly idp: IdentityProviderKind;
  readonly providerId: string;
  readonly amr: readonly string[];
  readonly authTime: string;
}

/** What a successful sign-in or renewal hands back. */
export interface SignInGrant {
  /** The 15-minute bearer JWT. Never logged, never stored. */
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  /** Single use. Presenting it twice ends the session. Never logged, never stored. */
  readonly refreshToken: string;
  /** When the next renewal is refused for idleness, unless one happens first. */
  readonly idleExpiresAt: string;
  /** When renewal stops regardless of activity. */
  readonly sessionExpiresAt: string;
  readonly sessionId: string;
  readonly principal: SignedInPrincipal;
}

export interface LocalSignInService {
  signIn(input: LocalSignIn, correlationId: string): Promise<SignInGrant>;
  refresh(refreshToken: string, correlationId: string): Promise<SignInGrant>;
  /** Ends the session the token belongs to. Succeeds silently for an unknown token. */
  signOut(refreshToken: string, correlationId: string): Promise<void>;
}

export interface LocalSignInServiceOptions {
  readonly store: RuntimeStore;
  readonly users: LocalUserStore;
  readonly provider: LocalIdentityProvider;
  readonly limits?: Partial<SessionLimits>;
  /** Injectable clock, so tests do not depend on wall time. */
  readonly now?: () => Date;
}

/**
 * One refusal for every renewal failure. Saying "reused" to the caller would
 * tell a thief their copy was noticed, and "expired" versus "signed out" helps
 * nobody decide anything different: the remedy is the same.
 */
function sessionEnded(correlationId: string): ForgeError {
  return forgeError(
    'AUTH_REQUIRED',
    'This sign-in session has ended and cannot be renewed.',
    correlationId,
    {
      condition:
        'The refresh token is unknown, was already used, belongs to a session that was signed out, or the session passed its idle or absolute limit.',
      next: 'Sign in again with your username and password (and your 6-digit code if enrolled); a new session starts and nothing you proposed is lost.',
    },
  );
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function mintRefreshToken(): string {
  return `${REFRESH_TOKEN_PREFIX}${randomBytes(REFRESH_TOKEN_BYTES).toString('base64url')}`;
}

function plusSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function earlier(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function assertLimits(limits: SessionLimits): void {
  const ok = (n: number) => Number.isInteger(n) && n > 0;
  if (!ok(limits.idleSeconds) || !ok(limits.absoluteSeconds)) {
    throw new Error('Session limits must be positive whole seconds.');
  }
  if (limits.idleSeconds > limits.absoluteSeconds) {
    throw new Error('The idle limit cannot be longer than the absolute limit.');
  }
}

export function localSignInService(options: LocalSignInServiceOptions): LocalSignInService {
  const limits: SessionLimits = {
    idleSeconds: options.limits?.idleSeconds ?? DEFAULT_SESSION_IDLE_SECONDS,
    absoluteSeconds: options.limits?.absoluteSeconds ?? DEFAULT_SESSION_ABSOLUTE_SECONDS,
  };
  assertLimits(limits);
  const now = options.now ?? (() => new Date());
  const sessions = options.store.authSessions;

  async function grantFor(
    session: AuthSessionRecord,
    refreshToken: string,
    idleExpiresAt: string,
    correlationId: string,
  ): Promise<SignInGrant> {
    const issued = await options.provider.issueToken(session.subject, session.amr, correlationId, {
      authTime: new Date(session.createdAt),
    });
    const c = issued.claims;
    return {
      accessToken: issued.token,
      accessTokenExpiresAt: issued.expiresAt.toISOString(),
      refreshToken,
      idleExpiresAt,
      sessionExpiresAt: session.absoluteExpiresAt,
      sessionId: session.id,
      principal: {
        subject: c.sub,
        displayName: c.name,
        ...(c.email === undefined ? {} : { email: c.email }),
        groups: Object.freeze([...c.groups]),
        idp: c.idp,
        providerId: session.providerId,
        amr: Object.freeze([...c.amr]),
        authTime: new Date(c.auth_time * 1000).toISOString(),
      },
    };
  }

  return {
    async signIn(input, correlationId) {
      // The credential check. Every failure is one AUTH_REQUIRED (W0-D2).
      const authenticated = await options.users.authenticate(input, correlationId);
      const at = now();
      const absolute = plusSeconds(at, limits.absoluteSeconds);
      const idle = earlier(plusSeconds(at, limits.idleSeconds), absolute);
      const refreshToken = mintRefreshToken();
      const { session } = await sessions.open({
        subject: authenticated.subject,
        providerId: LOCAL_PROVIDER_ID,
        amr: authenticated.amr,
        tokenHash: hashRefreshToken(refreshToken),
        now: at.toISOString(),
        idleExpiresAt: idle.toISOString(),
        absoluteExpiresAt: absolute.toISOString(),
      });
      return grantFor(session, refreshToken, idle.toISOString(), correlationId);
    },

    async refresh(refreshToken, correlationId) {
      if (typeof refreshToken !== 'string' || !refreshToken.startsWith(REFRESH_TOKEN_PREFIX)) {
        throw sessionEnded(correlationId);
      }
      const at = now();
      const replacement = mintRefreshToken();
      // The absolute limit is enforced from the session row on every renewal,
      // so the idle deadline written here needs no clamp to be safe. The clamp
      // below only makes the deadline reported to the caller honest.
      const outcome = await sessions.rotate({
        presentedHash: hashRefreshToken(refreshToken),
        newHash: hashRefreshToken(replacement),
        now: at.toISOString(),
        idleExpiresAt: plusSeconds(at, limits.idleSeconds).toISOString(),
      });
      if (outcome.kind !== 'rotated') throw sessionEnded(correlationId);

      const idle = earlier(
        new Date(outcome.token.idleExpiresAt),
        new Date(outcome.session.absoluteExpiresAt),
      );
      try {
        return await grantFor(outcome.session, replacement, idle.toISOString(), correlationId);
      } catch (error) {
        // `issueToken` refuses an account that is now disabled or gone. That
        // ends the session here, rather than leaving a renewable session for an
        // account nobody may use (W0-P4 §9: "disabling the account stops
        // renewal at the next refresh").
        await sessions.revoke(outcome.session.id, 'account_unavailable', at.toISOString());
        throw error;
      }
    },

    async signOut(refreshToken) {
      if (typeof refreshToken !== 'string' || !refreshToken.startsWith(REFRESH_TOKEN_PREFIX)) {
        return;
      }
      const found = await sessions.findByTokenHash(hashRefreshToken(refreshToken));
      if (found === undefined) return;
      await sessions.revoke(found.session.id, 'signed_out', now().toISOString());
    },
  };
}
