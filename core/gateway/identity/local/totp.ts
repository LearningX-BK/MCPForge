// MCPForge — optional TOTP for the Wave 0 local user store. W0-D2, 02 §4.4:
// "Argon2id password hashes; **optional TOTP**".
//
// Optional means per account, not per deployment: some local accounts are
// `['pwd']` and some are `['pwd','otp']`, and the `amr` the gateway mints
// records which check actually ran (see `./authenticate.ts`). An `amr` claiming
// a factor nobody verified would be a lie recorded in the audit trail, so the
// two paths are kept visibly distinct rather than collapsed behind a flag.
//
// RFC 6238 defaults — SHA-1, 6 digits, 30-second step — because that is what
// every authenticator app implements. SHA-1 here is HMAC-SHA-1 over a 160-bit
// shared secret with a 30-second output window, which is not the collision
// setting SHA-1 is broken in.

import { Secret, TOTP } from 'otpauth';

export const TOTP_ALGORITHM = 'SHA1' as const;
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** 20 bytes = 160 bits, the RFC 4226 recommendation. */
export const TOTP_SECRET_BYTES = 20;

/**
 * How many steps either side of now are accepted.
 *
 * 1 — so a total window of 90 seconds — is the usual clock-skew allowance. It
 * is also the reason `local_user.totp_last_counter` exists: a code stays
 * verifiable for that whole window, so without a spent-counter check a code
 * observed once can be replayed inside it.
 */
export const TOTP_WINDOW_STEPS = 1;

/** The `amr` values 02 §4.4 records. `otp` is present only if a code verified. */
export const AMR_PASSWORD = 'pwd' as const;
export const AMR_OTP = 'otp' as const;

export interface TotpEnrolment {
  /** Base32, for `local_user.totp_secret`. A shared secret — never displayed twice. */
  readonly secret: string;
  /** The `otpauth://` URI an authenticator app scans. Contains the secret. */
  readonly uri: string;
}

/** A fresh 160-bit secret plus the provisioning URI for it. */
export function generateTotpSecret(accountLabel: string, issuer = 'MCPForge'): TotpEnrolment {
  const secret = new Secret({ size: TOTP_SECRET_BYTES });
  const totp = totpFor(secret.base32, accountLabel, issuer);
  return { secret: secret.base32, uri: totp.toString() };
}

function totpFor(secretBase32: string, accountLabel: string, issuer: string): TOTP {
  return new TOTP({
    issuer,
    label: accountLabel,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  });
}

export interface TotpVerification {
  readonly ok: boolean;
  /**
   * The counter (time step) the code belongs to, when it verified. Persisted as
   * `totp_last_counter`; a later code must exceed it.
   */
  readonly counter: number | null;
}

/**
 * Verify a code, and report **which time step it came from** so the caller can
 * refuse a replay.
 *
 * The two failure directions are deliberately not distinguished to the caller:
 * a malformed code, a code from outside the window and a code from a spent
 * counter all return `ok: false`, because the difference is of no use to a
 * legitimate user and is a probe oracle for anyone else.
 */
export function verifyTotp(options: {
  readonly secretBase32: string;
  readonly code: string;
  readonly accountLabel: string;
  readonly issuer?: string;
  /** The last counter this account already spent. A code at or below it fails. */
  readonly lastCounter?: number | null;
  /** Injectable clock, in milliseconds, so tests do not depend on wall time. */
  readonly nowMs?: number;
}): TotpVerification {
  const code = options.code.replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code)) {
    return { ok: false, counter: null };
  }

  let totp: TOTP;
  try {
    totp = totpFor(options.secretBase32, options.accountLabel, options.issuer ?? 'MCPForge');
  } catch {
    // An unparseable stored secret fails the check rather than raising — same
    // safe direction as a corrupted password hash.
    return { ok: false, counter: null };
  }

  const nowMs = options.nowMs ?? Date.now();
  // `validate` returns the signed step delta between the code and now, or null.
  const delta = totp.validate({ token: code, window: TOTP_WINDOW_STEPS, timestamp: nowMs });
  if (delta === null) {
    return { ok: false, counter: null };
  }

  const counter = Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS) + delta;
  const last = options.lastCounter ?? null;
  if (last !== null && counter <= last) {
    // Verified, but already spent. THIS is the replay refusal, and it is why
    // the counter is returned at all.
    return { ok: false, counter: null };
  }
  return { ok: true, counter };
}
