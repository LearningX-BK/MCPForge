// MCPForge — THE identity contract suite. W0-D3, 02 §4.4 item 2.
//
//   "One identity contract-test suite, run against both providers in Wave 0 CI
//    — the OIDC provider tested against a disposable Keycloak (or an Entra dev
//    tenant) in Testcontainers. The AD swap is therefore proven before it is
//    needed, at small cost, instead of being discovered at the Wave 1 boundary."
//
// **One file, one set of assertions, two legs.** Everything below `describe.each`
// is written once and executed against `LocalUserStore` and against a real
// Keycloak. That is the entire point, and it is why this is table-driven rather
// than two files that started identical and will not stay that way: the moment
// the two providers have their own suites, a divergence in what a `Principal`
// means stops being a test failure and becomes a diff nobody reads.
//
// **What a leg must provide is deliberately narrow.** A leg supplies a
// provider, an expected identity, and six tokens (valid, foreign-issuer,
// wrong-audience, tampered, missing-claims, plus a clock-skewed provider for
// expiry). It supplies NO assertions. If a provider ever needs a special case in
// here to pass, that special case is the news — it means the seam leaks, and the
// right response is to fix the provider, not to widen the leg interface.
//
// **The expiry case, and why it is a clock and not a sleep.** Both legs express
// "expired" as `providerAtSkew(+1 hour)` — the same token, verified by a
// provider whose clock has moved past `exp`. The alternative (mint a
// one-second-lifetime token and sleep) is non-deterministic on a loaded CI box
// and tests the container's configuration rather than our verifier. Both
// providers already take an injectable `now` for exactly this reason.
//
// **Docker.** The Keycloak leg runs only under `pnpm test:keycloak`, which
// starts the container and sets `MCPFORGE_TEST_KEYCLOAK_URL` (see
// ./oidc/test-keycloak-global-setup.ts). Under the default `pnpm test` it
// reports itself skipped rather than silently vanishing, so a reader of the
// output can tell "not run here" from "passed".

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import { ForgeError } from '@mcpforge/shared/errors';
import { openRuntimeStore } from '../store/server.js';
import type { RuntimeStore } from '../store/server.js';
import { generateLocalSigningKey, localTokenIssuer } from './jwt.js';
import type { LocalSigningKey } from './jwt.js';
import { localIdentityProvider } from './local.js';
import { localUserStore } from './local/index.js';
import { fetchOidcDiscovery } from './oidc/discovery.js';
import { oidcIdentityProviderFrom } from './oidc/oidc.js';
import { protectedResourceMetadata } from './oidc/protected-resource.js';
import type { IdentityProvider, IdentityProviderKind } from './types.js';
import {
  AGENT_CLIENT_ID,
  ALICE as KC_ALICE,
  FOREIGN_REALM,
  FOREIGN_USER,
  NAMELESS,
  OTHER_AUDIENCE_CLIENT_ID,
  REALM,
  passwordGrant,
} from './oidc/keycloak.testkit.js';

// Argon2id in the local leg's user creation is deliberately expensive.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const SKEW_PAST_EXPIRY_SECONDS = 3600;

// ---------------------------------------------------------------------------
// The leg interface. Providers differ here and nowhere below.
// ---------------------------------------------------------------------------

interface ExpectedIdentity {
  readonly displayName: string;
  readonly email?: string;
  readonly groups: readonly string[];
}

interface IdentityHarness {
  readonly kind: IdentityProviderKind;
  readonly provider: IdentityProvider;
  /** The same provider, its clock advanced. Used for the expiry case only. */
  providerAtSkew(seconds: number): IdentityProvider;
  readonly expected: ExpectedIdentity;
  /** The resource identifier this deployment publishes, if it publishes one. */
  readonly resource: string;
  validToken(): Promise<string>;
  foreignIssuerToken(): Promise<string>;
  wrongAudienceToken(): Promise<string>;
  tamperedToken(): Promise<string>;
  missingClaimsToken(): Promise<string>;
  teardown(): Promise<void>;
}

interface IdentityLeg {
  readonly name: string;
  readonly enabled: boolean;
  setup(): Promise<IdentityHarness>;
}

