// MCPForge — Argon2id password hashing for the Wave 0 local user store.
// W0-D2, 02 §4.4: "Users in Postgres; Argon2id password hashes".
//
// **Why `hash-wasm` and not a native binding.** 02 §10 and CLAUDE.md §3.1 make
// local-first a rule, not a preference: everything must build, test, run and
// demo on one developer machine with `pnpm install` and no Docker. A native
// Argon2 binding needs a prebuilt binary for every platform the team uses or a
// C toolchain on the machine, and the day one is missing the failure mode is a
// developer disabling password hashing to get the tests green. `hash-wasm` is
// the reference Argon2 compiled to WebAssembly — one artefact, every platform,
// no toolchain — and it is the same algorithm producing the same PHC strings.
//
// **The parameters below are the security decision in this file.** They follow
// OWASP's Argon2id guidance (64 MiB, t=3, p=1 — the m=64MiB row of the
// recommended set) and they are recorded in the PHC string alongside every
// digest, so raising them later re-hashes on next sign-in rather than
// invalidating the stored set.

import { argon2id, argon2Verify } from 'hash-wasm';

/** The algorithm name written to `local_user.password_algorithm`. */
export const PASSWORD_ALGORITHM = 'argon2id' as const;

/** 64 MiB. The memory cost is what makes GPU cracking expensive. */
export const ARGON2_MEMORY_KIB = 65536;
export const ARGON2_ITERATIONS = 3;
export const ARGON2_PARALLELISM = 1;
export const ARGON2_HASH_LENGTH = 32;
/** 16 bytes, per RFC 9106. Fresh at every hash — see `hashPassword`. */
export const ARGON2_SALT_BYTES = 16;

/**
 * The shortest password this store will accept.
 *
 * A length floor and nothing else, deliberately: composition rules ("one
 * capital, one symbol") measurably push people towards `Password1!` and are no
 * longer recommended by NIST SP 800-63B. Rejecting a *known-breached* password
 * would be worth far more, and it needs a breach corpus this deployment does
 * not have offline — flagged in the task output rather than faked here.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Hash a password with a **fresh, per-user, cryptographically random salt**.
 *
 * The salt is generated here, on every call, and is never derived from the
 * username, the subject or anything else about the account: a salt derived from
 * an account attribute is a salt an attacker can precompute against, which
 * defeats the only thing a salt does. It is stored inside the returned PHC
 * string, so there is no separate salt column to forget to write.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(ARGON2_SALT_BYTES);
  crypto.getRandomValues(salt);
  return argon2id({
    password,
    salt,
    parallelism: ARGON2_PARALLELISM,
    iterations: ARGON2_ITERATIONS,
    memorySize: ARGON2_MEMORY_KIB,
    hashLength: ARGON2_HASH_LENGTH,
    outputType: 'encoded',
  });
}

/**
 * Verify a password against a stored PHC digest.
 *
 * Returns `false` rather than throwing on a malformed or unrecognised digest.
 * That is the safe direction: a corrupted `password_hash` column must fail the
 * sign-in, not raise an exception that some caller might treat as a distinct,
 * softer condition than "wrong password".
 */
export async function verifyPassword(password: string, phcHash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: phcHash });
  } catch {
    return false;
  }
}

/**
 * A digest of a value nobody knows, hashed with the live parameters.
 *
 * Used to spend the same work on an unknown username as on a known one. Without
 * it, sign-in latency answers "does this account exist?" for anyone who cares
 * to time it — and a local deployment's user list is exactly the reconnaissance
 * an attacker wants before guessing. The plaintext is random per process, so no
 * password can ever match it.
 */
export async function decoyPasswordHash(): Promise<string> {
  const filler = new Uint8Array(32);
  crypto.getRandomValues(filler);
  return hashPassword(Buffer.from(filler).toString('base64'));
}
