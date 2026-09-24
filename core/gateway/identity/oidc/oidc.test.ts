// MCPForge — the OIDC provider's security properties, without Docker.
// W0-D3, 02 §4.4. `core/gateway/identity/**` is an OPUS_GUARDED_PATHS file.
//
// **Why this exists alongside ../identity.contract.test.ts.** The contract suite
// proves the two providers mean the same thing by a `Principal`. It cannot prove
// the JWS-level attacks are closed, because the attacks require minting tokens
// with keys and headers a real Authorization Server will never emit — Keycloak
// will not sign you an `alg: none` token, and it will not hand you its private
// key to demonstrate that its public one is useless as an HMAC secret.
//
// So this file stands up a throwaway `node:http` server on 127.0.0.1 serving a
// discovery document and a JWKS from key material the test controls, and then
// attacks the verifier with it. No Docker, no network, deterministic — it runs
// in the default `pnpm test`, which matters, because these are exactly the
// properties that must not be allowed to regress on a machine without Docker.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { ForgeError } from '@mcpforge/shared/errors';
import { OIDC_ACCEPTED_ALGORITHMS, fetchOidcDiscovery } from './discovery.js';
import { normalizeOidcClaims, oidcIdentityProvider } from './oidc.js';
import {
  protectedResourceMetadata,
  protectedResourceMetadataPath,
  wwwAuthenticateChallenge,
} from './protected-resource.js';
import type { ProviderMetadata } from '../types.js';

const RESOURCE = 'https://mcpforge.local/mcp';
const AUDIENCE = RESOURCE;

// `lib` is ES2023 with no DOM, so `CryptoKey` is not a global name here; derive
// the key type from `jose` itself rather than adding a lib for one test file.
type GeneratedPrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

interface Signer {
  readonly kid: string;
  readonly privateKey: GeneratedPrivateKey;
  readonly publicJwk: JWK;
}

async function makeSigner(kid: string): Promise<Signer> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  return { kid, privateKey, publicJwk: { ...publicJwk, kid, alg: 'RS256', use: 'sig' } };
}

let server: Server;
let base: string;
let issuer: string;
/** Mutable, so a test can rotate the published key set. */
let published: Signer[] = [];

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