/**
 * Flip one character of the JWS signature. Same shape, wrong bytes.
 *
 * **The FIRST character, not the last, and that is not arbitrary.** A base64url
 * signature's final character often carries only two or four significant bits —
 * a 32-byte HMAC is 43 characters, which is 258 bits of alphabet for 256 bits of
 * signature — so several distinct final characters decode to identical bytes.
 * An earlier version of this helper mutated the last character and the
 * "tampered" token verified perfectly, which is a test that would have passed
 * for years while asserting nothing. The first character is fully significant in
 * every length.
 */
function tamper(token: string): string {
  const [header, payload, signature] = token.split('.');
  if (header === undefined || payload === undefined || signature === undefined || signature.length === 0) {
    throw new Error('Expected a three-part compact JWS to tamper with.');
  }
  const first = signature.slice(0, 1);
  return `${header}.${payload}.${first === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
}

function request(token: string | undefined): Request {
  return new Request('https://mcpforge.local/mcp', {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

// ---------------------------------------------------------------------------
// Leg 1 — LocalUserStore (W0-D1 + W0-D2), on a real SQLite runtime store.
// ---------------------------------------------------------------------------

const LOCAL_ISSUER = 'https://mcpforge.local/identity';
const LOCAL_AUDIENCE = 'mcpforge-gateway';
const LOCAL_PASSWORD = 'correct-horse-battery-staple';
const LOCAL_ALICE = {
  username: 'alice.okonkwo',
  displayName: 'Alice Okonkwo',
  email: 'alice.okonkwo@example.invalid',
  groups: ['ap-clerks', 'jde-users'],
} as const;

const localLeg: IdentityLeg = {
  name: 'LocalUserStore',
  enabled: true,
  async setup(): Promise<IdentityHarness> {
    const dir = mkdtempSync(join(tmpdir(), 'mcpforge-identity-contract-'));
    let store: RuntimeStore | undefined;
    store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'runtime.db') });
    const users = localUserStore({ store });
    const key: LocalSigningKey = generateLocalSigningKey('contract-kid');

    await users.createUser({
      username: LOCAL_ALICE.username,
      displayName: LOCAL_ALICE.displayName,
      email: LOCAL_ALICE.email,
      password: LOCAL_PASSWORD,
      groups: [...LOCAL_ALICE.groups],
    });

    function providerWith(options: {
      readonly now: () => Date;
      readonly issuer?: string;
      readonly audience?: string;
    }): ReturnType<typeof localIdentityProvider> {
      const tokens = localTokenIssuer({
        issuer: options.issuer ?? LOCAL_ISSUER,
        audience: options.audience ?? LOCAL_AUDIENCE,
        signingKey: key,
        now: options.now,
      });
      return localIdentityProvider({
        issuer: tokens,
        source: users.principalSource(),
        issuerUrl: options.issuer ?? LOCAL_ISSUER,
        audience: options.audience ?? LOCAL_AUDIENCE,
        now: options.now,
      });
    }

    const clock = () => new Date();
    const provider = providerWith({ now: clock });

    async function signIn(): Promise<string> {
      const auth = await users.authenticate(
        { username: LOCAL_ALICE.username, password: LOCAL_PASSWORD },
        'identity-contract',
      );
      const issued = await provider.issueToken(auth.subject, auth.amr, 'identity-contract');
      return issued.token;
    }

    /** A token signed with the RIGHT key but the wrong envelope claim. */
    async function forgedEnvelope(overrides: {
      readonly iss?: string;
      readonly aud?: string;
      readonly omitName?: boolean;
    }): Promise<string> {
      const seconds = Math.floor(Date.now() / 1000);
      const claims: Record<string, unknown> = {
        iss: overrides.iss ?? LOCAL_ISSUER,
        aud: overrides.aud ?? LOCAL_AUDIENCE,
        sub: 'local:contract-forged',
        iat: seconds,
        nbf: seconds,
        exp: seconds + 600,
        jti: 'contract-forged',
        groups: [],
        auth_time: seconds,
        amr: ['pwd'],
        idp: 'local',
      };
      if (overrides.omitName !== true) {
        claims['name'] = 'Forged Person';
      }
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256', kid: key.keyId, typ: 'JWT' })
        .sign(key.key);
    }

    return {
      kind: 'local',
      provider,
      providerAtSkew: (seconds) =>
        providerWith({ now: () => new Date(Date.now() + seconds * 1000) }),
      expected: {
        displayName: LOCAL_ALICE.displayName,
        email: LOCAL_ALICE.email,
        groups: LOCAL_ALICE.groups,
      },
      resource: LOCAL_AUDIENCE,
      validToken: signIn,
      // Signed by the key this verifier holds, so what is being tested is the
      // `iss` check itself and not, accidentally, the signature check.
      foreignIssuerToken: () => forgedEnvelope({ iss: 'https://evil.example/identity' }),
      wrongAudienceToken: () => forgedEnvelope({ aud: 'some-other-resource' }),
      tamperedToken: async () => tamper(await signIn()),
      missingClaimsToken: () => forgedEnvelope({ omitName: true }),
      async teardown() {
        await store?.close();
        store = undefined;
        rmSync(dir, { recursive: true, force: true });
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Leg 2 — OidcProvider against a disposable Keycloak.
// ---------------------------------------------------------------------------

const keycloakUrl = process.env['MCPFORGE_TEST_KEYCLOAK_URL'];
const keycloakResource = process.env['MCPFORGE_TEST_KEYCLOAK_RESOURCE'] ?? 'https://mcpforge.local/mcp';

const oidcLeg: IdentityLeg = {
  name: 'OidcProvider (Keycloak)',
  enabled: keycloakUrl !== undefined && keycloakUrl.length > 0,
  async setup(): Promise<IdentityHarness> {
    const baseUrl = keycloakUrl as string;
    const issuer = `${baseUrl}/realms/${REALM}`;
    const discovery = await fetchOidcDiscovery({
      issuer,
      discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    });

    function providerWith(now: () => Date): IdentityProvider {
      return oidcIdentityProviderFrom(discovery, {
        issuer,
        audience: keycloakResource,
        discoveryUrl: `${issuer}/.well-known/openid-configuration`,
        now,
      });
    }

    const provider = providerWith(() => new Date());
    const alice = () =>
      passwordGrant({
        baseUrl,
        realm: REALM,
        clientId: AGENT_CLIENT_ID,
        username: KC_ALICE.username,
        password: KC_ALICE.password,
      });

    return {
      kind: 'oidc',
      provider,
      providerAtSkew: (seconds) => providerWith(() => new Date(Date.now() + seconds * 1000)),
      expected: {
        displayName: `${KC_ALICE.firstName} ${KC_ALICE.lastName}`,
        email: KC_ALICE.email,
        groups: KC_ALICE.groups,
      },
      resource: keycloakResource,
      validToken: alice,
      // A genuine, correctly signed token from a genuinely different realm —
      // the replay attack that actually happens, not a garbage string.
      foreignIssuerToken: () =>
        passwordGrant({
          baseUrl,
          realm: FOREIGN_REALM,
          clientId: AGENT_CLIENT_ID,
          username: FOREIGN_USER.username,
          password: FOREIGN_USER.password,
        }),
      // Same realm, same signing key, no audience mapper: valid, and simply not
      // addressed to this gateway.
      wrongAudienceToken: () =>
        passwordGrant({
          baseUrl,
          realm: REALM,
          clientId: OTHER_AUDIENCE_CLIENT_ID,
          username: KC_ALICE.username,
          password: KC_ALICE.password,
        }),
      tamperedToken: async () => tamper(await alice()),
      // A user with no first or last name, so Keycloak emits no `name` claim.
      missingClaimsToken: () =>
        passwordGrant({
          baseUrl,
          realm: REALM,
          clientId: AGENT_CLIENT_ID,
          username: NAMELESS.username,
          password: NAMELESS.password,
        }),
      teardown: () => Promise.resolve(),
    };
  },
};

// ---------------------------------------------------------------------------
// The contract. Written once. Run against every enabled leg.
// ---------------------------------------------------------------------------

const legs = [localLeg, oidcLeg];

for (const leg of legs) {
  const suite = leg.enabled ? describe : describe.skip;

  suite(`identity contract — ${leg.name}`, () => {
    let h: IdentityHarness;

    beforeAll(async () => {
      h = await leg.setup();
    });

    afterAll(async () => {
      await h?.teardown();
    });

    // -- the happy path -----------------------------------------------------

    it('turns a valid bearer token into a Principal', async () => {
      const principal = await h.provider.authenticate(request(await h.validToken()));
      expect(principal.subject).toBeTypeOf('string');
      expect(principal.subject.length).toBeGreaterThan(0);
      expect(principal.displayName).toBe(h.expected.displayName);
      expect(principal.email).toBe(h.expected.email);
      expect([...principal.groups].sort()).toEqual([...h.expected.groups].sort());
      expect(principal.authTime).toBeInstanceOf(Date);
      expect(Number.isNaN(principal.authTime.getTime())).toBe(false);
      expect(Array.isArray(principal.amr)).toBe(true);
    });

    it('reports the idp the provider actually is, never the one the token claims', async () => {
      // The local provider COMPARES the `idp` claim; the OIDC provider STAMPS
      // it and ignores whatever the payload said. Either way a caller cannot
      // choose their own idp, which is what matters: `idp` will namespace the
      // group→role mapping (W0-D4).
      const principal = await h.provider.authenticate(request(await h.validToken()));
      expect(principal.idp).toBe(h.kind);
    });

    it('yields a stable subject across authentications', async () => {
      const first = await h.provider.authenticate(request(await h.validToken()));
      const second = await h.provider.authenticate(request(await h.validToken()));
      expect(second.subject).toBe(first.subject);
      // Opaque: never the username, never the email (02 §4.4).
      expect(first.subject).not.toBe(h.expected.email);
      expect(first.subject).not.toBe(h.expected.displayName);
    });

    it('resolves groups for a Principal', async () => {
      const principal = await h.provider.authenticate(request(await h.validToken()));
      const groups = await h.provider.resolveGroups(principal);
      expect([...groups].sort()).toEqual([...h.expected.groups].sort());
    });

    // -- the refusals -------------------------------------------------------

    interface RefusalCase {
      readonly why: string;
      readonly token: (harness: IdentityHarness) => Promise<string | undefined>;
      readonly provider?: (harness: IdentityHarness) => IdentityProvider;
      /**
       * Whether this refusal must be message-identical to the others.
       *
       * `true` for every failure an UNAUTHENTICATED attacker can provoke by
       * mutating a token: signature, issuer, audience, expiry. Distinguishing
       * those tells an attacker which knob to turn, which is why ../jwt.ts and
       * ./oidc/oidc.ts both collapse them into one message.
       *
       * `false` for the two that are not probes. "No credential at all"
       * discriminates nothing about a token and a client genuinely needs to be
       * told. "Missing a required claim" is only reachable by someone who
       * already holds a token the Authorization Server actually signed — an
       * attacker who could produce one would not need to probe — and its message
       * is deliberately diagnostic, because the real cause is an IdP whose claim
       * mappers are misconfigured and an operator has to be able to see that.
       */
      readonly indistinguishable: boolean;
    }

    const refusals: readonly RefusalCase[] = [
      {
        why: 'no credential at all',
        token: () => Promise.resolve(undefined),
        indistinguishable: false,
      },
      {
        why: 'a token whose signature was tampered with',
        token: (x) => x.tamperedToken(),
        indistinguishable: true,
      },
      {
        why: 'a token from a foreign issuer',
        token: (x) => x.foreignIssuerToken(),
        indistinguishable: true,
      },
      {
        why: 'a token for a different audience',
        token: (x) => x.wrongAudienceToken(),
        indistinguishable: true,
      },
      {
        why: 'a token missing a required claim',
        token: (x) => x.missingClaimsToken(),
        indistinguishable: false,
      },
      {
        why: 'an expired token',
        token: (x) => x.validToken(),
        provider: (x) => x.providerAtSkew(SKEW_PAST_EXPIRY_SECONDS),
        indistinguishable: true,
      },
    ];

    for (const refusal of refusals) {
      it(`refuses ${refusal.why} with AUTH_REQUIRED`, async () => {
        const provider = refusal.provider === undefined ? h.provider : refusal.provider(h);
        const token = await refusal.token(h);
        await expect(provider.authenticate(request(token))).rejects.toThrow(ForgeError);
        const error = await provider.authenticate(request(token)).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ForgeError);
        expect((error as ForgeError).code).toBe('AUTH_REQUIRED');
        // Non-negotiable 5: never a dead end.
        expect((error as ForgeError).next.trim().length).toBeGreaterThan(0);
      });
    }

    it('gives every probeable token refusal the same message, so nothing tells an attacker which knob to turn', async () => {
      const messages = new Set<string>();
      for (const refusal of refusals.filter((r) => r.indistinguishable)) {
        const provider = refusal.provider === undefined ? h.provider : refusal.provider(h);
        const token = await refusal.token(h);
        const error = await provider.authenticate(request(token)).catch((e: unknown) => e);
        messages.add((error as ForgeError).message);
      }
      // Signature, issuer, audience and expiry: four different causes, one
      // sentence.
      expect([...messages]).toHaveLength(1);
    });

    it('keeps the malformed-claim-set refusal diagnostic, because only a real signer can reach it', async () => {
      const caught = async (token: string): Promise<ForgeError> => {
        const outcome: unknown = await h.provider
          .authenticate(request(token))
          .catch((e: unknown) => e);
        expect(outcome).toBeInstanceOf(ForgeError);
        return outcome as ForgeError;
      };
      const probeable = await caught(await h.tamperedToken());
      const malformed = await caught(await h.missingClaimsToken());
      expect(malformed.code).toBe('AUTH_REQUIRED');
      // Same code — a caller's next step is identical — but a different
      // sentence, so an operator can see that their IdP is not emitting the
      // claim rather than concluding the signature is wrong. Reaching this
      // branch requires a token the Authorization Server genuinely signed, so
      // it is not an oracle an attacker can query.
      expect(malformed.message).not.toBe(probeable.message);
      expect(malformed.next.trim().length).toBeGreaterThan(0);
    });

    it('never returns a fallback principal', async () => {
      // Non-negotiable 1, asserted as behaviour rather than as a code review
      // note: the only way out of `authenticate` on a bad credential is a throw.
      await expect(h.provider.authenticate(request(undefined))).rejects.toBeInstanceOf(ForgeError);
      await expect(
        h.provider.authenticate(request(await h.tamperedToken())),
      ).rejects.toBeInstanceOf(ForgeError);
    });

    // -- metadata, and the RFC 9728 document ---------------------------------

    it('reports honest provider metadata', () => {
      const m = h.provider.metadata();
      expect(m.kind).toBe(h.kind);
      expect(m.issuer.length).toBeGreaterThan(0);
      expect(m.audience.length).toBeGreaterThan(0);
      expect(m.signingAlgorithms.length).toBeGreaterThan(0);
      expect(m.signingAlgorithms).not.toContain('none');
      if (m.oauthDiscoveryReady) {
        // A provider that claims an Authorization Server must be able to name
        // its endpoints; otherwise the protected-resource document it licenses
        // would point at nothing.
        expect(m.jwksUri).not.toBeNull();
        expect(m.authorizationEndpoint).not.toBeNull();
        expect(m.tokenEndpoint).not.toBeNull();
      } else {
        // ../types.ts: null rather than a placeholder, precisely so nothing
        // downstream can publish a document naming an endpoint that does not
        // exist.
        expect(m.jwksUri).toBeNull();
        expect(m.authorizationEndpoint).toBeNull();
        expect(m.tokenEndpoint).toBeNull();
      }
    });

    it('publishes RFC 9728 protected-resource metadata if and only if a real Authorization Server stands behind it', () => {
      const m = h.provider.metadata();
      const result = protectedResourceMetadata(m, {
        resource: h.resource,
        resourceName: 'MCPForge',
      });
      expect(result.publishable).toBe(m.oauthDiscoveryReady);
      if (result.publishable) {
        expect(result.document.resource).toBe(m.audience);
        expect(result.document.authorization_servers).toEqual([m.issuer]);
        expect(result.document.bearer_methods_supported).toEqual(['header']);
        expect(result.path).toContain('/.well-known/oauth-protected-resource');
      } else {
        expect(result.reason.length).toBeGreaterThan(0);
      }
    });
  });
}
