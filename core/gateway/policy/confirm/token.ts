// MCPForge — the confirm token: mint, verify, and what it binds. 02 §3.1.1.
//
// "**The token is the security control, not a formality.**" The payload binds
// exactly the seven fields 02 §3.1.1 names:
//
//     { callerSubject, toolId, toolVersion, argsCanonicalHash, planHash, nonce, exp }
//
// and the whole of it is covered by an HMAC-SHA256 signature. Consequences,
// each of which is a test in ./confirm.test.ts:
//
//   * A token minted for one caller is invalid for another.
//   * A token minted for one tool, or one tool VERSION, is invalid for the other.
//   * A token minted for one argument set is invalid for a different one.
//   * A token whose payload is edited no longer verifies — the signature covers
//     the encoded payload byte for byte.
//   * A token past its `exp` is refused, with `PLAN_EXPIRED` rather than a
//     mismatch, because the two mean different things to the agent reading the
//     `next`.
//
// **WHAT THIS FILE DOES NOT DO: single use.** A signature can say who minted
// this and what it is for; it cannot say that this particular token has already
// been spent. That fact lives in the `confirm_nonce` table (W0-C3), whose
// consuming INSERT must run **inside the same transaction as the execute** so
// nonce-consume + execute + audit are one atomic unit. Stage 6g runs *before*
// the binding executor, so consuming here would break that atomicity.
//
// **W0-F2 re-examined this and kept the boundary**, because moving the consume
// earlier would trade a durable guarantee for a check that a crash between 6g
// and the executor turns into a permanently-burnt plan the human must redo. So
// single-use is enforced in TWO halves and W0-F2 owns only the first:
//
//   * **Minting (here, proven by W0-F2).** Every mint carries a fresh, unique,
//     unpredictable `nonce`, signed into the token so it cannot be swapped for
//     another token's, and `verifyConfirmToken` returns it as an explicit field
//     so the consuming code never has to re-parse a token.
//   * **Consuming (W0-F3, NOT done here).** The `confirm_nonce` INSERT inside
//     the execute transaction, which is what makes a *second* presentation of
//     the same token fail. Until that lands, nothing in this codebase claims a
//     token has not already been spent — see the task report's flag.
//
// **Key handling.** A keyring is supplied by the caller. This module never
// reads a file, never reads an environment variable and never invents a key on
// import — the same rule ../../identity/jwt.ts states, for the same reason: a
// module that would quietly conjure a signing key is a module that would quietly
// mint confirmations nobody authorised. The durable home is the `SecretStore`
// seam (`secretRef://gateway/confirm/hmac`), which does not exist yet.
//
// **Rotation.** `ConfirmKeyring` has one `active` key used for minting and a
// list of `accepted` keys used for verification, which is the dual-key overlap
// window CLAUDE.md §3 requires: rotating the HMAC key must not invalidate every
// in-flight plan token.

// **THE WITNESS SEGMENT (W0-F2).** A token is
// `cnf_<header>.<payload>.<witness>.<signature>` and the signature covers all
// three encoded segments. The `payload` remains EXACTLY the seven fields
// 02 §3.1.1 names — a test asserts that key set literally — and the witness is a
// separate segment carrying `argumentWitness()`'s keyed per-field digests, which
// is what lets `PLAN_ARGUMENT_MISMATCH` name the field that changed. See
// ./hash.ts for why the digests are keyed and why no plan record is stored.

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { changedArgumentNamesFromWitness } from './hash.js';
// Factored out to its own fs/crypto-free module — see that file's header —
// so `../../secrets/rotation.ts` can import the SAME TTL without pulling in
// this file's `node:crypto` dependency.
export { DEFAULT_CONFIRM_TTL_SECONDS } from './constants.js';

/** The one MAC algorithm, pinned on both sides. */
export const CONFIRM_TOKEN_ALGORITHM = 'sha256';
/** HMAC-SHA256 floor. A shorter key is refused rather than stretched. */
export const CONFIRM_SIGNING_KEY_BYTES = 32;
/** Every token starts with this, so a token is recognisable in a log or a bug report. */
export const CONFIRM_TOKEN_PREFIX = 'cnf_';

export interface ConfirmSigningKey {
  readonly keyId: string;
  readonly key: Buffer;
}

/** The minting key plus every key still accepted at verification (rotation overlap). */
export interface ConfirmKeyring {
  readonly active: ConfirmSigningKey;
  readonly accepted: readonly ConfirmSigningKey[];
}

