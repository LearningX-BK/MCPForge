// MCPForge — the OIDC discovery document, fetched and validated. W0-D3, 02 §4.4.
//
// This is the file that turns `OidcIdentityConfig.discoveryUrl` into the three
// endpoints `ProviderMetadata` reports and the one URL that actually matters for
// security: `jwks_uri`. It is deliberately small and deliberately paranoid,
// because everything the verifier trusts about the Authorization Server arrives
// through here.
//
// **What is validated, and why each check is load-bearing:**
//
//  1. `issuer` in the document MUST equal the issuer the overlay configured.
//     RFC 8414 §3.3. Without it, an attacker who can influence `discoveryUrl`
//     redirects the gateway to their own AS, whose JWKS then verifies their own
//     tokens, and every `iss` check downstream passes because the expected
//     issuer came from the same poisoned document.
//  2. The document is fetched over HTTPS, with exactly one exception: a loopback
//     host. That exception exists so a Testcontainers Keycloak on
//     `http://127.0.0.1:<port>` can be contract-tested (W0-D3's done clause),
//     and it is expressed as "the host is loopback" rather than as a config flag
//     precisely so no overlay can turn plaintext transport on for a real
//     deployment. A boolean called `allowInsecureTransport` is the kind of knob
//     that ends up `true` in production.
//  3. `jwks_uri` must be present, absolute, and on the same transport rule. A
//     provider with no JWKS cannot verify anything and must fail at construction
//     rather than at the first request.
//  4. The signing algorithms this provider will accept are the intersection of
//     the asymmetric allowlist below and what the document advertises — never
//     the document's list alone. See ./oidc.ts for why that intersection, and
//     not the union or the document, is the algorithm-confusion defence.

/**
 * The JWS algorithms an `OidcProvider` will ever accept.
 *
 * **Asymmetric only, and closed.** `none` is absent, and so is every `HS*`
 * variant, and neither omission is an oversight:
 *
 * - `none` needs no explanation beyond naming it.
 * - `HS*` is the algorithm-confusion attack. When a verifier will accept both
 *   RS256 and HS256, an attacker takes the AS's *public* signing key — which is
 *   published, by design, at `jwks_uri` — and uses it as the HMAC secret to sign
 *   a token of their choosing with `alg: HS256`. A verifier that reads `alg`
 *   from the header then validates it happily. The only complete fix is to never
 *   admit a symmetric algorithm on a path whose keys are public, which is what
 *   this constant does.
 *
 * The local provider's `HS256` (../jwt.ts) is safe for the opposite reason: its
 * key is symmetric AND secret AND never published as a JWKS. The two lists must
 * therefore stay disjoint, and they are.
 */
export const OIDC_ACCEPTED_ALGORITHMS = Object.freeze([
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
] as const);

/** The subset of the OIDC/OAuth metadata document this gateway reads. */
export interface OidcDiscoveryDocument {
  readonly issuer: string;
  readonly jwksUri: string;
  readonly authorizationEndpoint: string | null;
  readonly tokenEndpoint: string | null;
  /** Already intersected with `OIDC_ACCEPTED_ALGORITHMS`. Never empty. */
  readonly signingAlgorithms: readonly string[];
}

export interface FetchDiscoveryOptions {
  /** The issuer the overlay configured. The document must agree with it. */
  readonly issuer: string;
  readonly discoveryUrl: string;
  /** Injectable so a test can drive discovery without a network. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

export const DEFAULT_DISCOVERY_TIMEOUT_MS = 10_000;

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * `true` when a plaintext URL is acceptable — loopback only.
 *
 * Exported because ./oidc.ts applies the identical rule to the JWKS fetch, and
 * two copies of a transport-security predicate is one copy too many.
 */
export function isAcceptableMetadataUrl(url: URL): boolean {
  if (url.protocol === 'https:') {
    return true;
  }
  return url.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(url.hostname);
}

function requireAcceptableUrl(raw: string, what: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`The OIDC ${what} must be an absolute URL; got ${JSON.stringify(raw)}.`);
  }
  if (!isAcceptableMetadataUrl(url)) {
    throw new Error(
      `The OIDC ${what} must use https (a loopback host may use http, for local development and the contract suite); got ${url.protocol}//${url.hostname}.`,
    );
  }
  return url;
}

