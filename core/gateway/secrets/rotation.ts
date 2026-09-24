// MCPForge — the dual-key overlap window. W0-N6, 02 §11.5 rule 5.
//
// 02 §11.5 rule 5, verbatim on the point this file exists to implement:
//
//   "**The confirm-token HMAC key rotates at 90 days with a dual-key overlap
//   window** — the retired key is accepted for *verification only* for one plan
//   TTL plus a margin, because a hard cutover invalidates every in-flight plan
//   token and turns a routine rotation into a self-inflicted outage."
//
// and, for the other signing key in the same sentence's neighbourhood: "the
// local JWT signing key **90 days** with JWKS-style overlap".
//
// **There is exactly one mechanism here, used twice.** Both keys already had
// the *shape* of an overlap before this task: `ConfirmKeyring` has
// `{ active, accepted[] }` (../policy/confirm/token.ts) and
// `LocalTokenIssuerOptions` has `{ signingKey, previousKeys[] }`
// (../identity/jwt.ts). What neither had was the ROTATION — the act that moves
// a key from minting to verify-only, and the clock that eventually drops it.
// Building that twice would be building two chances to get it wrong, so
// `DualKeyRing` below is generic over "anything with a `keyId`" and the two
// call sites are thin adapters that project it into the shape each consumer
// already accepts.
//
// **The invariant, stated once so it can be checked once.**
//
//   A retired key VERIFIES and NEVER SIGNS.
//
// It is structural, not conventional: `signingKey(now)` returns `#active` and
// nothing else, and there is no code path in this file — none, including
// `rotate()` itself — that puts a retired key back in `#active`. `rotate()`
// takes the NEW key as an argument and returns a new ring; the old ring is not
// mutated into a state where the old key could sign again, because the old key
// is only ever appended to `#retired`, and `#retired` is read by exactly one
// method, `acceptedKeys()`, whose result feeds verification alone.
//
// **The window.** One plan TTL plus a margin. The margin is not decoration: a
// plan minted in the instant before the rotation has a full TTL left to run,
// and a clock skew or a slow human between plan and confirm would otherwise
// land just past the edge. `OVERLAP_MARGIN_SECONDS` is deliberately generous
// relative to the TTL (300 s) for that reason; it is bounded because an
// unbounded overlap is not an overlap, it is a key that was never retired.
//
// **What this file does NOT do: hold key material's durable home.** The values
// live behind `SecretStore` (`secretRef://gateway/confirm-token/hmac`,
// `secretRef://gateway/local-issuer/jwt-signing`). This module is the
// in-memory lifecycle of keys the caller has already resolved. It never reads
// a file, never reads an environment variable, and never invents a key —
// the same rule ../identity/jwt.ts and ../policy/confirm/token.ts both state,
// for the same reason.

// From the fs/crypto-free constants module, not `./token.js` directly — this
// file is reached from the portal's `/environments` client route via
// `@mcpforge/gateway/secrets`, and `token.js` imports `node:crypto`. See
// `../policy/confirm/constants.ts`.
import { DEFAULT_CONFIRM_TTL_SECONDS } from '../policy/confirm/constants.js';
import type { ConfirmKeyring, ConfirmSigningKey } from '../policy/confirm/token.js';
import type { LocalSigningKey } from '../identity/jwt.js';
import { secretRef, type SecretRef } from './types.js';

/**
 * The margin added to one plan TTL to size the overlap window.
 *
 * Five minutes on top of the 300 s default TTL: long enough to cover a plan
 * minted microseconds before the rotation plus clock skew between the minting
 * and verifying reads of `Date`, short enough that a retired key's useful life
 * is measured in minutes rather than days.
 */
export const OVERLAP_MARGIN_SECONDS = 300;

/** 02 §11.5 rule 5 — both gateway signing keys rotate on a 90-day schedule. */
export const SIGNING_KEY_ROTATION_DAYS = 90;

/** The durable home of the confirm-token HMAC key (02 §11.5's own example ref). */
export const CONFIRM_HMAC_SECRET_REF: SecretRef = secretRef('gateway', 'confirm-token', 'hmac');

/** The durable home of the Wave 0 local JWT signing key (named in ../identity/config.ts). */
export const JWT_SIGNING_SECRET_REF: SecretRef = secretRef(
  'gateway',
  'local-issuer',
  'jwt-signing',
);

/**
 * How long a retired key stays acceptable for verification: one plan TTL plus
 * {@link OVERLAP_MARGIN_SECONDS}.
 *
 * Exported so a caller sizing an operational runbook and a test asserting the
 * boundary read the same number rather than two numbers that agree today.
 */
export function overlapWindowSeconds(planTtlSeconds: number = DEFAULT_CONFIRM_TTL_SECONDS): number {
  if (!Number.isInteger(planTtlSeconds) || planTtlSeconds <= 0) {
    throw new Error(
      `A plan TTL must be a positive whole number of seconds; got ${planTtlSeconds}. The overlap window is derived from it and cannot be sized from a non-TTL.`,
    );
  }
  return planTtlSeconds + OVERLAP_MARGIN_SECONDS;
}

/** Anything this ring can hold: a key with a non-secret `kid` label. */
export interface KeyedMaterial {
  readonly keyId: string;
}

/** A key that may still verify, and the instant after which it may not. */
export interface RetiredKey<K extends KeyedMaterial> {
  readonly key: K;
  /** ISO instant the key stopped signing. */
  readonly retiredAt: string;
  /** ISO instant after which it stops verifying too. */
  readonly acceptUntil: string;
}