/** Wrap raw key material. Refuses anything below the HMAC-SHA256 floor. */
export function confirmSigningKeyFrom(keyId: string, material: Uint8Array): ConfirmSigningKey {
  if (keyId.trim().length === 0) {
    throw new Error(
      'A confirm signing key needs a non-empty keyId; kid is what makes rotation work.',
    );
  }
  if (material.byteLength < CONFIRM_SIGNING_KEY_BYTES) {
    throw new Error(
      `A confirm signing key needs at least ${CONFIRM_SIGNING_KEY_BYTES} bytes for HMAC-${CONFIRM_TOKEN_ALGORITHM}; got ${material.byteLength}.`,
    );
  }
  return { keyId, key: Buffer.from(material) };
}

/** Mint fresh key material. Explicit by design — nothing calls this for you. */
export function generateConfirmSigningKey(keyId: string = randomUUID()): ConfirmSigningKey {
  return confirmSigningKeyFrom(keyId, randomBytes(CONFIRM_SIGNING_KEY_BYTES));
}

/** A keyring with one key. The overlap list is explicit even when it is a singleton. */
export function singleKeyKeyring(key: ConfirmSigningKey): ConfirmKeyring {
  return { active: key, accepted: [key] };
}

/**
 * The signed payload. Exactly the seven fields of 02 §3.1.1 and no more:
 * every field here is either an identity the token is valid for or a hash of
 * something the human saw. **No business argument value appears in a token.**
 * The payload is signed, not encrypted, and a token travels to the client and
 * back through the agent, so a value placed here is a value disclosed.
 */
export interface ConfirmTokenPayload {
  readonly callerSubject: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly argsCanonicalHash: string;
  readonly planHash: string;
  /** Single-use handle. Consumed by W0-F3 inside the execute transaction. */
  readonly nonce: string;
  /** Absolute expiry, epoch seconds. */
  readonly exp: number;
}

function b64u(input: Buffer | string): string {
  return Buffer.from(input as never).toString('base64url');
}

function sign(signingInput: string, key: ConfirmSigningKey): string {
  return createHmac(CONFIRM_TOKEN_ALGORITHM, key.key)
    .update(signingInput, 'utf8')
    .digest('base64url');
}

/**
 * Serialise the payload deterministically. Field order is fixed by this literal
 * rather than by `Object.keys`, so two mints of the same payload produce the
 * same bytes regardless of how the caller's object was built.
 */
function encodePayload(payload: ConfirmTokenPayload): string {
  return b64u(
    JSON.stringify({
      callerSubject: payload.callerSubject,
      toolId: payload.toolId,
      toolVersion: payload.toolVersion,
      argsCanonicalHash: payload.argsCanonicalHash,
      planHash: payload.planHash,
      nonce: payload.nonce,
      exp: payload.exp,
    }),
  );
}

/**
 * The witness segment: keyed per-argument digests from `argumentWitness()`.
 * Encoded with sorted keys so two mints of one plan produce identical bytes.
 */
function encodeWitness(witness: Readonly<Record<string, string>>): string {
  const sorted: Record<string, string> = {};
  for (const name of Object.keys(witness).sort()) sorted[name] = witness[name] as string;
  return b64u(JSON.stringify(sorted));
}

function decodeWitness(raw: string): Readonly<Record<string, string>> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out: Record<string, string> = {};
  for (const [name, digest] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof digest !== 'string') return null;
    out[name] = digest;
  }
  return out;
}

/**
 * Mint a token with the keyring's ACTIVE key.
 *
 * `witness` is `argumentWitness(args, keyring.active.key)`. It is optional only
 * so that unit tests exercising the signature can mint a bare token; the gate
 * always supplies it, and a token minted without one simply cannot name the
 * field that changed.
 */
export function mintConfirmToken(
  payload: ConfirmTokenPayload,
  keyring: ConfirmKeyring,
  witness: Readonly<Record<string, string>> = {},
): string {
  const header = b64u(JSON.stringify({ kid: keyring.active.keyId }));
  const body = encodePayload(payload);
  const wit = encodeWitness(witness);
  const signingInput = `${header}.${body}.${wit}`;
  return `${CONFIRM_TOKEN_PREFIX}${signingInput}.${sign(signingInput, keyring.active)}`;
}

/** Why a token was not accepted. Each maps to a different refusal at stage 6g. */
export type ConfirmTokenFailure =
  /** Not a token this gateway minted, or it has been altered. */
  | 'malformed'
  | 'bad-signature'
  /** Well-formed, correctly signed, past its `exp`. */
  | 'expired'
  /** Correctly signed but minted for a different caller, tool, version or arguments. */
  | 'not-bound-to-this-call';

