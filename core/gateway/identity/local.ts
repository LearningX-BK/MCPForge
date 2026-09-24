// MCPForge — the Wave 0 local `IdentityProvider`. W0-D1, 02 §4.4.
//
// **What this file is, and what it deliberately is not.** W0-D1 owns the seam
// and the token mechanics. `LocalUserStore` — Argon2id hashes, optional TOTP,
// admin CRUD, the users table in the SQLite runtime store — is **W0-D2**, and
// none of it is here or stubbed here. The boundary between the two tasks is the
// `LocalPrincipalSource` interface below: W0-D1 says what the provider needs
// from a user store, W0-D2 implements it over `core/gateway/store/**`, and no
// other part of this file changes when it does.
//
// Note that 02 §4.4 says "Users in Postgres" for `LocalUserStore`. That is
// SUPERSEDED by 02 §10's Wave 0 datastore correction: the Wave 0 store is
// SQLite, reached through the repository interface. Nothing in this file
// assumes an engine either way, which is the point of the seam.

import { forgeError } from '@mcpforge/shared/errors';
import { bearerToken } from './bearer.js';
import { DEFAULT_LOCAL_AUDIENCE, DEFAULT_LOCAL_ISSUER } from './config.js';
import type { LocalTokenIssuer, IssuedToken } from './jwt.js';
import type { IdentityProvider, Principal, ProviderMetadata } from './types.js';

/**
 * One local account, as this provider needs it. The credential material —
 * password hash, TOTP secret, lockout state — is **not** on this record and
 * must never be: it belongs to W0-D2's store and never leaves it. This
 * interface carries only what a `Principal` is made of.
 */
export interface LocalPrincipalRecord {
  readonly subject: string;
  readonly displayName: string;
  readonly email?: string;
  readonly groups: readonly string[];
}

/**
 * **The W0-D2 contract.** `LocalUserStore` implements exactly this and nothing
 * more is required of it by the identity seam.
 *
 * `findBySubject` returns `undefined` for a subject that is unknown, disabled,
 * locked or retired — the provider treats all four identically and refuses with
 * `IDENTITY_UNRESOLVED`. It does not return a "default" record, and there is no
 * variant of this interface that does (CLAUDE.md non-negotiable 1).
 */
export interface LocalPrincipalSource {
  findBySubject(subject: string): Promise<LocalPrincipalRecord | undefined>;
}

/**
 * A source backed by a fixed set of records. Exists so W0-D1 can prove the seam
 * and the token round-trip without inventing W0-D2's persistence. It is a test
 * and bootstrap fixture, not a user store: it has no credential verification,
 * no mutation and no persistence, so nothing can mistake it for one.
 */
export function staticLocalPrincipalSource(
  records: readonly LocalPrincipalRecord[],
): LocalPrincipalSource {
  const bySubject = new Map(records.map((record) => [record.subject, record]));
  return {
    findBySubject: (subject) => Promise.resolve(bySubject.get(subject)),
  };
}

export interface LocalIdentityProviderOptions {
  readonly issuer: LocalTokenIssuer;
  readonly source: LocalPrincipalSource;
  readonly issuerUrl?: string;
  readonly audience?: string;
  /** Injectable clock for `auth_time`, so tests do not depend on wall time. */
  readonly now?: () => Date;
}

/**
 * The Wave 0 provider. `authenticate` and `resolveGroups` are the two the
 * `IdentityProvider` contract demands; `issueToken` is the local issuer's extra
 * surface — the "log in" half that an OIDC provider does not have, because
 * there the Authorization Server mints the token instead.
 */
export interface LocalIdentityProvider extends IdentityProvider {
  /**
   * Mint a session token for an already-authenticated subject.
   *
   * **`amr` is supplied by the caller that actually performed the
   * authentication** — W0-D2's password/TOTP check — because only it knows
   * whether this was `['pwd']` or `['pwd','otp']`, and a token that asserted a
   * factor nobody verified would be a lie recorded in the audit trail. W0-D1
   * has no credential check of its own and therefore invents no `amr`.
   */
  issueToken(subject: string, amr: readonly string[], correlationId: string): Promise<IssuedToken>;
}

