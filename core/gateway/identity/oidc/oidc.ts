// MCPForge — `OidcProvider`. W0-D3, 02 §4.4.
//
// The second implementation behind the identity seam, and the whole reason the
// seam exists: "the AD swap is therefore proven before it is needed, at small
// cost, instead of being discovered at the Wave 1 boundary" (02 §4.4 item 2).
//
// **The design constraint this file works under.** ../claims.ts already owns the
// one mapping between a claim set and a `Principal`, and it says of the private
// `idp` claim: "it is the one claim W0-D3's OIDC provider will not need to read
// off the wire: an OIDC token is by construction `idp: 'oidc'`, derivable from
// `iss`." So this file does NOT get a second `principalFromClaims`. What it has
// instead is `normalizeOidcClaims` — a pure RENAME-AND-DEFAULT layer that turns
// a real provider's claim set into the shape ../claims.ts already reads, after
// which the identical `principalFromClaims` runs for both providers. One
// projection, two claim vocabularies. That is what makes the contract suite
// meaningful rather than two suites wearing one filename: the legs differ in the
// key source and the claim names, not in what a `Principal` is.
//
// **Where `idp` comes from, and why it is stamped rather than read.**
// `normalizeOidcClaims` sets `idp: 'oidc'` itself, from the fact that this
// verifier verified it, and never copies an `idp` claim out of the payload. A
// token whose payload carries `idp: 'local'` is therefore normalized to `oidc`
// and accepted as an OIDC principal — the claim is ignored, not obeyed. That is
// the correct direction: `idp` will one day namespace the group→role mapping
// (W0-D4), and a token that could select its own namespace is a
// privilege-escalation primitive (../claims.ts says exactly this).
//
// **What this provider does not have.** No `issueToken`. The Authorization
// Server mints tokens here; the gateway is a Resource Server and nothing more
// (02 §4.4). No user store lookup, no local side table, no fallback principal —
// a token that does not verify is `AUTH_REQUIRED` and there is no second chance
// at it (CLAUDE.md non-negotiable 1).

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { forgeError } from '@mcpforge/shared/errors';
import { bearerToken } from '../bearer.js';
import { principalFromClaims } from '../claims.js';
import type { IdentityProvider, Principal, ProviderMetadata } from '../types.js';
import { fetchOidcDiscovery, isAcceptableMetadataUrl } from './discovery.js';
import type { OidcDiscoveryDocument } from './discovery.js';

/** The claim an OIDC provider is expected to put group memberships in. */
export const DEFAULT_GROUPS_CLAIM = 'groups';
/** OIDC core's standard display-name claim. */
export const DEFAULT_NAME_CLAIM = 'name';

/**
 * How long a fetched JWKS is reused before it is re-fetched, and how often a
 * cache miss (an unknown `kid`) may force an out-of-band re-fetch.
 *
 * Both matter for key ROTATION, which is the operational failure this provider
 * would otherwise have. When the AS rotates its signing key, tokens start
 * arriving with a `kid` the cached JWKS does not contain. `jose`'s
 * `createRemoteJWKSet` handles exactly that: on an unknown `kid` it re-fetches,
 * rate-limited by `cooldownDuration` so a stream of tokens carrying a bogus
 * `kid` cannot be turned into a fetch amplifier against the AS. `cacheMaxAge`
 * additionally bounds how long a REVOKED key stays acceptable.
 */
export const DEFAULT_JWKS_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
export const DEFAULT_JWKS_COOLDOWN_MS = 30 * 1000;
/** How long a JWKS fetch may take before it is abandoned. */
export const DEFAULT_JWKS_TIMEOUT_MS = 5 * 1000;

export interface OidcIdentityProviderOptions {
  /** The `iss` this deployment trusts. The anchor for discovery validation. */
  readonly issuer: string;
  /** The `aud` this gateway is. A token for another resource is refused. */
  readonly audience: string;
  readonly discoveryUrl: string;
  /**
   * The claim carrying group memberships. `groups` for Keycloak (with the group
   * membership mapper) and for Entra ID; overridable because ADFS deployments
   * differ. An ABSENT claim yields no groups, which is fail-closed: no groups
   * means no role grants from the git-held mapping (W0-D4).
   */
  readonly groupsClaim?: string;
  readonly nameClaim?: string;
  /** Injectable clock, so tests do not depend on wall time. */
  readonly now?: () => Date;
  /** Injectable, so discovery is testable without a network. */
  readonly fetch?: typeof globalThis.fetch;
  readonly jwksCacheMaxAgeMs?: number;
  readonly jwksCooldownMs?: number;
}