beforeAll(async () => {
  const first = await makeSigner('kid-one');
  published = [first];

  server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (path === `/.well-known/openid-configuration`) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          issuer,
          jwks_uri: `${base}/jwks`,
          authorization_endpoint: `${base}/auth`,
          token_endpoint: `${base}/token`,
          id_token_signing_alg_values_supported: ['RS256', 'HS256'],
        }),
      );
      return;
    }
    if (path === '/jwks') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: published.map((s) => s.publicJwk) }));
      return;
    }
    if (path === '/issuer-mismatch') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ issuer: 'https://somewhere.else/realm', jwks_uri: `${base}/jwks` }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${String(address.port)}`;
  issuer = base;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function discoveryUrl(): string {
  return `${base}/.well-known/openid-configuration`;
}

async function provider(overrides: { readonly jwksCooldownMs?: number } = {}) {
  return oidcIdentityProvider({
    issuer,
    audience: AUDIENCE,
    discoveryUrl: discoveryUrl(),
    jwksCooldownMs: overrides.jwksCooldownMs ?? 0,
    jwksCacheMaxAgeMs: 0,
  });
}

async function tokenFrom(
  signer: Signer,
  claims: Record<string, unknown> = {},
  envelope: { readonly iss?: string; readonly aud?: string } = {},
): Promise<string> {
  const seconds = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: 'kc:00000000-0000-4000-8000-000000000001',
    name: 'Alice Okonkwo',
    email: 'alice.okonkwo@example.invalid',
    groups: ['ap-clerks'],
    amr: ['pwd'],
    auth_time: seconds,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: signer.kid, typ: 'JWT' })
    .setIssuer(envelope.iss ?? issuer)
    .setAudience(envelope.aud ?? AUDIENCE)
    .setIssuedAt(seconds)
    .setExpirationTime(seconds + 600)
    .sign(signer.privateKey);
}

function request(token: string): Request {
  return new Request(RESOURCE, { headers: { authorization: `Bearer ${token}` } });
}

async function refusal(token: string): Promise<ForgeError> {
  const p = await provider();
  const error = await p.authenticate(request(token)).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ForgeError);
  return error as ForgeError;
}

// ---------------------------------------------------------------------------

describe('discovery validation', () => {
  it('accepts a well-formed document and reports its endpoints', async () => {
    const doc = await fetchOidcDiscovery({ issuer, discoveryUrl: discoveryUrl() });
    expect(doc.issuer).toBe(issuer);
    expect(doc.jwksUri).toBe(`${base}/jwks`);
    expect(doc.authorizationEndpoint).toBe(`${base}/auth`);
    // The document advertises HS256; the intersection with the asymmetric-only
    // allowlist drops it. This is the algorithm-confusion defence at its source.
    expect(doc.signingAlgorithms).toEqual(['RS256']);
    expect(doc.signingAlgorithms).not.toContain('HS256');
  });

  it('refuses a document whose issuer disagrees with the configured one', async () => {
    await expect(
      fetchOidcDiscovery({ issuer, discoveryUrl: `${base}/issuer-mismatch` }),
    ).rejects.toThrow(/declares issuer/);
  });

  it('refuses plaintext transport to a non-loopback host', async () => {
    await expect(
      fetchOidcDiscovery({
        issuer: 'http://idp.example.com',
        discoveryUrl: 'http://idp.example.com/.well-known/openid-configuration',
      }),
    ).rejects.toThrow(/must use https/);
  });

  it('never admits a symmetric algorithm or none into the allowlist', () => {
    for (const alg of OIDC_ACCEPTED_ALGORITHMS) {
      expect(alg.startsWith('HS')).toBe(false);
      expect(alg).not.toBe('none');
    }
  });
});

describe('token verification', () => {
  it('verifies a genuine token into a Principal', async () => {
    const p = await provider();
    const principal = await p.authenticate(request(await tokenFrom(published[0] as Signer)));
    expect(principal.subject).toBe('kc:00000000-0000-4000-8000-000000000001');
    expect(principal.displayName).toBe('Alice Okonkwo');
    expect(principal.groups).toEqual(['ap-clerks']);
    expect(principal.idp).toBe('oidc');
    expect(principal.amr).toEqual(['pwd']);
  });

  it('refuses an alg:none token', async () => {
    const seconds = Math.floor(Date.now() / 1000);
    const unsecured = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
      iss: issuer,
      aud: AUDIENCE,
      sub: 'attacker',
      name: 'Attacker',
      groups: ['forge-admins'],
      auth_time: seconds,
      exp: seconds + 600,
    })}.`;
    expect((await refusal(unsecured)).code).toBe('AUTH_REQUIRED');
  });

  it('refuses an HS256 token signed with the published public key (algorithm confusion)', async () => {
    // The classic attack: the AS's public key is public BY DESIGN, so a verifier
    // that would accept HS256 hands an attacker a valid HMAC secret.
    const secret = new TextEncoder().encode(JSON.stringify(published[0]?.publicJwk));
    const seconds = Math.floor(Date.now() / 1000);
    const forged = await new SignJWT({
      sub: 'attacker',
      name: 'Attacker',
      groups: ['forge-admins'],
      amr: ['pwd'],
      auth_time: seconds,
    })
      .setProtectedHeader({ alg: 'HS256', kid: published[0]?.kid ?? '', typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience(AUDIENCE)
      .setExpirationTime(seconds + 600)
      .sign(secret);
    expect((await refusal(forged)).code).toBe('AUTH_REQUIRED');
  });

  it('refuses a foreign issuer, a wrong audience and a tampered signature identically', async () => {
    const good = published[0] as Signer;
    const foreign = await tokenFrom(good, {}, { iss: 'https://evil.example/realm' });
    const wrongAud = await tokenFrom(good, {}, { aud: 'https://other.example/api' });
    const valid = await tokenFrom(good);
    // The FIRST signature character, not the last: a base64url signature's last
    // character carries padding bits, so several values decode to identical
    // bytes and a "tampered" token would still verify. See the identical note in
    // ../identity.contract.test.ts.
    const [h, p, s] = valid.split('.');
    const tampered = `${h ?? ''}.${p ?? ''}.${(s ?? '').startsWith('A') ? 'B' : 'A'}${(s ?? '').slice(1)}`;
    const messages = new Set<string>();
    for (const token of [foreign, wrongAud, tampered]) {
      const error = await refusal(token);
      expect(error.code).toBe('AUTH_REQUIRED');
      messages.add(error.message);
    }
    expect([...messages]).toHaveLength(1);
  });

  it('refuses an expired token', async () => {
    const good = published[0] as Signer;
    const seconds = Math.floor(Date.now() / 1000) - 7200;
    const stale = await new SignJWT({
      sub: 'kc:1',
      name: 'Alice',
      groups: [],
      amr: ['pwd'],
      auth_time: seconds,
    })
      .setProtectedHeader({ alg: 'RS256', kid: good.kid, typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience(AUDIENCE)
      .setIssuedAt(seconds)
      .setExpirationTime(seconds + 600)
      .sign(good.privateKey);
    expect((await refusal(stale)).code).toBe('AUTH_REQUIRED');
  });

  it('follows a JWKS rotation to a new kid without a restart', async () => {
    const p = await provider({ jwksCooldownMs: 0 });
    // Warm the cache on the current key.
    await p.authenticate(request(await tokenFrom(published[0] as Signer)));

    const rotated = await makeSigner('kid-two');
    published = [rotated];
    const principal = await p.authenticate(request(await tokenFrom(rotated)));
    expect(principal.subject).toBe('kc:00000000-0000-4000-8000-000000000001');

    // And the retired key stops verifying once it leaves the published set.
    const retired = await makeSigner('kid-one');
    const error = await p.authenticate(request(await tokenFrom(retired))).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForgeError);
  });
});

describe('claim normalization', () => {
  it('stamps idp rather than reading it, so a token cannot choose its namespace', () => {
    const normalized = normalizeOidcClaims(
      { sub: 's', name: 'n', idp: 'local', groups: ['g'], auth_time: 1, amr: ['pwd'] },
      { groupsClaim: 'groups', nameClaim: 'name' },
    );
    expect(normalized['idp']).toBe('oidc');
  });

  it('falls back to iat for auth_time and to no factors for amr', () => {
    const normalized = normalizeOidcClaims(
      { sub: 's', name: 'n', iat: 1700, groups: ['g'] },
      { groupsClaim: 'groups', nameClaim: 'name' },
    );
    expect(normalized['auth_time']).toBe(1700);
    // Not `['pwd']`: the gateway ran no check here, so claiming a factor would
    // put an unverified assertion into the audit trail.
    expect(normalized['amr']).toEqual([]);
  });

  it('treats an absent groups claim as no groups, which grants nothing', () => {
    const normalized = normalizeOidcClaims(
      { sub: 's', name: 'n', iat: 1 },
      { groupsClaim: 'roles', nameClaim: 'name' },
    );
    expect(normalized['groups']).toEqual([]);
  });

  it('reads groups only from the configured claim', () => {
    const normalized = normalizeOidcClaims(
      { sub: 's', name: 'n', iat: 1, groups: ['sneaky'], roles: ['real'] },
      { groupsClaim: 'roles', nameClaim: 'name' },
    );
    expect(normalized['groups']).toEqual(['real']);
  });
});

describe('RFC 9728 protected-resource metadata', () => {
  const ready: ProviderMetadata = Object.freeze({
    kind: 'oidc',
    issuer: 'https://login.example.com/realms/ltm',
    audience: RESOURCE,
    authorizationEndpoint: 'https://login.example.com/auth',
    tokenEndpoint: 'https://login.example.com/token',
    jwksUri: 'https://login.example.com/jwks',
    signingAlgorithms: ['RS256'],
    oauthDiscoveryReady: true,
  });

  it('inserts the well-known suffix before the resource path (RFC 9728 §3.1)', () => {
    expect(protectedResourceMetadataPath('https://gw.example.com/mcp')).toBe(
      'https://gw.example.com/.well-known/oauth-protected-resource/mcp',
    );
    expect(protectedResourceMetadataPath('https://gw.example.com')).toBe(
      'https://gw.example.com/.well-known/oauth-protected-resource',
    );
    expect(protectedResourceMetadataPath('https://gw.example.com/')).toBe(
      'https://gw.example.com/.well-known/oauth-protected-resource',
    );
  });

  it('publishes the authorization server and header-only bearer methods', () => {
    const result = protectedResourceMetadata(ready, {
      resource: RESOURCE,
      resourceName: 'MCPForge',
      scopesSupported: ['mcp:read'],
    });
    expect(result.publishable).toBe(true);
    if (!result.publishable) return;
    expect(result.document.authorization_servers).toEqual([ready.issuer]);
    expect(result.document.bearer_methods_supported).toEqual(['header']);
    expect(result.document.resource_name).toBe('MCPForge');
    expect(result.path).toBe('https://mcpforge.local/.well-known/oauth-protected-resource/mcp');
  });

  it('refuses to publish when no Authorization Server stands behind the provider', () => {
    const local: ProviderMetadata = { ...ready, kind: 'local', oauthDiscoveryReady: false };
    const result = protectedResourceMetadata(local, { resource: RESOURCE });
    expect(result.publishable).toBe(false);
    if (result.publishable) return;
    expect(result.reason).toMatch(/no OAuth 2\.1 Authorization Server/);
  });

  it('refuses to publish a resource identifier that is not the verified audience', () => {
    const result = protectedResourceMetadata(ready, { resource: 'https://gw.example.com/other' });
    expect(result.publishable).toBe(false);
    if (result.publishable) return;
    expect(result.reason).toMatch(/must equal the audience/);
  });

  it('points a 401 at the metadata document without leaking why the token failed', () => {
    const challenge = wwwAuthenticateChallenge(RESOURCE);
    expect(challenge).toContain(
      'resource_metadata="https://mcpforge.local/.well-known/oauth-protected-resource/mcp"',
    );
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).not.toMatch(/expired|signature|audience|issuer/i);
  });
});
