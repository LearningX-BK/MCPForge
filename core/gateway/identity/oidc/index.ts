// MCPForge — the OIDC leg's public surface. W0-D3, 02 §4.4.
//
// What crosses this boundary is an `IdentityProvider` and a JSON document
// builder. What does NOT cross it, for the same reasons ../index.ts lists: no
// key material, no token minting (the Authorization Server does that here, not
// the gateway), and no `Principal` → audit-input helper.

export {
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  OIDC_ACCEPTED_ALGORITHMS,
  fetchOidcDiscovery,
  isAcceptableMetadataUrl,
  type FetchDiscoveryOptions,
  type OidcDiscoveryDocument,
} from './discovery.js';
export {
  DEFAULT_GROUPS_CLAIM,
  DEFAULT_JWKS_CACHE_MAX_AGE_MS,
  DEFAULT_JWKS_COOLDOWN_MS,
  DEFAULT_JWKS_TIMEOUT_MS,
  DEFAULT_NAME_CLAIM,
  normalizeOidcClaims,
  oidcIdentityProvider,
  oidcIdentityProviderFrom,
  type NormalizeOidcClaimsOptions,
  type OidcIdentityProvider,
  type OidcIdentityProviderOptions,
} from './oidc.js';
export {
  PROTECTED_RESOURCE_METADATA_SUFFIX,
  protectedResourceMetadata,
  protectedResourceMetadataPath,
  wwwAuthenticateChallenge,
  type ProtectedResourceMetadata,
  type ProtectedResourceMetadataOptions,
  type ProtectedResourceMetadataResult,
} from './protected-resource.js';