/**
 * The OIDC leg of the seam. Structurally an `IdentityProvider` and nothing more
 * — no extra surface, because any extra surface is a thing the local provider
 * would then have to grow too, and the seam would stop being a seam.
 */
export type OidcIdentityProvider = IdentityProvider;

/**
 * Construct the provider. **Async**, because discovery happens once, here, at
 * construction — not lazily on the first request.
 *
 * That is deliberate. A lazily-discovering provider is a provider whose
 * `metadata()` cannot answer until someone has already authenticated, which
 * means the protected-resource document (./protected-resource.ts) could not be
 * published until after the first caller had been turned away for not knowing
 * where to authenticate. Failing at startup when the AS is unreachable or
 * misconfigured is also the correct posture: a gateway that starts without a
 * working identity provider is a gateway that will refuse every call anyway.
 */
export async function oidcIdentityProvider(
  options: OidcIdentityProviderOptions,
): Promise<OidcIdentityProvider> {
  const discovery = await fetchOidcDiscovery({
    issuer: options.issuer,
    discoveryUrl: options.discoveryUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  return oidcIdentityProviderFrom(discovery, options);
}

/**
 * The same provider, over a discovery document already in hand. Exported so a
 * caller that has cached discovery (or a test that wants a specific document)
 * does not have to re-fetch, and so the verification logic is reachable in
 * isolation for review.
 */
export function oidcIdentityProviderFrom(
  discovery: OidcDiscoveryDocument,
  options: OidcIdentityProviderOptions,
): OidcIdentityProvider {
  if (discovery.issuer !== options.issuer) {
    throw new Error(
      `Refusing to build an OIDC provider whose discovery document (${discovery.issuer}) disagrees with its configured issuer (${options.issuer}).`,
    );
  }
  const jwksUrl = new URL(discovery.jwksUri);
  if (!isAcceptableMetadataUrl(jwksUrl)) {
    throw new Error(`Refusing to fetch a JWKS over ${jwksUrl.protocol} from ${jwksUrl.hostname}.`);
  }

  const now = options.now ?? (() => new Date());
  const groupsClaim = options.groupsClaim ?? DEFAULT_GROUPS_CLAIM;
  const nameClaim = options.nameClaim ?? DEFAULT_NAME_CLAIM;

  // Note that `options.fetch` is deliberately NOT threaded into the JWKS
  // fetcher. It exists so the discovery document can be supplied by a test
  // without a network; the JWKS is the security-critical fetch and it goes
  // through the platform's own `fetch` against a URL that has already passed
  // the transport check above, so no test seam can weaken it.
  const jwks = createRemoteJWKSet(jwksUrl, {
    cacheMaxAge: options.jwksCacheMaxAgeMs ?? DEFAULT_JWKS_CACHE_MAX_AGE_MS,
    cooldownDuration: options.jwksCooldownMs ?? DEFAULT_JWKS_COOLDOWN_MS,
    // Bounded, so an Authorization Server that accepts the connection and then
    // stalls cannot pin a gateway request open. Without it every unknown `kid`
    // becomes a request that hangs for as long as the AS cares to hold it.
    timeoutDuration: DEFAULT_JWKS_TIMEOUT_MS,
  });

  const metadata: ProviderMetadata = Object.freeze({
    kind: 'oidc' as const,
    issuer: discovery.issuer,
    audience: options.audience,
    authorizationEndpoint: discovery.authorizationEndpoint,
    tokenEndpoint: discovery.tokenEndpoint,
    jwksUri: discovery.jwksUri,
    signingAlgorithms: discovery.signingAlgorithms,
    // A real Authorization Server stands behind this one, so the
    // protected-resource document may name it. Contrast ../local.ts.
    oauthDiscoveryReady: true,
  });

  return {
    async authenticate(req: Request): Promise<Principal> {
      // Same rule as ../local.ts: the transport (W0-E1) will supply a real
      // correlation id; until it exists the header is honoured when present so a
      // refusal stays traceable. A trace id carries no authority, so inventing
      // one is not the fallback non-negotiable 1 forbids.
      const correlationId = req.headers.get('x-correlation-id') ?? 'identity-authenticate';
      const token = bearerToken(req, correlationId);
      return verifyOidcToken(token, correlationId);
    },

    /**
     * The Authorization Server is the authority on group membership here, and
     * the verified token is what it said. There is deliberately no second
     * lookup: an OIDC deployment has no local record to consult, and inventing
     * one (an LDAP query, a cached directory read) would be a second source of
     * truth for authorization that nothing in the audit trail could reconcile
     * with the token that was actually presented.
     *
     * The consequence, stated rather than hidden — identical in shape to the
     * one ../local.ts states about disabled accounts: a group removed in the
     * directory takes effect at the next token, not at the next call. That
     * window is the AS's token lifetime, and immediate revocation is a kill
     * switch and a consumer suspension (02 §11), not a re-read per call.
     */
    resolveGroups(p: Principal): Promise<readonly string[]> {
      return Promise.resolve(p.groups);
    },

    metadata(): ProviderMetadata {
      return metadata;
    },
  };

  async function verifyOidcToken(token: string, correlationId: string): Promise<Principal> {
    const refuse: () => never = () => {
      throw forgeError('AUTH_REQUIRED', 'The presented bearer token did not verify.', correlationId, {
        condition:
          'The session presented a token that failed signature, algorithm, expiry, issuer or audience verification.',
      });
    };

    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(token, jwks, {
        // PINNED, and pinned to an asymmetric-only allowlist (./discovery.ts).
        // `alg` is never taken from the token header for anything but key
        // selection inside `jose`, and a header naming an algorithm outside this
        // list is rejected before any key is fetched. That is the complete fix
        // for algorithm confusion on a path whose keys are public.
        algorithms: [...discovery.signingAlgorithms],
        issuer: discovery.issuer,
        audience: options.audience,
        clockTolerance: 0,
        currentDate: now(),
      });
      payload = verified.payload;
    } catch {
      // Swallowed for the same reason ../jwt.ts swallows it: `jose`'s error
      // names discriminate "bad signature" from "expired" from "wrong
      // audience", and that discrimination is exactly what one AUTH_REQUIRED
      // exists to deny a caller.
      refuse();
    }
    return principalFromClaims(
      normalizeOidcClaims(payload, { groupsClaim, nameClaim }),
      'oidc',
      correlationId,
    );
  }
}

export interface NormalizeOidcClaimsOptions {
  readonly groupsClaim: string;
  readonly nameClaim: string;
}

/**
 * Rename a verified OIDC payload into the claim vocabulary ../claims.ts reads.
 *
 * Pure, total, and it VALIDATES nothing — every required-claim check stays in
 * `principalFromClaims`, which is the point of routing through it. What happens
 * here is only renaming and two documented defaults:
 *
 * - `auth_time` falls back to `iat`. OIDC core makes `auth_time` mandatory only
 *   when the client requested it (`max_age`, or `auth_time` as an essential
 *   claim), so a perfectly ordinary access token often lacks it. `iat` is the
 *   closest honest answer — "no later than this" — and it is an over-estimate of
 *   freshness in the safe direction, never an under-estimate.
 * - `amr` falls back to `[]`. The local provider forbids an empty `amr` at issue
 *   time because it performed the credential check itself and therefore knows
 *   what ran (../local.ts). Here the gateway performed no check at all, so `[]`
 *   is the honest value: "the Authorization Server did not say how." Asserting
 *   `['pwd']` because a password was probably involved would put a factor nobody
 *   verified into the audit trail.
 *
 * Note the two claims that are NOT copied from the payload at any cost:
 * `idp` (stamped, see the file header) and `groups` under any name but the
 * configured one.
 */
export function normalizeOidcClaims(
  payload: JWTPayload,
  options: NormalizeOidcClaimsOptions,
): Record<string, unknown> {
  const raw = payload as unknown as Record<string, unknown>;
  const groups = raw[options.groupsClaim];
  const authTime = raw['auth_time'];
  const amr = raw['amr'];
  return {
    sub: raw['sub'],
    name: raw[options.nameClaim],
    ...(raw['email'] === undefined ? {} : { email: raw['email'] }),
    groups: groups === undefined || groups === null ? [] : groups,
    auth_time: authTime === undefined || authTime === null ? raw['iat'] : authTime,
    amr: amr === undefined || amr === null ? [] : amr,
    // Stamped from the fact that THIS verifier verified it. Never read.
    idp: 'oidc',
  };
}
