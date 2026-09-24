// MCPForge — OAuth 2.0 Protected Resource Metadata (RFC 9728). W0-D3, 02 §4.4.
//
// 02 §4.4: "MCP clients use the OAuth 2.1 flow the MCP spec defines, with the
// gateway as Resource Server and LTM AD as Authorization Server; **the gateway
// publishes the protected-resource metadata the spec requires.**" This file is
// that document, and only that document.
//
// **Scope, stated plainly.** This is a pure builder: `ProviderMetadata` in, an
// RFC 9728 JSON object plus the path it belongs at out. It does not serve HTTP,
// because there is no HTTP transport in this repository yet — the MCP endpoint
// is `W0-E1` (`core/gateway/transport/**`), which is a separate, unstarted task.
// Building a web server here to have somewhere to mount one JSON document would
// be W0-E1 done badly and in the wrong place. When W0-E1 lands it mounts this:
//
//   GET <protectedResourceMetadataPath(resource)>
//     -> 200, application/json, protectedResourceMetadata(...).document
//   any 401 from the identity layer
//     -> WWW-Authenticate: wwwAuthenticateChallenge(resource, ...)
//
// **The refusal case is the interesting one.** ../types.ts is explicit that the
// local provider reports `authorizationEndpoint: null` and
// `oauthDiscoveryReady: false` "precisely so nothing downstream can publish a
// protected-resource document that points at an endpoint which does not exist."
// So this builder is a TOTAL function returning a discriminated result, not a
// function that throws or that quietly emits a document with an empty
// `authorization_servers`. RFC 9728 §2 makes `authorization_servers` optional,
// which means an honest-looking but useless document is easy to emit by
// accident; a client that received one would conclude the resource needs no
// authorization server and would never find one. `publishable: false` with a
// reason is the only correct answer for a Wave 0 local deployment, and W0-E1
// should return 404 for that path rather than a document.

import type { ProviderMetadata } from '../types.js';

/** RFC 9728 §3. The well-known URI suffix, registered as such. */
export const PROTECTED_RESOURCE_METADATA_SUFFIX = '/.well-known/oauth-protected-resource';

/**
 * The RFC 9728 §2 document, as the fields MCPForge populates.
 *
 * Snake-case because these are wire field names and this object is serialized
 * verbatim; renaming them to camelCase and mapping at the edge would give two
 * places for a typo to hide.
 */
export interface ProtectedResourceMetadata {
  /** REQUIRED. The resource identifier — the `aud` clients must request. */
  readonly resource: string;
  /** The issuer identifiers of the Authorization Servers this resource trusts. */
  readonly authorization_servers: readonly string[];
  /** RFC 9728 §2. `header` only — see ../bearer.ts, which reads nothing else. */
  readonly bearer_methods_supported: readonly string[];
  readonly resource_name?: string;
  readonly scopes_supported?: readonly string[];
  readonly resource_documentation?: string;
}

export type ProtectedResourceMetadataResult =
  | {
      readonly publishable: true;
      /** Where W0-E1 must serve `document`. */
      readonly path: string;
      readonly document: ProtectedResourceMetadata;
    }
  | {
      readonly publishable: false;
      /** Why not, in words an operator can act on. */
      readonly reason: string;
    };

export interface ProtectedResourceMetadataOptions {
  /**
   * The resource identifier: the gateway's own MCP endpoint URL, and the value
   * clients put in the `resource` parameter (RFC 8707). It must equal the
   * `audience` the provider verifies, or a client that obeys this document will
   * receive tokens the gateway then refuses for wrong audience — the failure
   * mode this whole document exists to prevent. Checked below.
   */
  readonly resource: string;
  readonly resourceName?: string;
  readonly scopesSupported?: readonly string[];
  readonly resourceDocumentation?: string;
}

/**
 * RFC 9728 §3.1 — the well-known URI, with path insertion.
 *
 * For a resource with no path component the URI is host + suffix. For a resource
 * WITH a path, the suffix is inserted *before* that path
 * (`https://h/.well-known/oauth-protected-resource/mcp`), which is the part
 * implementations most often get wrong by appending instead. Query and fragment
 * are dropped: they are not part of a resource identifier.
 */
