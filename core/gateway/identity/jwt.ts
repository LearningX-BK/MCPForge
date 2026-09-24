// MCPForge — the Wave 0 local token issuer and verifier. W0-D1, 02 §4.4.
//
// 02 §4.4: "the gateway itself issues **short-lived signed JWTs with an
// OIDC-shaped claim set**." This file is that sentence. It is the ONLY place in
// the repository that mints or verifies a MCPForge identity token, and the only
// place that touches signing key material.
//
// **Algorithm.** HS256, and only HS256. At Wave 0 the issuer and the verifier
// are the same process, so a symmetric key is the honest primitive: an
// asymmetric key pair here would advertise a verification story (publish the
// JWKS, let a third party verify) that Wave 0 does not have. `alg` is pinned on
// the verify side, not merely read from the header — an unpinned verifier is
// the classic `alg: none` / HS-vs-RS confusion bug, and this is an
// `OPUS_GUARDED_PATHS` file.
//
// **Library.** `jose` — zero-dependency, ESM-native, and the same library
// W0-D3's `OidcProvider` will use for remote JWKS verification. One JWS
// implementation for both providers is deliberate: the contract suite that runs
// against both (02 §4.4 item 2) then differs in the key source, not in the
// verification semantics.
//
// **Key handling, and what is deliberately NOT here.** A `LocalSigningKey` is
// supplied by the caller. This module never reads a file, never reads an
// environment variable, and never invents a key on import — `no-service-account
// -fallback` in spirit as well as in lint: a module that would quietly conjure
// a signing key when none was configured is a module that would quietly issue
// tokens nobody authorised. `generateLocalSigningKey()` exists and is explicit.
// The durable home for this key is the `SecretStore` seam
// (`secretRef://gateway/local-issuer/jwt-signing`, named in ./config.ts's
// `signingKeyRef`), and `core/gateway/secrets/**` does not exist yet at W0-D1.
// Resolving the ref is a later task; it is flagged rather than pre-built,
// because a premature dependency on a seam that has not been designed is how
// the seam ends up shaped by its first caller.

import { createSecretKey, randomBytes, randomUUID, type KeyObject } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { forgeError } from '@mcpforge/shared/errors';
import { principalFromClaims, principalToClaims } from './claims.js';
import type { PrincipalClaims } from './claims.js';
import type { IdentityProviderKind, Principal } from './types.js';

/** The one accepted JWS algorithm. Pinned on both sides. */
export const LOCAL_JWT_ALGORITHM = 'HS256' as const;

/** 02 §4.4 — "short-lived". Fifteen minutes, overridable per issuer. */
export const DEFAULT_TOKEN_TTL_SECONDS = 900;

/** HS256 wants at least 256 bits of key material; this is the floor. */
export const LOCAL_SIGNING_KEY_BYTES = 32;

/**
 * Signing key material, held as a `KeyObject` rather than a `Uint8Array` so it
 * does not render as bytes in a log line, a `JSON.stringify`, a thrown stack or
 * a debugger's inspect output. `keyId` is a non-secret label: it rides in the
 * JWS header as `kid` so a rotation can run with a dual-key overlap window
 * (CLAUDE.md §3, "the confirm-token HMAC key rotates with a dual-key overlap
 * window") without invalidating every in-flight token.
 */
export interface LocalSigningKey {
  readonly keyId: string;
  readonly key: KeyObject;
}

/** Wrap raw key material. Refuses anything below the HS256 floor. */
export function localSigningKeyFrom(keyId: string, material: Uint8Array): LocalSigningKey {
  if (keyId.trim().length === 0) {
    throw new Error(
      'A local signing key needs a non-empty keyId; kid is what makes rotation work.',
    );
  }
  if (material.byteLength < LOCAL_SIGNING_KEY_BYTES) {
    throw new Error(
      `A local signing key needs at least ${LOCAL_SIGNING_KEY_BYTES} bytes for ${LOCAL_JWT_ALGORITHM}; got ${material.byteLength}.`,
    );
  }
  return { keyId, key: createSecretKey(material) };
}

/** Mint fresh key material. Explicit by design — nothing calls this for you. */
export function generateLocalSigningKey(keyId: string = randomUUID()): LocalSigningKey {
  return localSigningKeyFrom(keyId, randomBytes(LOCAL_SIGNING_KEY_BYTES));
}