function optionalEndpoint(value: unknown, what: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`The OIDC discovery document's ${what} is present but is not a URL string.`);
  }
  return requireAcceptableUrl(value, what).toString();
}

/**
 * Fetch and validate the discovery document.
 *
 * Throws a plain `Error`, not a `ForgeError`: this runs at process/provider
 * construction, not on a caller-visible path, and there is no agent-actionable
 * `next` for "the operator pointed the overlay at the wrong URL". A gateway that
 * cannot construct its identity provider must not start.
 */
export async function fetchOidcDiscovery(
  options: FetchDiscoveryOptions,
): Promise<OidcDiscoveryDocument> {
  const discoveryUrl = requireAcceptableUrl(options.discoveryUrl, 'discovery URL');
  const doFetch = options.fetch ?? globalThis.fetch;
  const response = await doFetch(discoveryUrl, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `The OIDC discovery document at ${discoveryUrl.toString()} returned HTTP ${response.status}.`,
    );
  }
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('The OIDC discovery document is not a JSON object.');
  }
  const doc = body as Record<string, unknown>;

  const issuer = doc['issuer'];
  if (typeof issuer !== 'string' || issuer.length === 0) {
    throw new Error('The OIDC discovery document has no "issuer".');
  }
  // RFC 8414 §3.3. The configured issuer is the anchor; the document is the
  // thing being checked against it, never the other way round.
  if (issuer !== options.issuer) {
    throw new Error(
      `The OIDC discovery document declares issuer ${JSON.stringify(issuer)} but this deployment is configured for ${JSON.stringify(options.issuer)}. Refusing to trust it.`,
    );
  }

  const jwksUriRaw = doc['jwks_uri'];
  if (typeof jwksUriRaw !== 'string' || jwksUriRaw.length === 0) {
    throw new Error('The OIDC discovery document has no "jwks_uri"; nothing could be verified.');
  }
  const jwksUri = requireAcceptableUrl(jwksUriRaw, 'jwks_uri').toString();

  const advertised = doc['id_token_signing_alg_values_supported'];
  const signingAlgorithms = intersectAlgorithms(advertised);
  if (signingAlgorithms.length === 0) {
    throw new Error(
      `The OIDC provider at ${issuer} advertises no signing algorithm MCPForge accepts (accepted: ${OIDC_ACCEPTED_ALGORITHMS.join(', ')}).`,
    );
  }

  return {
    issuer,
    jwksUri,
    authorizationEndpoint: optionalEndpoint(doc['authorization_endpoint'], 'authorization_endpoint'),
    tokenEndpoint: optionalEndpoint(doc['token_endpoint'], 'token_endpoint'),
    signingAlgorithms: Object.freeze(signingAlgorithms),
  };
}

/**
 * Intersect what the document advertises with what we accept.
 *
 * A document that advertises nothing (some providers omit the field) yields the
 * full allowlist, which is still closed and still asymmetric-only — the
 * allowlist is the ceiling in every case, so the fallback cannot widen anything.
 */
function intersectAlgorithms(advertised: unknown): string[] {
  const accepted: readonly string[] = OIDC_ACCEPTED_ALGORITHMS;
  if (advertised === undefined || advertised === null) {
    return [...accepted];
  }
  if (!Array.isArray(advertised)) {
    throw new Error(
      'The OIDC discovery document\'s "id_token_signing_alg_values_supported" is not an array.',
    );
  }
  return accepted.filter((alg) => advertised.includes(alg));
}