export function localIdentityProvider(
  options: LocalIdentityProviderOptions,
): LocalIdentityProvider {
  const issuerUrl = options.issuerUrl ?? DEFAULT_LOCAL_ISSUER;
  const audience = options.audience ?? DEFAULT_LOCAL_AUDIENCE;
  const now = options.now ?? (() => new Date());

  async function requireAccount(
    subject: string,
    correlationId: string,
  ): Promise<LocalPrincipalRecord> {
    const record = await options.source.findBySubject(subject);
    if (record === undefined) {
      throw forgeError(
        'IDENTITY_UNRESOLVED',
        `No local account resolves subject "${subject}" in this deployment.`,
        correlationId,
        {
          condition:
            'The credential verified but names a subject this deployment does not know, or one that is disabled or retired. There is no fallback.',
          next: 'Ask your MCPForge operator to create or re-enable this local account (forge identity), then authenticate again; this session cannot proceed without one.',
        },
      );
    }
    return record;
  }

  return {
    /**
     * Verify the bearer token and reconstruct the `Principal` **from its claims
     * alone**. That is the design move 02 §4.4 names: no lookup happens here,
     * so a Wave 1 OIDC token verified against LTM AD's JWKS yields a
     * `Principal` by the identical path and nothing downstream notices the
     * swap.
     *
     * The cost, stated rather than hidden: a disabled account stays
     * authenticable until its token expires. That window is the token TTL —
     * fifteen minutes by default — and it is why the tokens are short-lived.
     * Immediate revocation is a kill switch and a consumer suspension (02
     * §11), not a re-read on every call.
     */
    async authenticate(req: Request): Promise<Principal> {
      // A correlation id per request would come from the transport (W0-E1);
      // until that exists the header is honoured when present so a refusal is
      // still traceable, and there is no invented substitute for identity —
      // only for the trace id, which carries no authority.
      const correlationId = req.headers.get('x-correlation-id') ?? 'identity-authenticate';
      const token = bearerToken(req, correlationId);
      return options.issuer.verify(token, correlationId);
    },

    /**
     * Groups are resolved from the source, not read off the `Principal`. The
     * token's `groups` claim is what the principal held when the token was
     * minted; this is what they hold now, and the git-held group→role mapping
     * (W0-D4) consumes this one.
     */
    async resolveGroups(p: Principal): Promise<readonly string[]> {
      const record = await requireAccount(p.subject, 'identity-resolve-groups');
      return Object.freeze([...record.groups]);
    },

    metadata(): ProviderMetadata {
      return {
        kind: 'local',
        issuer: issuerUrl,
        audience,
        // Null, not a placeholder URL. There is no Authorization Server at
        // Wave 0 and the MCP protected-resource document must not claim one.
        authorizationEndpoint: null,
        tokenEndpoint: null,
        // Correct rather than missing: the local issuer signs with a symmetric
        // key, and a symmetric key is never published as a JWKS.
        jwksUri: null,
        signingAlgorithms: ['HS256'],
        oauthDiscoveryReady: false,
      };
    },

    async issueToken(
      subject: string,
      amr: readonly string[],
      correlationId: string,
    ): Promise<IssuedToken> {
      if (amr.length === 0) {
        throw new Error(
          'issueToken needs the amr of the check that actually ran; an empty amr would assert an unverified authentication.',
        );
      }
      const record = await requireAccount(subject, correlationId);
      const principal: Principal = {
        subject: record.subject,
        displayName: record.displayName,
        ...(record.email === undefined ? {} : { email: record.email }),
        groups: record.groups,
        idp: 'local',
        authTime: now(),
        amr,
      };
      return options.issuer.issue(principal);
    },
  };
}
