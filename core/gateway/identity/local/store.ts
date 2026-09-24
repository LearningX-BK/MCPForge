// MCPForge — `LocalUserStore`. W0-D2, 02 §4.4.
//
// The Wave 0 front door: Argon2id password verification, optional per-account
// TOTP, admin CRUD, and the `LocalPrincipalSource` W0-D1 left open. It is the
// ONLY module in the product that reads a password hash or a TOTP secret, and
// the only one that calls `RuntimeStore.localUsers.findCredential`.
//
// **Three boundaries this file holds, and why each is here rather than in a
// review comment:**
//
// 1. `principalSource()` returns a `LocalPrincipalSource` whose records are
//    `{subject, displayName, email?, groups}` and cannot carry anything else —
//    the credential columns are not merely omitted, they are unreachable
//    through that value. W0-D1's provider therefore cannot leak what it never
//    receives.
// 2. `authenticate` returns `{subject, amr}` and NOT a `Principal`. Minting a
//    token is W0-D1's `issueToken`, which is what keeps `amr` honest: this
//    module reports which checks actually ran, the issuer records what it was
//    told, and neither invents the other's half.
// 3. Every sign-in failure — unknown username, wrong password, inactive
//    account, locked account, missing or wrong OTP — refuses with ONE
//    `AUTH_REQUIRED` and one message. See `SIGN_IN_REFUSED` below.

import { forgeError } from '@mcpforge/shared/errors';
import type { RuntimeStore } from '../../store/index.js';
import { LocalUserExistsError, LocalUserNotFoundError } from '../../store/index.js';
import type { LocalUserRecord } from '../../store/index.js';
import { uuidv7 } from '../../store/index.js';
import type { LocalPrincipalRecord, LocalPrincipalSource } from '../local.js';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_ALGORITHM,
  decoyPasswordHash,
  hashPassword,
  verifyPassword,
} from './password.js';
import { AMR_OTP, AMR_PASSWORD, generateTotpSecret, verifyTotp } from './totp.js';
import type { TotpEnrolment } from './totp.js';

/** `local:` + UUIDv7. Opaque, stable, and not the username (02 §4.4). */
export const LOCAL_SUBJECT_PREFIX = 'local:' as const;

export function localSubject(): string {
  return `${LOCAL_SUBJECT_PREFIX}${uuidv7()}`;
}

/** Consecutive failures before the account is locked. */
export const DEFAULT_LOCKOUT_THRESHOLD = 5;
/** How long a lockout lasts. Long enough to kill online guessing, short enough
 * that an operator is not the only route back in. */
export const DEFAULT_LOCKOUT_SECONDS = 900;

/**
 * **One refusal for every sign-in failure.**
 *
 * The message deliberately does not say which of "no such account", "wrong
 * password", "account deactivated", "account locked" or "wrong code" happened.
 * Distinguishing them would confirm to an unauthenticated caller which
 * usernames exist and which are currently locked — the reconnaissance step
 * before a targeted guess. The operator can see all five states in
 * `forge identity show`; the sign-in path shows one.
 *
 * The `next` still has to be agent-actionable (non-negotiable 5), so it names
 * both real remedies rather than saying "try again".
 */
const SIGN_IN_REFUSED = {
  message: 'The credentials presented did not authenticate a local account.',
  condition:
    'The username, password or one-time code did not verify, or the account is not available for sign-in.',
  next: 'Re-enter the username and password (and the current 6-digit code if this account is enrolled); if the account is deactivated or locked, ask your MCPForge operator to re-enable or unlock it with forge identity.',
} as const;

export interface LocalSignIn {
  readonly username: string;
  readonly password: string;
  /** Required for accounts with a confirmed TOTP secret, ignored otherwise. */
  readonly totpCode?: string;
}

/**
 * The result of a successful credential check. `amr` names the checks that
 * ACTUALLY RAN, and is handed to W0-D1's `issueToken` unchanged.
 */
export interface LocalAuthentication {
  readonly subject: string;
  readonly amr: readonly string[];
}

export interface CreateLocalUserRequest {
  readonly username: string;
  readonly displayName: string;
  readonly email?: string;
  readonly password: string;
  readonly groups?: readonly string[];
  /** Supply only to re-create a known subject (a restore). Minted otherwise. */
  readonly subject?: string;
}

export interface LocalUserStoreOptions {
  readonly store: RuntimeStore;
  readonly lockoutThreshold?: number;
  readonly lockoutSeconds?: number;
  /** Injectable clock, so tests do not depend on wall time. */
  readonly now?: () => Date;
}

