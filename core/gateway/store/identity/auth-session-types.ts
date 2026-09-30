// MCPForge — the `auth_session` / `auth_refresh_token` repository interface.
// W0-P5a, W0-P4 §9 decision 6.
//
// Persistence and the rotation state machine only. This module never sees a
// refresh token VALUE: callers hash it first (`core/gateway/identity/local/
// sign-in.ts`), and every method here takes and returns `tokenHash`. It mints
// no access token, verifies no password and decides no limit. The idle and
// absolute deadlines arrive as timestamps the caller computed.

/** Why a session ended. Closed: a new reason is a reviewed change. */
export const AUTH_SESSION_REVOKED_REASONS = [
  'signed_out',
  'refresh_reuse',
  'idle_expired',
  'absolute_expired',
  'account_unavailable',
  // W0-P29: the account's password was reset, so every session it held ends.
  'credential_reset',
] as const;
export type AuthSessionRevokedReason = (typeof AUTH_SESSION_REVOKED_REASONS)[number];

export interface AuthSessionRecord {
  /** `ses_` + UUIDv7. */
  readonly id: string;
  /** `Principal.subject`. */
  readonly subject: string;
  readonly providerId: string;
  readonly amr: readonly string[];
  readonly createdAt: string;
  readonly absoluteExpiresAt: string;
  readonly revokedAt: string | null;
  readonly revokedReason: AuthSessionRevokedReason | null;
}

export interface RefreshTokenRecord {
  readonly id: string;
  readonly sessionId: string;
  /** SHA-256 of the token. The value itself is never stored. */
  readonly tokenHash: string;
  readonly issuedAt: string;
  readonly idleExpiresAt: string;
  readonly spentAt: string | null;
  /** The id of the token that replaced this one when it was spent. */
  readonly replacedBy: string | null;
}

export interface OpenAuthSessionInput {
  readonly subject: string;
  readonly providerId: string;
  readonly amr: readonly string[];
  readonly tokenHash: string;
  readonly now: string;
  readonly idleExpiresAt: string;
  readonly absoluteExpiresAt: string;
}

export interface RotateRefreshTokenInput {
  /** Hash of the token the caller presented. */
  readonly presentedHash: string;
  /** Hash of the replacement the caller will hand out if rotation succeeds. */
  readonly newHash: string;
  readonly now: string;
  /** The replacement's idle deadline. The caller clamps it to the absolute one. */
  readonly idleExpiresAt: string;
}

/**
 * The outcome of one renewal attempt. Only `rotated` renews. Every other
 * outcome is terminal for the presented token, and `reused`, `idle_expired`
 * and `absolute_expired` also revoke the session in the same transaction.
 */
export type RotateRefreshTokenOutcome =
  | {
      readonly kind: 'rotated';
      readonly session: AuthSessionRecord;
      readonly token: RefreshTokenRecord;
    }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'revoked'; readonly session: AuthSessionRecord }
  | { readonly kind: 'reused'; readonly session: AuthSessionRecord }
  | { readonly kind: 'idle_expired'; readonly session: AuthSessionRecord }
  | { readonly kind: 'absolute_expired'; readonly session: AuthSessionRecord };

export interface AuthSessionRepository {
  /** Start a session with its first refresh token. */
  open(
    input: OpenAuthSessionInput,
  ): Promise<{ readonly session: AuthSessionRecord; readonly token: RefreshTokenRecord }>;
  get(sessionId: string): Promise<AuthSessionRecord | undefined>;
  findByTokenHash(
    tokenHash: string,
  ): Promise<
    { readonly session: AuthSessionRecord; readonly token: RefreshTokenRecord } | undefined
  >;
  /**
   * Spend the presented token and issue its replacement, atomically. A spent
   * token presented again revokes the session (`refresh_reuse`). Of two
   * concurrent renewals with the same token, exactly one rotates. The other is
   * treated as reuse, because a legitimate client never renews twice with one
   * token.
   */
  rotate(input: RotateRefreshTokenInput): Promise<RotateRefreshTokenOutcome>;
  /** End a session. Idempotent: an already-revoked session keeps its first reason. */
  revoke(sessionId: string, reason: AuthSessionRevokedReason, now: string): Promise<void>;
  /**
   * W0-P29 — end EVERY live session of `subject` (a password reset, a disabled
   * account). Same first-reason-stands rule as `revoke`. Returns how many
   * sessions this call ended.
   */
  revokeAllForSubject(
    subject: string,
    reason: AuthSessionRevokedReason,
    now: string,
  ): Promise<number>;
}