export type ConfirmTokenVerification =
  | {
      readonly ok: true;
      readonly payload: ConfirmTokenPayload;
      /**
       * The single-use handle this execution must consume. Lifted out of the
       * payload so the consuming code (W0-F3) reads an explicit field rather
       * than reaching into the token. **Nothing here has consumed it** — see
       * the single-use note at the top of this file.
       */
      readonly nonce: string;
    }
  | {
      readonly ok: false;
      readonly failure: ConfirmTokenFailure;
      /** The field that did not match, for `not-bound-to-this-call`. */
      readonly mismatchedField?: keyof ConfirmTokenPayload;
      /**
       * The BUSINESS ARGUMENT names that changed since the plan, when the
       * mismatch was `argsCanonicalHash` and `binding.args` was supplied.
       * 02 §3.1.1 requires the refusal to name them.
       */
      readonly changedArguments?: readonly string[];
    };

/** What the token must be bound to for THIS call to be allowed to execute. */
export interface ConfirmTokenBinding {
  readonly callerSubject: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly argsCanonicalHash: string;
  /**
   * The arguments actually presented on this call, so a mismatch can name the
   * fields that changed. Optional: omitting it costs the refusal its field
   * names, never its refusal.
   */
  readonly args?: Readonly<Record<string, unknown>>;
}

function decodePayload(raw: string): ConfirmTokenPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  const strings = [
    'callerSubject',
    'toolId',
    'toolVersion',
    'argsCanonicalHash',
    'planHash',
    'nonce',
  ] as const;
  for (const field of strings) {
    if (typeof p[field] !== 'string' || (p[field] as string).length === 0) return null;
  }
  if (typeof p['exp'] !== 'number' || !Number.isFinite(p['exp'])) return null;
  return {
    callerSubject: p['callerSubject'] as string,
    toolId: p['toolId'] as string,
    toolVersion: p['toolVersion'] as string,
    argsCanonicalHash: p['argsCanonicalHash'] as string,
    planHash: p['planHash'] as string,
    nonce: p['nonce'] as string,
    exp: p['exp'] as number,
  };
}

function signaturesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // `timingSafeEqual` throws on a length mismatch, so the length check comes
  // first and is not itself a secret-dependent branch: signature length is a
  // property of the algorithm, not of the key.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verify a token against the keyring AND against what this call actually is.
 *
 * The order matters and is deliberate: signature first, then expiry, then the
 * binding. A token whose signature does not verify is told nothing about which
 * of its fields would have mismatched, because it is not a token this gateway
 * ever minted and it is entitled to no information about the call.
 */
export function verifyConfirmToken(
  token: string,
  binding: ConfirmTokenBinding,
  keyring: ConfirmKeyring,
  now: Date,
): ConfirmTokenVerification {
  if (typeof token !== 'string' || !token.startsWith(CONFIRM_TOKEN_PREFIX)) {
    return { ok: false, failure: 'malformed' };
  }
  const parts = token.slice(CONFIRM_TOKEN_PREFIX.length).split('.');
  if (parts.length !== 4) return { ok: false, failure: 'malformed' };
  const [header, body, wit, signature] = parts as [string, string, string, string];

  let keyId: unknown;
  try {
    const parsedHeader: unknown = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    keyId =
      parsedHeader !== null && typeof parsedHeader === 'object'
        ? (parsedHeader as Record<string, unknown>)['kid']
        : undefined;
  } catch {
    return { ok: false, failure: 'malformed' };
  }
  if (typeof keyId !== 'string') return { ok: false, failure: 'malformed' };

  const key = keyring.accepted.find((candidate) => candidate.keyId === keyId);
  // An unknown kid is a BAD SIGNATURE, not a malformed token: it is structurally
  // a token, it was simply not signed by anything this gateway accepts. Revoking
  // a key by removing it from `accepted` must refuse its tokens, not crash.
  if (key === undefined) return { ok: false, failure: 'bad-signature' };
  if (!signaturesEqual(sign(`${header}.${body}.${wit}`, key), signature)) {
    return { ok: false, failure: 'bad-signature' };
  }

  const payload = decodePayload(body);
  if (payload === null) return { ok: false, failure: 'malformed' };
  const witness = decodeWitness(wit);
  if (witness === null) return { ok: false, failure: 'malformed' };

  if (payload.exp * 1000 <= now.getTime()) return { ok: false, failure: 'expired' };

  const fields = ['callerSubject', 'toolId', 'toolVersion', 'argsCanonicalHash'] as const;
  for (const field of fields) {
    if (payload[field] !== binding[field]) {
      // The whole-argument-set hash is the only mismatch a per-field diff can
      // explain; a wrong caller or tool is not "a field that changed".
      if (field === 'argsCanonicalHash' && binding.args !== undefined) {
        return {
          ok: false,
          failure: 'not-bound-to-this-call',
          mismatchedField: field,
          changedArguments: changedArgumentNamesFromWitness(witness, binding.args, key.key),
        };
      }
      return { ok: false, failure: 'not-bound-to-this-call', mismatchedField: field };
    }
  }

  return { ok: true, payload, nonce: payload.nonce };
}
