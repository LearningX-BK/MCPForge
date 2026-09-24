// MCPForge — step `[2a]`: consumer authentication and the registration check.
// W0-N2. 02 §4.2 (the request path), 02 §11.2, 05 §1.3.4, 05 §A.
//
// > "Every call is made by a `Consumer` acting for a `Principal`. Authorization
// > is the intersection of what the consumer may do and what the human may do —
// > never the union, never a substitute." (02 §11.2)
//
// **Where this sits, and why the ordering is structural.** 02 §4.2 inserts
// `[2a]` BETWEEN `[2]` authentication and `[3]` identity resolution. This
// module is therefore reachable with no `Principal` in hand and it consumes
// none: it imports nothing from `../../identity/**` except the two optional
// CLAIMS a caller may pass for corroboration, and it cannot resolve, infer or
// default a human identity even if it wanted to. `../http.ts` calls this
// before it calls anything else, and its `resolveIdentity` hook — step `[3]` —
// is unreachable unless this returns `ok: true`. That is the ordering proof;
// `consumer-auth.test.ts` asserts the hook is never invoked on a refusal.
//
// **What a refusal here costs the caller: everything.** An unregistered,
// suspended, expired or retired consumer is refused AT `initialize`. No MCP
// session is created, so `tools/list` is never reachable and not one byte of
// catalogue is served (02 §11.2, "it never reaches identity resolution, never
// gets a session, and never enumerates the catalogue"). This is the front
// door, and Wave 0 exit criterion 14(a).
//
// **CLAUDE.md non-negotiable 1 in this file specifically.** There is no branch
// in which a missing, malformed or unverifiable consumer credential yields a
// consumer. There is no default consumer, no `MCPFORGE_CONSUMER_ID` env var,
// no "local development" bypass, and no code path that turns a token claim
// into a registration. Every exit that is not a verified registration is a
// `ForgeError`.
//
// **CLAUDE.md non-negotiable 8.** No presented credential value is returned,
// logged, echoed into an error message, or written anywhere by this module.
// The client secret is read once, inside `#verifyClientSecret`, compared in
// constant time, and dropped.

import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify, type JWTPayload } from 'jose';
import { forgeError, type ForgeError } from '@mcpforge/shared/errors';
import {
  effectiveStatus,
  isoToday,
  verifyConsumerCredential,
  type ConsumerRegistry,
  type ConsumerVerifierStore,
  type CredentialMethod,
  type EffectiveConsumerStatus,
  type LoadedConsumer,
  SENSITIVITIES,
} from '../../consumer/index.js';
import { consumerCredentialRef } from '../../consumer/types.js';
import { ConsumerPresentation } from './presentation.js';
import { inMemoryAssertionReplayStore, type AssertionReplayStore } from './replay.js';

/** 05 §A.4 step 4: "`exp` ≤ 60s". A longer-lived assertion is refused, not clamped. */
export const MAX_ASSERTION_LIFETIME_SECONDS = 60;

/** jose v6 names the Ed25519 JWS algorithm `Ed25519`; `EdDSA` is its RFC 8037 spelling. Both, nothing else. */
export const ACCEPTED_ASSERTION_ALGORITHMS = ['Ed25519', 'EdDSA'] as const;

/**
 * 05 §A.2: "`client-secret` is permitted **only** for a consumer whose
 * `authorizations.writeAllowed` is `false` **and** `maxSensitivity` is at most
 * `internal`." A bearer credential in a client's JSON config is the wrong risk
 * against a session that can post AP vouchers.
 */
export const CLIENT_SECRET_MAX_SENSITIVITY = 'internal';

/** Claims a caller may pass from an ALREADY-VERIFIED user token, for corroboration only. */
export interface UserTokenCorroboration {
  /** The `iss` of the verified user token. Checked against `credential.boundIssuers`. */
  readonly issuer?: string;
  /**
   * The `client_id` / `azp` of the verified user token. 02 §11.2's Wave 1
   * nuance: it MAY corroborate the consumer binding and a mismatch refuses —
   * but it is never a substitute for registration. See `#corroborate`.
   */
  readonly clientId?: string;
}

