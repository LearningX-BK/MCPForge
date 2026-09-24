// MCPForge — reading the presented consumer credential off the wire. W0-N2,
// 02 §4.2 step `[2a]` / 02 §11.2 / 05 §1.3.4.
//
// This is the consumer-side twin of `../../identity/bearer.ts`, and it is a
// separate, small file for the same reason that one is: it is the one place a
// raw *consumer* credential is read out of an HTTP request, so it has to be
// reviewable in isolation.
//
// **Two credentials travel on the same request and they are not the same
// thing.** `Authorization: Bearer <user token>` is the HUMAN (02 §4.2 step
// `[2]`). The headers below are the SOFTWARE. CLAUDE.md non-negotiable 6:
// authorization is the INTERSECTION of the two and neither substitutes for the
// other. Nothing in this file reads the `Authorization` header, and nothing in
// this file resolves a human identity.
//
// **Header names — a decision the documents do not make (CLAUDE.md §8, "the
// spec is silent on a small implementation detail").** 05 §A.4 fixes the
// *mechanism* (an Ed25519 client assertion signed by a shim, `iss` = `sub` =
// the consumer id, `aud` = the gateway, `jti` single-use, `exp` ≤ 60s) but
// names no header. OAuth's own `private_key_jwt` carries the assertion as
// `client_assertion` form parameters at a token endpoint; MCPForge has no
// token endpoint of its own at Wave 0 and the assertion has to ride the
// Streamable HTTP `initialize` POST, whose body is JSON-RPC and not ours to
// extend. So: dedicated request headers, named below, recorded here rather
// than left implicit. Changing them later is a client-shim change, not an
// architecture change.
//
// **What is deliberately NOT read here:** nothing takes a consumer id from a
// header when the method is `private-key-jwt`. The id is `iss`/`sub` INSIDE
// the signed assertion, so a caller cannot claim to be one consumer while
// signing as another. `MCPFORGE_CONSUMER_ID_HEADER` is read only for the
// `client-secret` method, where there is no signed envelope to carry it, and
// even there it is a *claim* that the verifier then has to match.

import type { IncomingHttpHeaders } from 'node:http';

/** The assertion, for `credential.method: private-key-jwt` (05 §A.2 — the Wave 0 default). */
export const MCPFORGE_CONSUMER_ASSERTION_HEADER = 'mcpforge-consumer-assertion';
/** The consumer id, for `credential.method: client-secret` only. A claim, never a grant. */
export const MCPFORGE_CONSUMER_ID_HEADER = 'mcpforge-consumer-id';
/** The bearer client secret, for `credential.method: client-secret` only. */
export const MCPFORGE_CONSUMER_SECRET_HEADER = 'mcpforge-consumer-secret';

export type PresentedMethod = 'private-key-jwt' | 'client-secret';

/**
 * What arrived. `claimedConsumerId` is exactly that — claimed. It is the key
 * used to LOOK UP a registration; it is never itself evidence of one.
 *
 * `secret` is a live credential value. It is carried in this object and
 * nowhere else: it is never returned by, stored by, or logged from anything
 * downstream (CLAUDE.md non-negotiable 8). `toJSON` below makes that hold even
 * for an accidental `JSON.stringify` in a log line or an error envelope.
 */
export class ConsumerPresentation {
  readonly method: PresentedMethod;
  readonly claimedConsumerId: string | undefined;
  readonly assertion: string | undefined;
  readonly #secret: string | undefined;

  private constructor(init: {
    method: PresentedMethod;
    claimedConsumerId?: string | undefined;
    assertion?: string | undefined;
    secret?: string | undefined;
  }) {
    this.method = init.method;
    this.claimedConsumerId = init.claimedConsumerId;
    this.assertion = init.assertion;
    this.#secret = init.secret;
  }

  static privateKeyJwt(assertion: string): ConsumerPresentation {
    return new ConsumerPresentation({ method: 'private-key-jwt', assertion });
  }

  static clientSecret(consumerId: string, secret: string): ConsumerPresentation {
    return new ConsumerPresentation({
      method: 'client-secret',
      claimedConsumerId: consumerId,
      secret,
    });
  }

  /**
   * The single read point for the secret value. Named so that a reviewer
   * grepping for where a consumer secret escapes has exactly one hit, and so
   * that the verifier is obviously the only caller.
   */
  revealSecretForVerification(): string | undefined {
    return this.#secret;
  }

  /** A stringified presentation carries no credential material. Ever. */
  toJSON(): Record<string, unknown> {
    return {
      method: this.method,
      claimedConsumerId: this.claimedConsumerId ?? null,
      assertion: this.assertion === undefined ? null : '[redacted]',
      secret: this.#secret === undefined ? null : '[redacted]',
    };
  }
}

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Pull the presentation off a request, or `undefined` when the caller
 * presented no consumer credential at all.
 *
 * `undefined` is NOT a permission. The caller refuses it — see
 * `./authenticate.ts`, whose first branch is exactly that. There is no
 * "anonymous consumer", no default consumer id and no environment variable
 * that supplies one (CLAUDE.md non-negotiable 1).
 */
export function readConsumerPresentation(
  headers: IncomingHttpHeaders,
): ConsumerPresentation | undefined {
  const assertion = single(headers[MCPFORGE_CONSUMER_ASSERTION_HEADER]);
  if (assertion !== undefined) {
    return ConsumerPresentation.privateKeyJwt(assertion);
  }
  const secret = single(headers[MCPFORGE_CONSUMER_SECRET_HEADER]);
  const id = single(headers[MCPFORGE_CONSUMER_ID_HEADER]);
  if (secret !== undefined && id !== undefined) {
    return ConsumerPresentation.clientSecret(id, secret);
  }
  return undefined;
}
