// MCPForge — the `local_user` / `local_user_group` repository interface.
// W0-D2, 02 §4.4, persisted under 02 §10.2's rule that all runtime persistence
// goes through a thin repository interface.
//
// **The one thing to understand about this file.** There are two record types
// for a local account, and the split is the security boundary of W0-D2:
//
// - `LocalUserRecord` is what everything above the store may see. It carries no
//   password hash, no TOTP secret, and no way to derive either. Every read that
//   is not literally a credential check returns this.
// - `LocalUserCredential` carries the Argon2id digest and the TOTP secret, and
//   is returned by exactly one method, `findCredential`. That method exists so
//   `identity/local/authenticate.ts` can verify a password, and it is imported
//   nowhere else in the repository. `local-user-seam.test.ts` asserts that.
//
// A single record type with optional credential fields would have been simpler
// and would have leaked: a caller reaching for a user to render in the portal
// would have received the TOTP secret and had to remember not to serialise it.
// The type system should make the wrong thing unavailable rather than
// available-but-discouraged.

/** One local account, credential-free. The type that may cross the store seam. */
export interface LocalUserRecord {
  readonly id: string;
  /** `Principal.subject` — stable, opaque, immutable (02 §4.4). */
  readonly subject: string;
  /** The case-folded login handle, as stored. */
  readonly username: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly active: boolean;
  /** Whether a TOTP secret is enrolled AND confirmed. Never the secret itself. */
  readonly totpEnrolled: boolean;
  readonly failedAttempts: number;
  readonly lockedUntil: string | null;
  readonly lastAuthenticatedAt: string | null;
  readonly passwordUpdatedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Group names, sorted. A group is a mapping input, never a grant (W0-D4). */
  readonly groups: readonly string[];
}

/**
 * A local account **including its credential material**. Returned only by
 * `findCredential`, only to the password/TOTP verification path.
 *
 * `passwordHash` is a PHC-encoded Argon2id digest whose per-user salt is inside
 * the string. `totpSecret` is a base32 shared secret and is the most sensitive
 * value in the runtime store. Neither may be logged, rendered, returned to a
 * caller, or written to an audit row.
 */
export interface LocalUserCredential extends LocalUserRecord {
  readonly passwordHash: string;
  readonly passwordAlgorithm: string;
  readonly totpSecret: string | null;
  readonly totpConfirmedAt: string | null;
  readonly totpLastCounter: number | null;
}

export interface CreateLocalUserInput {
  readonly subject: string;
  readonly username: string;
  readonly displayName: string;
  readonly email?: string | null;
  /** A PHC-encoded Argon2id digest. The store never sees a plaintext password. */
  readonly passwordHash: string;
  readonly passwordAlgorithm: string;
  readonly groups?: readonly string[];
  readonly active?: boolean;
  /** Injectable clock, so tests do not depend on wall time. */
  readonly now?: string;
}

/** Profile fields only. Credentials, groups and `active` have their own methods. */
export interface UpdateLocalUserInput {
  readonly subject: string;
  readonly username?: string;
  readonly displayName?: string;
  readonly email?: string | null;
  readonly now?: string;
}

export interface SetLocalPasswordInput {
  readonly subject: string;
  readonly passwordHash: string;
  readonly passwordAlgorithm: string;
  readonly now?: string;
}

export interface SetLocalTotpInput {
  readonly subject: string;
  /** Null disables TOTP and clears the replay counter with it. */
  readonly secret: string | null;
  readonly confirmedAt?: string | null;
  /**
   * The counter to seed the replay guard with — the counter of the code that
   * proved the enrolment. Omitted (or null) resets the guard, which is correct
   * for a NEW secret and wrong for a confirmation: the code a person just typed
   * to confirm would otherwise still be spendable at their first sign-in.
   */
  readonly lastCounter?: number | null;
  readonly now?: string;
}

export interface RecordLocalAuthInput {
  readonly subject: string;
  readonly outcome: 'success' | 'failure';
  /** Failures at or above this count set `locked_until`. */
  readonly lockoutThreshold: number;
  readonly lockedUntil?: string | null;
  /** The TOTP counter just spent, on success. Monotonic; never decreases. */
  readonly totpCounter?: number | null;
  readonly now?: string;
}

/** Thrown when a `subject` or `username` is already taken. */
export class LocalUserExistsError extends Error {
  constructor(readonly field: 'subject' | 'username') {
    super(`A local user with this ${field} already exists.`);
    this.name = 'LocalUserExistsError';
  }
}

/** Thrown when an admin operation names an account that does not exist. */
export class LocalUserNotFoundError extends Error {
  constructor(readonly subject: string) {
    super(`No local user has subject ${subject}.`);
    this.name = 'LocalUserNotFoundError';
  }
}

export interface LocalUserRepository {
  create(input: CreateLocalUserInput): Promise<LocalUserRecord>;
  findBySubject(subject: string): Promise<LocalUserRecord | undefined>;
  findByUsername(username: string): Promise<LocalUserRecord | undefined>;
  /**
   * **The only method that returns credential material.** By username, because
   * that is what a person types; a subject lookup would tempt a caller holding
   * an already-authenticated principal into re-reading their secret for no
   * reason.
   */
  findCredential(username: string): Promise<LocalUserCredential | undefined>;
  list(options?: { readonly includeInactive?: boolean }): Promise<LocalUserRecord[]>;
  listByGroup(group: string): Promise<LocalUserRecord[]>;
  update(input: UpdateLocalUserInput): Promise<LocalUserRecord>;
  setPassword(input: SetLocalPasswordInput): Promise<LocalUserRecord>;
  setTotp(input: SetLocalTotpInput): Promise<LocalUserRecord>;
  /** Deactivate-in-place. There is no hard delete — see `schema/spec.ts`. */
  setActive(subject: string, active: boolean, now?: string): Promise<LocalUserRecord>;
  addGroups(subject: string, groups: readonly string[], now?: string): Promise<LocalUserRecord>;
  removeGroups(subject: string, groups: readonly string[]): Promise<LocalUserRecord>;
  setGroups(subject: string, groups: readonly string[], now?: string): Promise<LocalUserRecord>;
  /** Lockout bookkeeping after a credential check. */
  recordAuthAttempt(input: RecordLocalAuthInput): Promise<LocalUserRecord>;
}