export interface LocalTokenIssuerOptions {
  readonly issuer: string;
  readonly audience: string;
  /** The key new tokens are signed with. */
  readonly signingKey: LocalSigningKey;
  /**
   * Keys that are still ACCEPTED on verify but no longer used to sign — the
   * dual-key overlap window. A rotation moves the old key here for one TTL and
   * then drops it, so no in-flight session is invalidated by a key change.
   */
  readonly previousKeys?: readonly LocalSigningKey[];
  readonly ttlSeconds?: number;
  /** Injectable clock, so tests do not depend on wall time. */
  readonly now?: () => Date;
  /**
   * Which provider these tokens describe. `local` for the Wave 0 issuer; the
   * field exists so the claim-set round-trip is testable for both kinds
   * without a second issuer implementation.
   */
  readonly idp?: IdentityProviderKind;
}

export interface IssuedToken {
  /** The compact JWS. A bearer value — never logged, never stored. */
  readonly token: string;
  readonly claims: PrincipalClaims;
  readonly expiresAt: Date;
}

/**
 * Mints and verifies the tokens the Wave 0 local provider hands out.
 *
 * Both halves live in one object on purpose: an issuer whose verifier lived
 * elsewhere would let the two drift on issuer, audience, algorithm or clock
 * skew, and every one of those drifts fails open (a token accepted that should
 * not have been) rather than closed.
 */
export interface LocalTokenIssuer {
  issue(principal: Principal): Promise<IssuedToken>;
  /**
   * Verify signature, `alg`, `exp`, `nbf`, `iss` and `aud`, then reconstruct
   * the `Principal`. Throws `AUTH_REQUIRED` on every failure — deliberately
   * one code for all of them, because distinguishing "bad signature" from
   * "expired" from "wrong audience" in a caller-visible error tells an attacker
   * which knob to turn.
   */
  verify(token: string, correlationId: string): Promise<Principal>;
  /** The `kid` new tokens are being signed with. Non-secret. */
  readonly activeKeyId: string;
  /** Every `kid` this issuer will still accept on verify. Non-secret. */
  readonly acceptedKeyIds: readonly string[];
}

export function localTokenIssuer(options: LocalTokenIssuerOptions): LocalTokenIssuer {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error(`Token TTL must be a positive whole number of seconds; got ${ttlSeconds}.`);
  }
  const now = options.now ?? (() => new Date());
  const idp = options.idp ?? 'local';

  const keyring = new Map<string, KeyObject>();
  keyring.set(options.signingKey.keyId, options.signingKey.key);
  for (const previous of options.previousKeys ?? []) {
    keyring.set(previous.keyId, previous.key);
  }

  return {
    activeKeyId: options.signingKey.keyId,
    acceptedKeyIds: Object.freeze([...keyring.keys()]),

    async issue(principal: Principal): Promise<IssuedToken> {
      if (principal.idp !== idp) {
        // A guard, not a coercion: an issuer that silently rewrote `idp` would
        // let a principal from one provider be re-minted as another's.
        throw new Error(
          `This issuer mints "${idp}" tokens; the principal claims "${principal.idp}".`,
        );
      }
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);
      const claims = principalToClaims(principal, {
        issuer: options.issuer,
        audience: options.audience,
        issuedAt,
        expiresAt,
        jti: randomUUID(),
      });
      const token = await new SignJWT(claims as unknown as JWTPayload)
        .setProtectedHeader({ alg: LOCAL_JWT_ALGORITHM, kid: options.signingKey.keyId, typ: 'JWT' })
        .sign(options.signingKey.key);
      return { token, claims, expiresAt };
    },

    async verify(token: string, correlationId: string): Promise<Principal> {
      // Explicitly typed, not inferred: TypeScript only applies never-returning
      // control-flow analysis to a `const` that carries the annotation, and
      // without it `payload` below is "used before assigned".
      const refuse: () => never = () => {
        throw forgeError(
          'AUTH_REQUIRED',
          'The presented bearer token did not verify.',
          correlationId,
          {
            condition:
              'The session presented a token that failed signature, algorithm, expiry, issuer or audience verification.',
          },
        );
      };

      let payload: JWTPayload;
      try {
        // `alg` and `kid` are resolved from the header only to SELECT a key
        // from the keyring we already hold. The algorithm itself is pinned
        // below and never taken from the token.
        const verified = await jwtVerify(
          token,
          (header) => {
            const kid = header.kid;
            const candidate = kid === undefined ? undefined : keyring.get(kid);
            if (candidate === undefined) {
              throw new Error('unknown kid');
            }
            return Promise.resolve(candidate);
          },
          {
            algorithms: [LOCAL_JWT_ALGORITHM],
            issuer: options.issuer,
            audience: options.audience,
            clockTolerance: 0,
            currentDate: now(),
          },
        );
        payload = verified.payload;
      } catch {
        // Swallowed on purpose. `jose`'s error names ("JWSSignatureVerification
        // Failed", "JWTExpired") are exactly the discrimination the single
        // AUTH_REQUIRED code exists to deny a caller.
        refuse();
      }
      return principalFromClaims(payload, idp, correlationId);
    },
  };
}