export function protectedResourceMetadataPath(resource: string): string {
  const url = new URL(resource);
  const path = url.pathname.replace(/\/+$/, '');
  const suffix = path === '' ? PROTECTED_RESOURCE_METADATA_SUFFIX : `${PROTECTED_RESOURCE_METADATA_SUFFIX}${path}`;
  return new URL(suffix, `${url.origin}/`).toString();
}

/**
 * Build the document, or explain why this deployment has none to publish.
 *
 * `providerMetadata` is the `IdentityProvider.metadata()` of whichever provider
 * the overlay selected — the seam again: this function never learns which, it
 * only reads the honest fields ../types.ts requires each provider to fill.
 */
export function protectedResourceMetadata(
  providerMetadata: ProviderMetadata,
  options: ProtectedResourceMetadataOptions,
): ProtectedResourceMetadataResult {
  if (!providerMetadata.oauthDiscoveryReady) {
    return {
      publishable: false,
      reason: `The "${providerMetadata.kind}" identity provider has no OAuth 2.1 Authorization Server behind it, so this deployment has no protected-resource metadata to publish. The Wave 0 local issuer mints its own tokens; set identity.provider: oidc in the overlay to publish RFC 9728 metadata.`,
    };
  }
  if (providerMetadata.issuer.length === 0) {
    return {
      publishable: false,
      reason:
        'The identity provider reports OAuth discovery is ready but names no issuer; refusing to publish a document with an empty authorization_servers.',
    };
  }

  let resourceUrl: URL;
  try {
    resourceUrl = new URL(options.resource);
  } catch {
    return {
      publishable: false,
      reason: `The resource identifier must be an absolute URL; got ${JSON.stringify(options.resource)}.`,
    };
  }
  if (resourceUrl.hash !== '' || resourceUrl.search !== '') {
    return {
      publishable: false,
      reason:
        'A resource identifier may not carry a query or a fragment (RFC 8707 §2); clients would echo a value the gateway never verifies.',
    };
  }
  // The check this document exists to make impossible to get wrong: a published
  // `resource` that is not the audience the verifier enforces sends every
  // obedient client into an audience refusal it cannot diagnose.
  if (options.resource !== providerMetadata.audience) {
    return {
      publishable: false,
      reason: `The published resource identifier (${options.resource}) must equal the audience this gateway verifies (${providerMetadata.audience}); publishing a different one would send every conforming client into an audience refusal.`,
    };
  }

  return {
    publishable: true,
    path: protectedResourceMetadataPath(options.resource),
    document: {
      resource: options.resource,
      authorization_servers: Object.freeze([providerMetadata.issuer]),
      // ../bearer.ts reads the Authorization header and nothing else — no query
      // parameter, no form body. Advertising the other two would be a lie a
      // client would act on.
      bearer_methods_supported: Object.freeze(['header']),
      ...(options.resourceName === undefined ? {} : { resource_name: options.resourceName }),
      ...(options.scopesSupported === undefined
        ? {}
        : { scopes_supported: Object.freeze([...options.scopesSupported]) }),
      ...(options.resourceDocumentation === undefined
        ? {}
        : { resource_documentation: options.resourceDocumentation }),
    },
  };
}

/**
 * The `WWW-Authenticate` value for a 401, carrying `resource_metadata` (RFC 9728
 * §5.1). This is the half of the handshake that makes the document discoverable:
 * a client that gets a 401 learns from this header where to look, rather than
 * having to guess the well-known path.
 *
 * `error` / `error_description` are RFC 6750 §3. `error_description` must stay
 * generic for the same reason ../jwt.ts collapses every failure into one
 * `AUTH_REQUIRED`: telling a caller whether the signature or the expiry failed
 * tells an attacker which knob to turn. It is a fixed string here, not a
 * parameter, so no call site can leak detail into it.
 */
export function wwwAuthenticateChallenge(resource: string): string {
  const metadataUrl = protectedResourceMetadataPath(resource);
  // RFC 9110 §11.6.1: scheme, one space, then COMMA-separated auth-params.
  const params = [
    'error="invalid_token"',
    'error_description="The presented bearer token did not verify."',
    `resource_metadata="${metadataUrl}"`,
  ];
  return `Bearer ${params.join(', ')}`;
}