export interface LocalUserStore {
  // -- admin CRUD. Every method is an operator action, not a caller action.
  createUser(request: CreateLocalUserRequest): Promise<LocalUserRecord>;
  getUser(subject: string): Promise<LocalUserRecord | undefined>;
  getUserByUsername(username: string): Promise<LocalUserRecord | undefined>;
  listUsers(options?: { readonly includeInactive?: boolean }): Promise<LocalUserRecord[]>;
  listGroupMembers(group: string): Promise<LocalUserRecord[]>;
  updateUser(
    subject: string,
    changes: {
      readonly username?: string;
      readonly displayName?: string;
      readonly email?: string | null;
    },
  ): Promise<LocalUserRecord>;
  setPassword(subject: string, password: string): Promise<LocalUserRecord>;
  /**
   * **Deactivate, never delete** — the judgment call this module makes, and the
   * reason `deleteUser` does not exist. See `store/schema/spec.ts`.
   */
  deactivateUser(subject: string): Promise<LocalUserRecord>;
  reactivateUser(subject: string): Promise<LocalUserRecord>;
  addGroups(subject: string, groups: readonly string[]): Promise<LocalUserRecord>;
  removeGroups(subject: string, groups: readonly string[]): Promise<LocalUserRecord>;
  setGroups(subject: string, groups: readonly string[]): Promise<LocalUserRecord>;

  // -- optional TOTP, per account.
  /** Mint and store a secret. Returned ONCE; never readable again. */
  beginTotpEnrolment(subject: string): Promise<TotpEnrolment>;
  /** Prove the secret with a live code. Until this passes, `amr` stays `['pwd']`. */
  confirmTotpEnrolment(subject: string, code: string): Promise<LocalUserRecord>;
  disableTotp(subject: string): Promise<LocalUserRecord>;

  // -- the credential check.
  authenticate(signIn: LocalSignIn, correlationId: string): Promise<LocalAuthentication>;
  /** The W0-D1 seam. Credential-free by construction. */
  principalSource(): LocalPrincipalSource;
}

