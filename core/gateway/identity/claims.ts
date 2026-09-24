// MCPForge — the OIDC-shaped claim set, and the only mapping between it and
// `Principal`. W0-D1, 02 §4.4.
//
// **The design move this file exists for.** 02 §4.4: "even in Wave 0 every
// downstream component consumes a JWT with `sub`/`groups`/`iat`/`exp`, so
// nothing downstream has to change when the issuer changes." For that to be
// true rather than aspirational, a `Principal` must be reconstructible from
// the token's claims ALONE — no second lookup, no local side table keyed by
// `sub`. So every `Principal` field rides in the payload, and every one of
// them uses the claim name a real OIDC provider would already emit:
//
//   Principal.subject      -> sub        (OIDC core, registered)
//   Principal.displayName  -> name       (OIDC core, standard claim)
//   Principal.email        -> email      (OIDC core, standard claim)
//   Principal.groups       -> groups     (de-facto: Entra ID, ADFS, Keycloak)
//   Principal.authTime     -> auth_time  (OIDC core, seconds since epoch)
//   Principal.amr          -> amr        (OIDC core, array of strings)
//   Principal.idp          -> idp        (the ONE private claim; see below)
//
// `idp` is private because no registered claim carries it. It is also the one
// claim W0-D3's OIDC provider will not need to read off the wire: an OIDC token
// is by construction `idp: 'oidc'`, derivable from `iss`. It is emitted here so
// a token is self-describing when read by a human debugging an audit trail, and
// `principalFromClaims` treats a mismatch with the expected kind as a forgery
// rather than as information — see below.

import { forgeError } from '@mcpforge/shared/errors';
import type { IdentityProviderKind, Principal } from './types.js';

/**
 * The payload of a MCPForge identity token. `iss`/`aud`/`iat`/`exp`/`nbf`/`jti`
 * are the registered JWT claims; the rest are the `Principal` projection above.
 */
export interface PrincipalClaims {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
  readonly nbf: number;
  readonly jti: string;
  readonly name: string;
  readonly email?: string;
  readonly groups: readonly string[];
  readonly auth_time: number;
  readonly amr: readonly string[];
  readonly idp: IdentityProviderKind;
}

/** Seconds since the epoch, floored — the unit every time claim uses. */
export function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Project a `Principal` into the claim set. Pure: it mints no time and no
 * `jti`, because a claim set that invented its own `iat` would be untestable
 * and would differ from the token the issuer actually signed.
 */
export function principalToClaims(
  principal: Principal,
  envelope: {
    readonly issuer: string;
    readonly audience: string;
    readonly issuedAt: Date;
    readonly expiresAt: Date;
    readonly jti: string;
  },
): PrincipalClaims {
  const iat = epochSeconds(envelope.issuedAt);
  return {
    iss: envelope.issuer,
    aud: envelope.audience,
    sub: principal.subject,
    iat,
    exp: epochSeconds(envelope.expiresAt),
    nbf: iat,
    jti: envelope.jti,
    name: principal.displayName,
    // Spread rather than `email: principal.email`, because
    // `exactOptionalPropertyTypes` is on and an explicit `undefined` would
    // serialise the key away anyway — this keeps the type honest.
    ...(principal.email === undefined ? {} : { email: principal.email }),
    groups: [...principal.groups],
    auth_time: epochSeconds(principal.authTime),
    amr: [...principal.amr],
    idp: principal.idp,
  };
}

/**
 * Every rejection from this file is `AUTH_REQUIRED`, never `INTERNAL` and never
 * a bare `Error`: a malformed claim set is a credential that did not verify,
 * and the caller's next step is to re-authenticate. The `correlationId` is the
 * caller's, so a refusal is traceable to the request that caused it.
 */
function reject(message: string, correlationId: string): never {
  throw forgeError('AUTH_REQUIRED', message, correlationId, {
    condition: `The presented token's claim set is not usable: ${message}`,
  });
}

function requireString(value: unknown, claim: string, correlationId: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    reject(`claim "${claim}" must be a non-empty string`, correlationId);
  }
  return value;
}

function requireSeconds(value: unknown, claim: string, correlationId: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    reject(`claim "${claim}" must be a finite number of seconds`, correlationId);
  }
  return value;
}

function requireStringArray(value: unknown, claim: string, correlationId: string): string[] {
  if (!Array.isArray(value)) {
    reject(`claim "${claim}" must be an array of strings`, correlationId);
  }
  return value.map((entry, index) => requireString(entry, `${claim}[${index}]`, correlationId));
}

/**
 * Reconstruct a `Principal` from a verified claim set.
 *
 * **`claims` must already have had its signature, `exp`, `nbf`, `iss` and `aud`
 * checked** — that is ./jwt.ts's job and this function does not repeat it. What
 * it does is the part a JWS verifier cannot do: assert that the payload is a
 * MCPForge principal and not merely well-formed JSON that happened to be signed
 * with an accepted key.
 *
 * `expectedIdp` is compared, not trusted. A token minted by the local issuer
 * that claims `idp: 'oidc'` is refused rather than believed, because `idp` will
 * one day feed the group→role mapping's namespace (W0-D4) and a claim that
 * selects its own namespace is a privilege-escalation primitive.
 */
export function principalFromClaims(
  claims: unknown,
  expectedIdp: IdentityProviderKind,
  correlationId: string,
): Principal {
  if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) {
    reject('the token payload is not a JSON object', correlationId);
  }
  const c = claims as Record<string, unknown>;

  const idp = requireString(c['idp'], 'idp', correlationId);
  if (idp !== expectedIdp) {
    reject(
      `claim "idp" is "${idp}" but this provider issues "${expectedIdp}" tokens`,
      correlationId,
    );
  }

  const email = c['email'];
  if (email !== undefined) {
    requireString(email, 'email', correlationId);
  }

  const authTimeSeconds = requireSeconds(c['auth_time'], 'auth_time', correlationId);

  return {
    subject: requireString(c['sub'], 'sub', correlationId),
    displayName: requireString(c['name'], 'name', correlationId),
    ...(email === undefined ? {} : { email: email as string }),
    groups: Object.freeze(requireStringArray(c['groups'], 'groups', correlationId)),
    idp: expectedIdp,
    authTime: new Date(authTimeSeconds * 1000),
    amr: Object.freeze(requireStringArray(c['amr'], 'amr', correlationId)),
  };
}