export interface ConsumerAuthOptions {
  /** The read-only git-backed registry (W0-N1). The authority. */
  readonly registry: ConsumerRegistry;
  /**
   * The assertion audience — the gateway's own resource identifier, exactly as
   * the shim sets `aud` (05 §A.4 step 4). An assertion minted for a different
   * gateway must not verify here, so this is required and never defaulted.
   */
  readonly audience: string;
  /**
   * Verifier store for `client-secret` consumers (W0-N1's narrow port). Absent
   * = no `client-secret` consumer can authenticate, which is a refusal and not
   * a bypass.
   */
  readonly verifierStore?: ConsumerVerifierStore;
  readonly replayStore?: AssertionReplayStore;
  readonly now?: () => Date;
  readonly maxAssertionLifetimeSeconds?: number;
  /** Clock skew tolerance for the assertion's own `iat`/`exp`, in seconds. */
  readonly clockToleranceSeconds?: number;
}

export interface ConsumerAuthSuccess {
  readonly ok: true;
  readonly consumer: LoadedConsumer;
  /** For 02 §11.3's `consumer_auth_method` audit column (W0-N10 wires it). */
  readonly authMethod: CredentialMethod;
  /** The verified assertion's `jti`, or `undefined` for `client-secret`. Never the credential. */
  readonly assertionId?: string;
}

export interface ConsumerAuthRefusal {
  readonly ok: false;
  readonly error: ForgeError;
}

export type ConsumerAuthResult = ConsumerAuthSuccess | ConsumerAuthRefusal;

function sensitivityRank(value: string): number {
  return SENSITIVITIES.indexOf(value as (typeof SENSITIVITIES)[number]);
}

function refuseUnregistered(
  correlationId: string,
  message: string,
  next?: string,
): ConsumerAuthRefusal {
  return {
    ok: false,
    error: forgeError(
      'CONSUMER_UNREGISTERED',
      message,
      correlationId,
      next === undefined ? {} : { next },
    ),
  };
}

/**
 * The `[2a]` gate. One entry point, one authority (the registry), and every
 * path out of it is either a verified `LoadedConsumer` or a `ForgeError`.
 */
export class ConsumerAuthenticator {
  readonly #options: ConsumerAuthOptions;
  readonly #replay: AssertionReplayStore;

  constructor(options: ConsumerAuthOptions) {
    this.#options = options;
    this.#replay = options.replayStore ?? inMemoryAssertionReplayStore();
  }

  get replayStore(): AssertionReplayStore {
    return this.#replay;
  }