export function localUserStore(options: LocalUserStoreOptions): LocalUserStore {
  const users = options.store.localUsers;
  const now = options.now ?? (() => new Date());
  const lockoutThreshold = options.lockoutThreshold ?? DEFAULT_LOCKOUT_THRESHOLD;
  const lockoutSeconds = options.lockoutSeconds ?? DEFAULT_LOCKOUT_SECONDS;

  /**
   * The decoy digest, hashed **once per store instance** and then reused.
   *
   * Reviewed and corrected: hashing a fresh decoy on every unknown-username
   * attempt made that path cost a hash PLUS a verify, while the known-username
   * path cost one verify — so the timing oracle was not closed, it was inverted
   * and made louder. Caching the digest makes both paths exactly one Argon2id
   * verification at identical parameters, which is the property that was wanted.
   * The plaintext behind it is random per process and is never retained.
   */
  let decoy: Promise<string> | undefined;
  function decoyHash(): Promise<string> {
    decoy ??= decoyPasswordHash();
    return decoy;
  }

  function refuseSignIn(correlationId: string): never {
    throw forgeError('AUTH_REQUIRED', SIGN_IN_REFUSED.message, correlationId, {
      condition: SIGN_IN_REFUSED.condition,
      next: SIGN_IN_REFUSED.next,
    });
  }

  /** Admin-path refusal. Distinguishing states IS appropriate here: the caller
   * is an authenticated operator who already knows the account list. */
  function adminError(message: string, next: string): never {
    throw forgeError('INPUT_INVALID', message, 'identity-local-admin', {
      condition: 'A local user administration argument named a state that does not hold.',
      next,
    });
  }

  async function requireUser(subject: string): Promise<LocalUserRecord> {
    const record = await users.findBySubject(subject);
    if (record === undefined) {
      adminError(
        `No local account has subject ${subject}.`,
        'List the accounts with forge identity list and re-issue this command with a subject that exists.',
      );
    }
    return record;
  }

  function assertPasswordAcceptable(password: string): void {
    if (password.length < MIN_PASSWORD_LENGTH) {
      adminError(
        `A local password must be at least ${MIN_PASSWORD_LENGTH} characters; this one is shorter.`,
        `Choose a passphrase of at least ${MIN_PASSWORD_LENGTH} characters and set it again. Length is the only rule — composition rules are not enforced and not wanted.`,
      );
    }
  }

  /** Never echo the password back, not even in a length or a prefix. */
  function mapExists(error: unknown): never {
    if (error instanceof LocalUserExistsError) {
      adminError(
        `A local account with this ${error.field} already exists.`,
        error.field === 'username'
          ? 'Choose a different username, or update the existing account with forge identity update.'
          : 'Subjects are immutable and never reused; mint a new account rather than re-using this subject.',
      );
    }
    if (error instanceof LocalUserNotFoundError) {
      adminError(
        error.message,
        'List the accounts with forge identity list and re-issue this command with a subject that exists.',
      );
    }
    throw error;
  }

  return {
    async createUser(request: CreateLocalUserRequest): Promise<LocalUserRecord> {
      assertPasswordAcceptable(request.password);
      const passwordHash = await hashPassword(request.password);
      try {
        return await users.create({
          subject: request.subject ?? localSubject(),
          username: request.username,
          displayName: request.displayName,
          email: request.email ?? null,
          passwordHash,
          passwordAlgorithm: PASSWORD_ALGORITHM,
          groups: request.groups ?? [],
          active: true,
          now: now().toISOString(),
        });
      } catch (error) {
        mapExists(error);
      }
    },

    getUser: (subject) => users.findBySubject(subject),
    getUserByUsername: (username) => users.findByUsername(username),
    listUsers: (opts) => users.list(opts),
    listGroupMembers: (group) => users.listByGroup(group),

    async updateUser(subject, changes): Promise<LocalUserRecord> {
      await requireUser(subject);
      try {
        return await users.update({ subject, ...changes, now: now().toISOString() });
      } catch (error) {
        mapExists(error);
      }
    },

    async setPassword(subject: string, password: string): Promise<LocalUserRecord> {
      await requireUser(subject);
      assertPasswordAcceptable(password);
      return users.setPassword({
        subject,
        passwordHash: await hashPassword(password),
        passwordAlgorithm: PASSWORD_ALGORITHM,
        now: now().toISOString(),
      });
    },

    async deactivateUser(subject: string): Promise<LocalUserRecord> {
      await requireUser(subject);
      return users.setActive(subject, false, now().toISOString());
    },

    async reactivateUser(subject: string): Promise<LocalUserRecord> {
      await requireUser(subject);
      return users.setActive(subject, true, now().toISOString());
    },

    async addGroups(subject, groups): Promise<LocalUserRecord> {
      await requireUser(subject);
      return users.addGroups(subject, groups, now().toISOString());
    },

    async removeGroups(subject, groups): Promise<LocalUserRecord> {
      await requireUser(subject);
      return users.removeGroups(subject, groups);
    },

    async setGroups(subject, groups): Promise<LocalUserRecord> {
      await requireUser(subject);
      return users.setGroups(subject, groups, now().toISOString());
    },

    /**
     * Store the secret **unconfirmed**. `totpEnrolled` stays false and `amr`
     * stays `['pwd']` until a live code proves the person actually holds it —
     * otherwise a mistyped enrolment would lock the account out of its own
     * second factor.
     */
    async beginTotpEnrolment(subject: string): Promise<TotpEnrolment> {
      const user = await requireUser(subject);
      const enrolment = generateTotpSecret(user.username);
      await users.setTotp({
        subject,
        secret: enrolment.secret,
        confirmedAt: null,
        now: now().toISOString(),
      });
      return enrolment;
    },

    async confirmTotpEnrolment(subject: string, code: string): Promise<LocalUserRecord> {
      const user = await requireUser(subject);
      // The one place outside `authenticate` that needs the secret. The
      // credential value is read, used, and never returned.
      const credential = await users.findCredential(user.username);
      if (credential?.totpSecret === null || credential?.totpSecret === undefined) {
        adminError(
          'This account has no TOTP secret to confirm.',
          'Run forge identity totp enrol for this account first, scan the URI it prints once, then confirm with a current code.',
        );
      }
      const verified = verifyTotp({
        secretBase32: credential.totpSecret,
        code,
        accountLabel: user.username,
        lastCounter: credential.totpLastCounter,
        nowMs: now().getTime(),
      });
      if (!verified.ok) {
        adminError(
          'That code did not verify against the enrolled secret.',
          'Wait for the authenticator to show the next 6-digit code and confirm again; if it keeps failing, re-run forge identity totp enrol to mint a fresh secret.',
        );
      }
      return users.setTotp({
        subject,
        secret: credential.totpSecret,
        confirmedAt: now().toISOString(),
        // Spend the confirming code. Without this the code just typed would
        // still be replayable for its remaining window at first sign-in.
        lastCounter: verified.counter,
        now: now().toISOString(),
      });
    },

    async disableTotp(subject: string): Promise<LocalUserRecord> {
      await requireUser(subject);
      return users.setTotp({ subject, secret: null, confirmedAt: null, now: now().toISOString() });
    },

    /**
     * **The credential check.** Read this against the six ways it can refuse and
     * the one way it can succeed.
     *
     * Order matters. The Argon2id verification runs for an unknown username too
     * — against `decoyPasswordHash()` — so the response time does not answer
     * "does this account exist". The lockout is checked before the hash so a
     * locked account is not a free oracle, but the decoy still runs in that
     * branch for the same timing reason.
     */
    async authenticate(signIn: LocalSignIn, correlationId: string): Promise<LocalAuthentication> {
      const nowDate = now();
      const credential = await users.findCredential(signIn.username);

      if (credential === undefined) {
        // Unknown username: spend the work anyway, then refuse identically.
        await verifyPassword(signIn.password, await decoyHash());
        refuseSignIn(correlationId);
      }

      const locked = credential.lockedUntil !== null && new Date(credential.lockedUntil) > nowDate;
      if (!credential.active || locked) {
        await verifyPassword(signIn.password, await decoyHash());
        refuseSignIn(correlationId);
      }

      const passwordOk = await verifyPassword(signIn.password, credential.passwordHash);
      if (!passwordOk) {
        await users.recordAuthAttempt({
          subject: credential.subject,
          outcome: 'failure',
          lockoutThreshold,
          lockedUntil: new Date(nowDate.getTime() + lockoutSeconds * 1000).toISOString(),
          now: nowDate.toISOString(),
        });
        refuseSignIn(correlationId);
      }

      // TOTP is required exactly when the account has a CONFIRMED secret. An
      // unconfirmed enrolment is not a factor and must not gate sign-in — that
      // is the difference `totpEnrolled` encodes.
      const totpRequired = credential.totpEnrolled && credential.totpSecret !== null;
      let totpCounter: number | null = null;
      if (totpRequired) {
        const verified =
          signIn.totpCode === undefined
            ? { ok: false, counter: null }
            : verifyTotp({
                secretBase32: credential.totpSecret,
                code: signIn.totpCode,
                accountLabel: credential.username,
                lastCounter: credential.totpLastCounter,
                nowMs: nowDate.getTime(),
              });
        if (!verified.ok) {
          // A correct password with a wrong code still counts towards the
          // lockout: otherwise the second factor is an unlimited guessing
          // surface for anyone who already has the password.
          await users.recordAuthAttempt({
            subject: credential.subject,
            outcome: 'failure',
            lockoutThreshold,
            lockedUntil: new Date(nowDate.getTime() + lockoutSeconds * 1000).toISOString(),
            now: nowDate.toISOString(),
          });
          refuseSignIn(correlationId);
        }
        totpCounter = verified.counter;
      }

      await users.recordAuthAttempt({
        subject: credential.subject,
        outcome: 'success',
        lockoutThreshold,
        totpCounter,
        now: nowDate.toISOString(),
      });

      return {
        subject: credential.subject,
        // The honest `amr`: `otp` appears if and only if a code was verified
        // in this call.
        amr: totpRequired ? [AMR_PASSWORD, AMR_OTP] : [AMR_PASSWORD],
      };
    },

    /**
     * The W0-D1 seam. An inactive account returns `undefined`, which the
     * provider turns into `IDENTITY_UNRESOLVED` — there is no defaulting
     * variant and no "disabled but usable" state (non-negotiable 1).
     */
    principalSource(): LocalPrincipalSource {
      return {
        async findBySubject(subject: string): Promise<LocalPrincipalRecord | undefined> {
          const record = await users.findBySubject(subject);
          if (record === undefined || !record.active) {
            return undefined;
          }
          // Constructed field by field rather than spread, so a column added to
          // `LocalUserRecord` later — including a credential one — cannot
          // arrive here by accident.
          return {
            subject: record.subject,
            displayName: record.displayName,
            ...(record.email === null ? {} : { email: record.email }),
            groups: record.groups,
          };
        },
      };
    },
  };
}
