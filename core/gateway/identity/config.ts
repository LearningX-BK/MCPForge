// MCPForge — `identity.provider: local | oidc`. W0-D1, 02 §4.4 item 1.
//
// 02 §4.4: "`identity.provider: local | oidc` in the overlay, plus a provider
// block. **No other code path knows which is in use.**" This file is the type
// of that overlay block. It is the first of the three things that make the LTM
// AD swap a config change rather than a hope.
//
// Only `local` has an implementation at W0-D1. The `oidc` variant is declared
// here and nowhere else is stubbed: W0-D3 builds `OidcProvider` against this
// shape, and declaring the discriminant now is what stops `local` details
// leaking into signatures that will have to carry both.

import type { IdentityProviderKind } from './types.js';

/**
 * The Wave 0 local issuer's block.
 *
 * There is no `signingKey` field, and its absence is the point: a key VALUE may
 * not appear in an overlay, which is a git artefact (CLAUDE.md non-negotiable
 * 8 — "no secret value ever appears in git ... only a reference"). The overlay
 * carries the reference; the process resolves it and hands a `LocalSigningKey`
 * to `localTokenIssuer`. At W0-D1 the `SecretStore` seam
 * (`core/gateway/secrets/**`) does not exist yet, so `signingKeyRef` is
 * declared and carried but not yet resolved by this package — see the task
 * report's flag.
 */
export interface LocalIdentityConfig {
  readonly provider: 'local';
  readonly issuer: string;
  readonly audience: string;
  /** `secretRef://gateway/local-issuer/jwt-signing`. Never a key value. */
  readonly signingKeyRef: string;
  readonly tokenTtlSeconds?: number;
}

/**
 * The Wave 1 OIDC block against LTM AD (Entra ID / ADFS). Declared at W0-D1 so
 * the discriminated union is complete; **implemented by W0-D3**.
 */
export interface OidcIdentityConfig {
  readonly provider: 'oidc';
  readonly issuer: string;
  readonly audience: string;
  /** The provider's discovery document; `jwksUri` is read from it. */
  readonly discoveryUrl: string;
  readonly clientId: string;
  /** `secretRef://gateway/oidc/client-secret`. Never a secret value. */
  readonly clientSecretRef?: string;
}

export type IdentityConfig = LocalIdentityConfig | OidcIdentityConfig;

/** Wave 0's default issuer identity when an overlay names none. */
export const DEFAULT_LOCAL_ISSUER = 'https://mcpforge.local/identity';
/** Wave 0's default audience — the gateway itself, as Resource Server. */
export const DEFAULT_LOCAL_AUDIENCE = 'mcpforge-gateway';

/**
 * The provider kind an overlay selects. A total function over the union, so
 * adding a third provider is a compile error here rather than a silent
 * default somewhere downstream.
 */
export function identityProviderKind(config: IdentityConfig): IdentityProviderKind {
  return config.provider;
}