  #now(): Date {
    return this.#options.now?.() ?? new Date();
  }

  async authenticate(
    presentation: ConsumerPresentation | undefined,
    correlationId: string,
    corroboration: UserTokenCorroboration = {},
  ): Promise<ConsumerAuthResult> {
    // 1 — Nothing presented. This is the branch CLAUDE.md non-negotiable 6
    // exists for: a valid human token with no consumer credential is refused,
    // because there is no human-only path.
    if (presentation === undefined) {
      return refuseUnregistered(
        correlationId,
        'No consumer credential was presented on initialize. Every MCP session is held by a registered consumer acting for a human; a user token alone is not a session.',
        "Connect through the MCPForge client shim (`forge connect --consumer <id> --gateway <url>`), which signs the registered client assertion. If this client has no registration, register it via the portal's Consumers registration flow — self-registration does not exist.",
      );
    }

    // 2 — Find the claimed registration. For `private-key-jwt` the id comes
    // from INSIDE the assertion, so a caller cannot sign as one consumer and
    // claim to be another. This decode is UNVERIFIED and is used for lookup
    // only; nothing is trusted until the signature check below.
    const claimedId = this.#claimedId(presentation);
    if (claimedId === undefined) {
      return refuseUnregistered(
        correlationId,
        'The presented consumer credential names no consumer id.',
        'Present a client assertion whose `iss` and `sub` are the registered consumer id (05 §A.4), or re-issue the credential with `forge consumer issue-credential <id> --method private-key-jwt`.',
      );
    }

    const loaded = this.#options.registry.consumers.find((c) => c.record.id === claimedId);
    if (loaded === undefined) {
      // THE clause that makes a token claim insufficient: even a perfectly
      // formed, correctly signed, externally-issued `client_id` lands here
      // when no git-committed registration exists. Registration is the
      // authority; the claim is corroboration (02 §11.2, 05 §1.3.7).
      return refuseUnregistered(
        correlationId,
        `No consumer registration exists for "${claimedId}".`,
      );
    }

    // 3 — Status, fail-closed. `expired` is a reduction of `active` + a past
    // `expiresAt`, not a declarable state: renewal is a re-approval.
    const status = effectiveStatus(loaded.record, isoToday(this.#now()));
    if (status !== 'active') {
      return this.#refuseSuspended(loaded, status, correlationId);
    }

    // 4 — `mtls`, named and refused rather than half-built. 05 §A.2 defers it
    // explicitly: it needs a real certificate authority — a standing
    // operational asset with a key ceremony, a trust bundle, expiry tracking
    // and CRL/OCSP — which CLAUDE.md §3.1 forbids Wave 0 from making a
    // prerequisite; and an MCP client speaking stdio has no TLS handshake to
    // attach a certificate to at all. A registration declaring `mtls` is
    // therefore a registration this gateway cannot authenticate, and it is
    // told so in words rather than failing as a mysterious mismatch.
    if (loaded.record.credential.method === 'mtls') {
      return refuseUnregistered(
        correlationId,
        `Consumer "${claimedId}" is registered for credential.method "mtls", which this gateway does not implement at Wave 0.`,
        `Re-issue this consumer with \`forge consumer issue-credential ${claimedId} --method private-key-jwt\` and merge the resulting public key into ${loaded.file}. mTLS is deferred to Wave 1+ because it requires a certificate authority Wave 0 may not depend on (05 §A.2).`,
      );
    }

    // 5 — The presented method must be the REGISTERED method. A consumer
    // registered for `private-key-jwt` cannot fall back to a client secret,
    // which is the downgrade attack this check exists to close.
    if (presentation.method !== loaded.record.credential.method) {
      return refuseUnregistered(
        correlationId,
        `Consumer "${claimedId}" is registered for credential.method "${loaded.record.credential.method}" but presented a "${presentation.method}" credential.`,
        `Present the registered credential method. Changing a consumer's credential method is a change proposal against ${loaded.file} with an approval record, never a client-side choice.`,
      );
    }

    // 6 — Verify, by method.
    const verified =
      presentation.method === 'private-key-jwt'
        ? await this.#verifyPrivateKeyJwt(presentation, loaded, correlationId)
        : this.#verifyClientSecret(presentation, loaded, correlationId);
    if (!verified.ok) return verified;

    // 7 — Corroboration, which can only ever NARROW what step 2–5 established.
    const corroborated = this.#corroborate(loaded, corroboration, correlationId);
    if (corroborated !== undefined) return corroborated;

    return verified;
  }

  #claimedId(presentation: ConsumerPresentation): string | undefined {
    if (presentation.method === 'client-secret') return presentation.claimedConsumerId;
    try {
      const payload = decodeJwt(presentation.assertion ?? '');
      const iss = typeof payload.iss === 'string' ? payload.iss : undefined;
      const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
      // 05 §A.4: `iss` = `sub` = the consumer id. A disagreement between them
      // is not a lookup key, it is a malformed assertion.
      return iss !== undefined && iss === sub ? iss : undefined;
    } catch {
      return undefined;
    }
  }

  #refuseSuspended(
    loaded: LoadedConsumer,
    status: EffectiveConsumerStatus,
    correlationId: string,
  ): ConsumerAuthRefusal {
    // Two whole error constructions rather than one with a conditional `next`,
    // deliberately: `core/gateway/errors/enumeration.test.ts` verifies every
    // `next:` site, and a LITERAL site is checkable from the source text alone
    // while a computed one needs a hand-written allowlist rule. An expiry and
    // a suspension also genuinely want different words — an expired
    // registration is renewed, a suspended one is reinstated.
    if (status === 'expired') {
      return {
        ok: false,
        error: forgeError(
          'CONSUMER_SUSPENDED',
          `Consumer "${loaded.record.id}" may not open a session: its registration expired on ${loaded.record.expiresAt}.`,
          correlationId,
          {
            condition: 'The consumer is registered but its registration has expired.',
            next: `This client's registration expired on ${loaded.record.expiresAt}. Ask ${loaded.record.steward} (owner: ${loaded.record.owner}) to raise a renewal change proposal against ${loaded.file} — renewal is a re-approval, not a date edit.`,
          },
        ),
      };
    }
    return {
      ok: false,
      error: forgeError(
        'CONSUMER_SUSPENDED',
        `Consumer "${loaded.record.id}" may not open a session: its registration is ${status}.`,
        correlationId,
        {
          condition: `The consumer is registered but currently ${status}.`,
          next: `This client's registration is ${status} (reason: see ${loaded.file} and its approval record). Contact ${loaded.record.steward} to resolve, or wait for reinstatement.`,
        },
      ),
    };
  }

  /**
   * `private-key-jwt` — 05 §A.2's Wave 0 default and the only non-bearer
   * method. The gateway holds ONLY the public key, so there is nothing here
   * worth stealing: `credential.ref` (the consumer's private key) is never
   * resolved, never read, and never touched by this code path.
   */
  async #verifyPrivateKeyJwt(
    presentation: ConsumerPresentation,
    loaded: LoadedConsumer,
    correlationId: string,
  ): Promise<ConsumerAuthResult> {
    const assertion = presentation.assertion ?? '';
    const publicKeys = loaded.record.credential.publicKeys ?? [];
    if (publicKeys.length === 0) {
      return refuseUnregistered(
        correlationId,
        `Consumer "${loaded.record.id}" is registered for private-key-jwt but its record carries no credential.publicKeys[].`,
        `Run \`forge consumer rotate ${loaded.record.id}\` on the consumer's own machine and merge the resulting public key into ${loaded.file}; the gateway verifies against the record's public key and never against credential.ref.`,
      );
    }

    let kid: string | undefined;
    let alg: string | undefined;
    try {
      const header = decodeProtectedHeader(assertion);
      kid = header.kid;
      alg = header.alg;
    } catch {
      return refuseUnregistered(
        correlationId,
        'The presented client assertion is not a well-formed compact JWS.',
        'Re-run the client shim (`forge connect`); it mints the assertion. If this persists, re-issue the credential with `forge consumer issue-credential <id> --method private-key-jwt`.',
      );
    }

    if (alg === undefined || !ACCEPTED_ASSERTION_ALGORITHMS.includes(alg as 'Ed25519')) {
      // Explicit algorithm allowlist. `none`, HMAC-over-a-public-key and every
      // other algorithm-confusion trick dies here rather than in a library
      // default.
      return refuseUnregistered(
        correlationId,
        `The client assertion is signed with an unsupported algorithm (${alg ?? 'absent'}).`,
        'MCPForge accepts Ed25519 client assertions only (05 §A.2). Re-issue the consumer credential with `forge consumer issue-credential <id> --method private-key-jwt`.',
      );
    }

    // A `kid` narrows to one key; without one, every registered key is tried,
    // which is what makes 05 §A.4 step 6's dual-key rotation overlap work.
    const candidates = kid === undefined ? publicKeys : publicKeys.filter((key) => key.kid === kid);
    if (candidates.length === 0) {
      return refuseUnregistered(
        correlationId,
        `The client assertion names key id "${kid ?? ''}", which is not registered for consumer "${loaded.record.id}".`,
        `Sign with a kid present in ${loaded.file}, or rotate: \`forge consumer rotate ${loaded.record.id}\` appends the new public key beside the old one so both verify during the overlap window.`,
      );
    }

    const maxLifetime = this.#options.maxAssertionLifetimeSeconds ?? MAX_ASSERTION_LIFETIME_SECONDS;
    const now = this.#now();
    let payload: JWTPayload | undefined;
    for (const candidate of candidates) {
      try {
        const key = await importJWK(
          { kty: candidate.kty, crv: candidate.crv, x: candidate.x },
          'Ed25519',
        );
        const result = await jwtVerify(assertion, key, {
          audience: this.#options.audience,
          issuer: loaded.record.id,
          subject: loaded.record.id,
          algorithms: [...ACCEPTED_ASSERTION_ALGORITHMS],
          currentDate: now,
          ...(this.#options.clockToleranceSeconds === undefined
            ? {}
            : { clockTolerance: this.#options.clockToleranceSeconds }),
        });
        payload = result.payload;
        break;
      } catch {
        // Try the next registered key. A failure is never distinguished for
        // the caller — see the closing refusal below.
        continue;
      }
    }

    if (payload === undefined) {
      // One refusal for every verification failure, deliberately: telling a
      // caller whether the signature, the audience or the expiry failed tells
      // an attacker which knob to turn (the same reasoning as
      // ../../identity/jwt.ts's single AUTH_REQUIRED).
      return refuseUnregistered(
        correlationId,
        `The client assertion presented for consumer "${loaded.record.id}" did not verify.`,
        `Re-run the client shim so it mints a fresh assertion bound to this gateway (aud=${this.#options.audience}). If the consumer's key was rotated, merge the new public key into ${loaded.file}.`,
      );
    }

    if (typeof payload.jti !== 'string' || payload.jti.length === 0) {
      return refuseUnregistered(
        correlationId,
        'The client assertion carries no jti, so it cannot be spent single-use.',
        'The assertion must carry a unique jti (05 §A.4). Update the client shim; a replayable assertion is a bearer token wearing a signature.',
      );
    }
    if (typeof payload.exp !== 'number') {
      return refuseUnregistered(
        correlationId,
        'The client assertion carries no exp.',
        'The assertion must expire within 60 seconds of issue (05 §A.4). Update the client shim.',
      );
    }
    const issuedAt =
      typeof payload.iat === 'number' ? payload.iat : Math.floor(now.getTime() / 1000);
    if (payload.exp - issuedAt > maxLifetime) {
      return refuseUnregistered(
        correlationId,
        `The client assertion is valid for ${payload.exp - issuedAt}s; the ceiling is ${maxLifetime}s.`,
        `Mint assertions with exp ≤ ${maxLifetime}s of iat (05 §A.4). A long-lived assertion is a bearer credential, which is exactly what private-key-jwt exists to avoid.`,
      );
    }

    // Single-use, LAST — an assertion is only spent once it has otherwise
    // verified, so a garbage jti cannot burn a legitimate one.
    if (!this.#replay.consume(payload.jti, new Date(payload.exp * 1000))) {
      return refuseUnregistered(
        correlationId,
        'This client assertion has already been used.',
        'Assertions are single-use (05 §A.4). Re-run the client shim to mint a fresh one; if you did not replay it, treat the credential as captured and run `forge kill consumer:' +
          loaded.record.id +
          ' --reason "assertion replay"`.',
      );
    }

    return { ok: true, consumer: loaded, authMethod: 'private-key-jwt', assertionId: payload.jti };
  }

  /**
   * `client-secret` — a BEARER credential, and 05 §A.2 permits it only for a
   * consumer that cannot write and cannot reach past `internal`. That
   * restriction is enforced here rather than only at authoring time, because
   * this is the last place it can still fail closed: a record widened by a
   * merge that skipped the rule would otherwise be honoured at runtime.
   */
  #verifyClientSecret(
    presentation: ConsumerPresentation,
    loaded: LoadedConsumer,
    correlationId: string,
  ): ConsumerAuthResult {
    const { authorizations } = loaded.record;
    if (
      authorizations.writeAllowed ||
      sensitivityRank(authorizations.maxSensitivity) >
        sensitivityRank(CLIENT_SECRET_MAX_SENSITIVITY)
    ) {
      return refuseUnregistered(
        correlationId,
        `Consumer "${loaded.record.id}" is registered for client-secret but its authorizations exceed what a bearer credential may hold (writeAllowed=${String(authorizations.writeAllowed)}, maxSensitivity=${authorizations.maxSensitivity}).`,
        `client-secret is permitted only where writeAllowed is false and maxSensitivity is at most ${CLIENT_SECRET_MAX_SENSITIVITY} (05 §A.2). Re-issue this consumer with \`forge consumer issue-credential ${loaded.record.id} --method private-key-jwt\`, or narrow its authorizations in ${loaded.file}.`,
      );
    }

    const store = this.#options.verifierStore;
    if (store === undefined) {
      return refuseUnregistered(
        correlationId,
        'This gateway holds no consumer credential verifier store, so no client-secret consumer can authenticate.',
        'Issue the credential on this host with `forge consumer issue-credential <id>`, or move the consumer to private-key-jwt, which needs no gateway-side secret at all.',
      );
    }

    const secretRef = consumerCredentialRef(loaded.record.id);
    const entry = store.find(secretRef);
    const presented = presentation.revealSecretForVerification();
    if (
      entry === undefined ||
      presented === undefined ||
      !verifyConsumerCredential(entry, presented)
    ) {
      // The presented value is compared and dropped. It is not in this
      // message, not in `next`, and not in any object this function returns
      // (CLAUDE.md non-negotiable 8).
      return refuseUnregistered(
        correlationId,
        `The client secret presented for consumer "${loaded.record.id}" did not match its registration.`,
        `Re-issue with \`forge consumer issue-credential ${loaded.record.id}\` on this host — the value prints exactly once and cannot be recovered afterwards — then update the client's configuration.`,
      );
    }

    return { ok: true, consumer: loaded, authMethod: 'client-secret' };
  }

  /**
   * 02 §11.2's Wave 1 nuance, implemented as narrowing only:
   *
   * > "the presented token's `client_id`/`azp` claim **may** additionally
   * > corroborate the consumer binding — but it is never a substitute for
   * > registration."
   *
   * Read the shape of this function carefully, because it is the shape that
   * makes the rule structural rather than aspirational: it takes an ALREADY
   * RESOLVED `LoadedConsumer` and can only return a refusal. There is no
   * return path by which a claim produces a consumer, so a claim can never
   * stand in for the registry lookup that happened three steps earlier.
   */
  #corroborate(
    loaded: LoadedConsumer,
    corroboration: UserTokenCorroboration,
    correlationId: string,
  ): ConsumerAuthRefusal | undefined {
    const { boundIssuers } = loaded.record.credential;
    if (corroboration.issuer !== undefined && !boundIssuers.includes(corroboration.issuer)) {
      return refuseUnregistered(
        correlationId,
        `Consumer "${loaded.record.id}" presented a user token from issuer "${corroboration.issuer}", which is not in its registered boundIssuers.`,
        `Present a user token from one of this consumer's bound issuers (${boundIssuers.join(', ')}), or raise a change proposal against ${loaded.file} to bind the new issuer — it is a reviewed grant, not a client setting.`,
      );
    }
    if (corroboration.clientId !== undefined && corroboration.clientId !== loaded.record.id) {
      return refuseUnregistered(
        correlationId,
        `The user token names client_id/azp "${corroboration.clientId}" but the session was authenticated as consumer "${loaded.record.id}".`,
        `Present a user token obtained by this consumer's own client_id. A mismatch means the token was minted for different software; corroborating it is a second check on the registration, never a way to acquire one.`,
      );
    }
    return undefined;
  }
}