export interface RotateOptions {
  readonly now?: Date;
  /** The plan TTL this deployment mints with. Defaults to 02 §3.1.1's 300 s. */
  readonly planTtlSeconds?: number;
}

/**
 * One active signing key plus zero or more retired, verify-only keys.
 *
 * Immutable by construction and by API: `rotate()` returns a NEW ring rather
 * than mutating this one, so a caller that held a ring across a rotation is
 * holding the pre-rotation ring — which still signs with the pre-rotation key
 * — instead of silently observing a key change mid-request. Swapping the ring
 * is the caller's explicit act.
 */
export class DualKeyRing<K extends KeyedMaterial> {
  readonly #active: K;
  readonly #retired: readonly RetiredKey<K>[];

  constructor(active: K, retired: readonly RetiredKey<K>[] = []) {
    if (retired.some((r) => r.key.keyId === active.keyId)) {
      // Not pedantry: a kid present in both roles makes "did this token come
      // from the active or the retired key?" unanswerable, and a rotation to a
      // reused kid would put a retired key back into signing service through
      // the back door.
      throw new Error(
        `Key id "${active.keyId}" is both the active key and a retired key. Key ids must be unique across a ring's lifetime — mint a fresh kid rather than reusing one.`,
      );
    }
    const seen = new Set<string>();
    for (const r of retired) {
      if (seen.has(r.key.keyId)) {
        throw new Error(`Key id "${r.key.keyId}" appears twice among the retired keys.`);
      }
      seen.add(r.key.keyId);
    }
    this.#active = active;
    this.#retired = Object.freeze([...retired]);
  }

  /** The ONLY key that signs. There is no overload, option or flag that changes this. */
  get signingKey(): K {
    return this.#active;
  }

  /** The `kid` new tokens carry. Non-secret. */
  get activeKeyId(): string {
    return this.#active.keyId;
  }

  /** Retired keys whose overlap window has not yet closed, at `now`. */
  verifyOnlyKeys(now: Date = new Date()): readonly K[] {
    const t = now.getTime();
    return this.#retired.filter((r) => Date.parse(r.acceptUntil) > t).map((r) => r.key);
  }

  /**
   * Every key a verifier should accept at `now`: the active key first, then
   * each retired key still inside its window. Order is stable and puts the
   * active key first so a keyring built from this list resolves the common
   * case in one comparison.
   */
  acceptedKeys(now: Date = new Date()): readonly K[] {
    return [this.#active, ...this.verifyOnlyKeys(now)];
  }

  /** Non-secret `kid` labels, for a status line or an operational report. */
  acceptedKeyIds(now: Date = new Date()): readonly string[] {
    return this.acceptedKeys(now).map((k) => k.keyId);
  }

  /** Retired keys whose window has closed and which are now inert. */
  expiredKeys(now: Date = new Date()): readonly RetiredKey<K>[] {
    const t = now.getTime();
    return this.#retired.filter((r) => Date.parse(r.acceptUntil) <= t);
  }

  /**
   * Retire the active key into the overlap window and make `next` the signer.
   *
   * Keys whose window has already closed are dropped here rather than kept as
   * dead weight: a ring that accumulated every key it ever held would widen its
   * own verification surface forever.
   */
  rotate(next: K, opts: RotateOptions = {}): DualKeyRing<K> {
    if (next.keyId === this.#active.keyId) {
      throw new Error(
        `Rotation was asked to install key id "${next.keyId}", which is already the active key. A rotation must install fresh material under a fresh kid; installing the same kid would leave the old value signing while claiming to have rotated.`,
      );
    }
    const now = opts.now ?? new Date();
    const window = overlapWindowSeconds(opts.planTtlSeconds);
    const retiring: RetiredKey<K> = {
      key: this.#active,
      retiredAt: now.toISOString(),
      acceptUntil: new Date(now.getTime() + window * 1000).toISOString(),
    };
    const stillLive = this.#retired.filter(
      (r) => Date.parse(r.acceptUntil) > now.getTime() && r.key.keyId !== next.keyId,
    );
    return new DualKeyRing<K>(next, [retiring, ...stillLive]);
  }

  /** Drop every retired key immediately — the revocation path, not the rotation path. */
  withoutRetiredKeys(): DualKeyRing<K> {
    return new DualKeyRing<K>(this.#active);
  }
}

// ---------------------------------------------------------------------------
// The two call sites. Thin on purpose: all the logic is above, used twice.
// ---------------------------------------------------------------------------

/**
 * Project a ring into the `ConfirmKeyring` ../policy/confirm/token.ts already
 * accepts. `active` mints; `accepted` verifies. Because `active` comes from
 * `signingKey` and `accepted` from `acceptedKeys`, a retired key can appear in
 * the second and never in the first.
 */
export function confirmKeyringAt(
  ring: DualKeyRing<ConfirmSigningKey>,
  now: Date = new Date(),
): ConfirmKeyring {
  return { active: ring.signingKey, accepted: ring.acceptedKeys(now) };
}

/** The `{ signingKey, previousKeys }` half of `LocalTokenIssuerOptions`. */
export function localSigningKeysAt(
  ring: DualKeyRing<LocalSigningKey>,
  now: Date = new Date(),
): { readonly signingKey: LocalSigningKey; readonly previousKeys: readonly LocalSigningKey[] } {
  return { signingKey: ring.signingKey, previousKeys: ring.verifyOnlyKeys(now) };
}
