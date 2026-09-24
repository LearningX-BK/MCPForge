// MCPForge — the identity seam's public surface. W0-D1, 02 §4.4.
//
// **What crosses this boundary, and what may not.** `Principal` and
// `IdentityProvider` cross it. `IssuedToken` crosses it, because the transport
// (W0-E1) has to hand a minted token back to a client that logged in. What does
// NOT cross it, deliberately:
//
// - No `Principal` → audit-input helper. 02 §4.4 item 3: `Principal.subject` is
//   the only identity value written to audit, mappings and idempotency keys.
//   Not exporting a convenience mapper is what keeps that structural rather
//   than a review comment — a caller that wants an identity value in a stored
//   column has to write `principal.subject` and can write nothing else without
//   noticing. Asserted by ./subject-only.test.ts.
// - No key material, and no accessor for it. `LocalSigningKey` holds a
//   `KeyObject`; there is no `exportKey`, no `toBytes`, no `toString`.
// - No "current principal" ambient/global. Every consumer receives a
//   `Principal` explicitly, so no code path can acquire an identity it was not
//   handed (and no code path can acquire one when it was handed none).

export type {
  IdentityProvider,
  IdentityProviderKind,
  Principal,
  ProviderMetadata,
} from './types.js';
export {
  epochSeconds,
  principalFromClaims,
  principalToClaims,
  type PrincipalClaims,
} from './claims.js';
export {
  DEFAULT_LOCAL_AUDIENCE,
  DEFAULT_LOCAL_ISSUER,
  identityProviderKind,
  type IdentityConfig,
  type LocalIdentityConfig,
  type OidcIdentityConfig,
} from './config.js';
export { bearerToken } from './bearer.js';
export {
  DEFAULT_TOKEN_TTL_SECONDS,
  LOCAL_JWT_ALGORITHM,
  LOCAL_SIGNING_KEY_BYTES,
  generateLocalSigningKey,
  localSigningKeyFrom,
  localTokenIssuer,
  type IssuedToken,
  type LocalSigningKey,
  type LocalTokenIssuer,
  type LocalTokenIssuerOptions,
} from './jwt.js';
export {
  localIdentityProvider,
  staticLocalPrincipalSource,
  type LocalIdentityProvider,
  type LocalIdentityProviderOptions,
  type LocalPrincipalRecord,
  type LocalPrincipalSource,
} from './local.js';
// W0-D2 — the Wave 0 `LocalUserStore` that implements the seam above. Note
// what still does not cross this boundary: no password hash, no TOTP secret,
// and no type that carries either. See ./local/index.ts.
export {
  AMR_OTP,
  AMR_PASSWORD,
  DEFAULT_LOCKOUT_SECONDS,
  DEFAULT_LOCKOUT_THRESHOLD,
  LOCAL_SUBJECT_PREFIX,
  MIN_PASSWORD_LENGTH,
  PASSWORD_ALGORITHM,
  localSubject,
  localUserStore,
  type CreateLocalUserRequest,
  type LocalAuthentication,
  type LocalSignIn,
  type LocalUserStore,
  type LocalUserStoreOptions,
  type TotpEnrolment,
} from './local/index.js';
// W0-D3 — the OIDC leg of the seam, and the RFC 9728 protected-resource
// document the MCP spec requires. Note the asymmetry that is correct rather
// than an omission: there is no `issueToken` here, because under OIDC the
// Authorization Server mints tokens and the gateway is only a Resource Server.
export {
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  DEFAULT_GROUPS_CLAIM,
  DEFAULT_JWKS_CACHE_MAX_AGE_MS,
  DEFAULT_JWKS_COOLDOWN_MS,
  DEFAULT_JWKS_TIMEOUT_MS,
  DEFAULT_NAME_CLAIM,
  OIDC_ACCEPTED_ALGORITHMS,
  PROTECTED_RESOURCE_METADATA_SUFFIX,
  fetchOidcDiscovery,
  isAcceptableMetadataUrl,
  normalizeOidcClaims,
  oidcIdentityProvider,
  oidcIdentityProviderFrom,
  protectedResourceMetadata,
  protectedResourceMetadataPath,
  wwwAuthenticateChallenge,
  type FetchDiscoveryOptions,
  type NormalizeOidcClaimsOptions,
  type OidcDiscoveryDocument,
  type OidcIdentityProvider,
  type OidcIdentityProviderOptions,
  type ProtectedResourceMetadata,
  type ProtectedResourceMetadataOptions,
  type ProtectedResourceMetadataResult,
} from './oidc/index.js';
