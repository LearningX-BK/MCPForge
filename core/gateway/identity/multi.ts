// MCPForge — several identity providers at once. W0-P23, W0-P4 §2.1 and §9 decision 1.
//
// The owner decided (25 Sep 2026) that one deployment may have several
// providers active at once: local, Entra ID, OCI IAM, Agentis. This module is
// the router that makes that true without any downstream code knowing: the
// session assembly still sees one `authenticate` and one `resolveGroups`, and
// still gets one `Principal` back.
//
// **How a token finds its provider.** By its `iss`, read from the payload
// BEFORE verification, and used for nothing but choosing which configured
// verifier gets to verify it. The chosen provider then verifies the signature
// against ITS OWN keys (the local issuer's key, or that provider's JWKS), its
// own `iss` and `aud`, and qualifies the subject with ITS OWN configured id.
// An attacker who writes another provider's `iss` into a token only chooses a
// verifier that will refuse it, because they do not hold that provider's
// signing key. There is no second chance: a token that the chosen provider
// refuses is refused, never offered to another provider.
//
// **What is absent and must stay absent** (non-negotiable 1): no "try every
// provider until one accepts", no default provider for a token with no `iss`,
// and no principal for an issuer nobody configured. Every one of those is a
// single AUTH_REQUIRED, with the same message an invalid signature gets, so the
// router is not an oracle for which issuers a deployment trusts.

import { forgeError } from '@mcpforge/shared/errors';
import { bearerToken } from './bearer.js';
import type { IdentityConfig, IdentityProviderConfig } from './config.js';
import { LOCAL_PROVIDER_ID } from './config.js';
import { oidcIdentityProvider } from './oidc/oidc.js';
import { providerIdOfSubject } from './subject.js';
import type {
  IdentityProvider,
  IdentityProviderKind,
  Principal,
  ProviderMetadata,
} from './types.js';

/** One configured provider, built. */
export interface ConfiguredProvider {
  readonly id: string;
  readonly kind: IdentityProviderKind;
  readonly config: IdentityProviderConfig;
  readonly provider: IdentityProvider;
}

/**
 * The deployment's identity, over every configured provider. Deliberately NOT
 * an `IdentityProvider`: `metadata()` describes ONE provider, and a router that
 * answered it would have to pick one and misdescribe the rest. Callers that
 * need metadata ask for a provider by id.
 */
export interface MultiProviderIdentity {
  authenticate(req: Request): Promise<Principal>;
  resolveGroups(p: Principal): Promise<readonly string[]>;
  readonly providers: readonly ConfiguredProvider[];
  provider(id: string): ConfiguredProvider | undefined;
  metadataFor(id: string): ProviderMetadata | undefined;
}

/** The message every token refusal carries (identical to ./jwt.ts and ./oidc/oidc.ts). */
const DID_NOT_VERIFY = 'The presented bearer token did not verify.';

function refuse(correlationId: string): never {
  throw forgeError('AUTH_REQUIRED', DID_NOT_VERIFY, correlationId, {
    condition:
      'The session presented a token that failed signature, algorithm, expiry, issuer or audience verification.',
  });
}

/**
 * The `iss` of a compact JWS, unverified. `undefined` for anything that is not
 * three base64url parts with a JSON object payload carrying a string `iss`.
 */
export function unverifiedIssuer(token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[1] === undefined || parts[1].length === 0) return undefined;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
    const iss = (payload as Record<string, unknown>)['iss'];
    return typeof iss === 'string' && iss.length > 0 ? iss : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Route over already-built providers. Throws on a configuration that would make
 * routing ambiguous (two providers, one issuer) or a duplicate id: both are
 * startup errors, never something resolved per request.
 */
export function multiProviderIdentity(
  providers: readonly ConfiguredProvider[],
): MultiProviderIdentity {
  if (providers.length === 0) {
    throw new Error('At least one identity provider must be configured.');
  }
  const byId = new Map<string, ConfiguredProvider>();
  const byIssuer = new Map<string, ConfiguredProvider>();
  for (const p of providers) {
    if (byId.has(p.id)) throw new Error(`Identity provider id "${p.id}" is configured twice.`);
    byId.set(p.id, p);
    const issuer = p.provider.metadata().issuer;
    if (byIssuer.has(issuer)) {
      throw new Error(`Issuer ${issuer} is configured for two identity providers.`);
    }
    byIssuer.set(issuer, p);
  }
  const frozen = Object.freeze([...providers]);

  return {
    providers: frozen,
    provider: (id) => byId.get(id),
    metadataFor: (id) => byId.get(id)?.provider.metadata(),

    async authenticate(req: Request): Promise<Principal> {
      const correlationId = req.headers.get('x-correlation-id') ?? 'identity-authenticate';
      // No credential at all keeps its own, diagnostic refusal (./bearer.ts).
      const token = bearerToken(req, correlationId);
      const issuer = unverifiedIssuer(token);
      const chosen = issuer === undefined ? undefined : byIssuer.get(issuer);
      if (chosen === undefined) refuse(correlationId);
      const principal = await chosen.provider.authenticate(req);
      // Belt and braces: the provider qualified the subject with its own id.
      // A principal in any other namespace is a bug, and it is refused rather
      // than served.
      if (providerIdOfSubject(principal.subject) !== chosen.id) refuse(correlationId);
      return principal;
    },

    async resolveGroups(p: Principal): Promise<readonly string[]> {
      const id = providerIdOfSubject(p.subject);
      const owner = id === null ? undefined : byId.get(id);
      if (owner === undefined) {
        throw forgeError(
          'IDENTITY_UNRESOLVED',
          'This principal belongs to no identity provider configured in this deployment.',
          'identity-resolve-groups',
          {
            next: 'Sign in again through one of the providers this deployment offers; ask your MCPForge operator if yours is missing from overlays/<deployment>/identity.yaml.',
          },
        );
      }
      return owner.provider.resolveGroups(p);
    },
  };
}

export interface BuildIdentityOptions {
  /** The gateway's local provider. Used only when the config lists a `local` provider. */
  readonly local?: IdentityProvider;
  /** Injectable for discovery in tests; the JWKS fetch never uses it (./oidc/oidc.ts). */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Build every configured provider, then the router. OIDC providers run
 * discovery here, at startup, so an unreachable or misconfigured IdP refuses
 * startup rather than every later sign-in (./oidc/oidc.ts explains why).
 */
export async function buildMultiProviderIdentity(
  config: IdentityConfig,
  options: BuildIdentityOptions,
): Promise<MultiProviderIdentity> {
  const built: ConfiguredProvider[] = [];
  for (const entry of config.providers) {
    if (entry.kind === 'local') {
      if (options.local === undefined) {
        throw new Error('A local identity provider is configured, but none was supplied.');
      }
      built.push({ id: LOCAL_PROVIDER_ID, kind: 'local', config: entry, provider: options.local });
      continue;
    }
    const provider = await oidcIdentityProvider({
      providerId: entry.id,
      issuer: entry.issuer,
      audience: entry.audience,
      discoveryUrl: entry.discoveryUrl,
      ...(entry.groupsClaim === undefined ? {} : { groupsClaim: entry.groupsClaim }),
      ...(entry.nameClaim === undefined ? {} : { nameClaim: entry.nameClaim }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    built.push({ id: entry.id, kind: 'oidc', config: entry, provider });
  }
  return multiProviderIdentity(built);
}
