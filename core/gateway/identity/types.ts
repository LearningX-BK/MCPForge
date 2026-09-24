// MCPForge — the identity seam. W0-D1, 02 §4.4.
//
// **One interface, and everything downstream consumes only `Principal`.**
// That sentence is the whole point of this file. A policy check, a scope
// resolution, an audit write and a binding executor never see a request, a
// bearer token, a password, a session cookie or a provider-specific claim set:
// they see a `Principal`, and when they need an identity VALUE they take
// `Principal.subject` and nothing else (02 §4.4 item 3).
//
// The seam exists so the Wave 1 swap to LTM AD (Entra ID / ADFS) is a config
// change and not a rewrite: `identity.provider: local | oidc` in the overlay
// (./config.ts) selects an implementation, one contract suite runs against
// both (W0-D3), and no other code path knows which is in use.

/**
 * Which implementation is behind the seam. Closed on purpose: a third value
 * would be a third code path, and 02 §4.4 says there are two.
 */
export type IdentityProviderKind = 'local' | 'oidc';

/**
 * 02 §4.4, verbatim. The only identity object that crosses this boundary.
 *
 * `subject` is **stable, opaque and immutable — the audit key**. It is the one
 * field that may be written to audit rows, target-identity mappings and
 * idempotency keys. Everything else on this object exists to be *rendered* to
 * a human or *evaluated* by policy, never to be stored as an identity value:
 *
 * - `displayName` / `email` are presentation, and they change when a person
 *   marries, is renamed in the directory, or moves domain. Storing either as
 *   an identity value would make the audit trail disagree with itself after a
 *   directory edit nobody in this system performed.
 * - `groups` are an input to the git-held group→role mapping (W0-D4), not a
 *   grant in themselves.
 * - `idp`, `authTime` and `amr` describe *how* this principal was established.
 *   02 §4.6 gives `audit_call` optional `caller_idp` / `caller_amr` /
 *   `caller_display` columns for that context, but **this layer never fills
 *   them from a `Principal`**: there is deliberately no
 *   `Principal`→`AppendAuditCallInput` helper anywhere in this package, so the
 *   only identity value that can reach the store is the `subject` string a
 *   caller passes explicitly. See ./subject-only.test.ts.
 */
export interface Principal {
  /** Stable, opaque, immutable — the audit key. */
  readonly subject: string;
  readonly displayName: string;
  readonly email?: string;
  readonly groups: readonly string[];
  readonly idp: IdentityProviderKind;
  readonly authTime: Date;
  /** How they authenticated — OIDC `amr`, e.g. `['pwd']`, `['pwd','otp']`. */
  readonly amr: readonly string[];
}

/**
 * What `IdentityProvider.metadata()` reports, for MCP OAuth discovery.
 *
 * **Honest at Wave 0.** The MCP spec's OAuth 2.1 flow has the gateway as
 * Resource Server and the IdP as Authorization Server (02 §4.4). At Wave 0
 * there is no Authorization Server: the gateway mints its own short-lived
 * tokens for the local user store, so `authorizationEndpoint`, `tokenEndpoint`
 * and `jwksUri` are `null` and `oauthDiscoveryReady` is `false`. They are
 * `null` rather than a placeholder URL precisely so nothing downstream can
 * publish a protected-resource document that points at an endpoint which does
 * not exist. Populating them is W0-D3's job, from the OIDC discovery document.
 *
 * `jwksUri` stays `null` for the local provider even after W0-D3, and that is
 * correct, not an omission: the local issuer signs with a symmetric key
 * (./jwt.ts) and a symmetric key is never published.
 */
export interface ProviderMetadata {
  readonly kind: IdentityProviderKind;
  /** The `iss` claim this provider's tokens carry, and that it will accept. */
  readonly issuer: string;
  /** The `aud` claim this provider's tokens carry, and that it will accept. */
  readonly audience: string;
  readonly authorizationEndpoint: string | null;
  readonly tokenEndpoint: string | null;
  readonly jwksUri: string | null;
  /** The JWS algorithms this provider will accept. Closed, never `none`. */
  readonly signingAlgorithms: readonly string[];
  /**
   * Whether a real OAuth 2.1 Authorization Server stands behind this provider.
   * `false` for the Wave 0 local issuer — the gateway is both issuer and
   * verifier, and the MCP protected-resource metadata document may not claim
   * otherwise.
   */
  readonly oauthDiscoveryReady: boolean;
}

/**
 * 02 §4.4, verbatim. Three methods, and no fourth.
 *
 * Note what is absent and must stay absent: there is no `authenticateOrDefault`,
 * no `systemPrincipal()`, no `serviceAccount()`. A request that cannot be
 * resolved to a real human principal throws — `AUTH_REQUIRED` when no
 * credential was presented or it did not verify, `IDENTITY_UNRESOLVED` when it
 * verified but names nobody this deployment knows. **There is no
 * service-account fallback anywhere in this codebase** (CLAUDE.md
 * non-negotiable 1, 02 §4.4 rule 2), and adding a defaulting overload here
 * would be the single cheapest way to hollow that claim out.
 */
export interface IdentityProvider {
  /** 401 shape is provider-specific, `Principal` is not. */
  authenticate(req: Request): Promise<Principal>;
  resolveGroups(p: Principal): Promise<readonly string[]>;
  metadata(): ProviderMetadata;
}
