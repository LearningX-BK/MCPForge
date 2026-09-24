// MCPForge — W0-D1's done criterion, clause by clause, minus the store
// integration (that is ./subject-only.test.ts).
//
// Clauses covered here:
//  1. "nothing downstream of the interface consumes anything but `Principal`"
//  2. "even the Wave 0 local store issues short-lived signed JWTs with
//     `sub`/`groups`/`iat`/`exp`"
//  3. "so the Wave 1 issuer swap changes nothing downstream"

import { describe, expect, it } from 'vitest';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { ForgeError } from '@mcpforge/shared/errors';
import { epochSeconds, principalFromClaims, principalToClaims } from './claims.js';
import {
  DEFAULT_TOKEN_TTL_SECONDS,
  generateLocalSigningKey,
  localSigningKeyFrom,
  localTokenIssuer,
} from './jwt.js';
import { localIdentityProvider, staticLocalPrincipalSource } from './local.js';
import { identityProviderKind, type IdentityConfig } from './config.js';
import type { IdentityProvider, Principal } from './types.js';

const ISSUER = 'https://mcpforge.local/identity';
const AUDIENCE = 'mcpforge-gateway';

const ALICE = {
  subject: 'local:01J8Z0S8QK9F3W2ND5TQ8P4T7R',
  displayName: 'Alice Okonkwo',
  email: 'alice.okonkwo@example.invalid',
  groups: ['ap-clerks', 'jde-users'],
} as const;

function issuer(now: () => Date = () => new Date('2026-08-30T09:00:00.000Z')) {
  return localTokenIssuer({
    issuer: ISSUER,
    audience: AUDIENCE,
    signingKey: generateLocalSigningKey('kid-active'),
    now,
  });
}

function provider(now?: () => Date) {
  const tokens = issuer(now);
  return {
    tokens,
    provider: localIdentityProvider({
      issuer: tokens,
      source: staticLocalPrincipalSource([ALICE]),
      issuerUrl: ISSUER,
      audience: AUDIENCE,
      ...(now === undefined ? {} : { now }),
    }),
  };
}

function request(token: string): Request {
  return new Request('https://gateway.local/mcp', {
    headers: { authorization: `Bearer ${token}`, 'x-correlation-id': 'corr-1' },
  });
}

describe('clause 2 — the Wave 0 local issuer mints short-lived, signed, OIDC-shaped JWTs', () => {
  it('carries sub, groups, iat and exp, and is a real signed compact JWS', async () => {
    const { provider: p } = provider();
    const issued = await p.issueToken(ALICE.subject, ['pwd'], 'corr-1');

    // Three dot-separated segments = a compact JWS, not an opaque string.
    expect(issued.token.split('.')).toHaveLength(3);

    const payload = decodeJwt(issued.token);
    expect(payload['sub']).toBe(ALICE.subject);
    expect(payload['groups']).toEqual([...ALICE.groups]);
    expect(typeof payload['iat']).toBe('number');
    expect(typeof payload['exp']).toBe('number');
    expect(payload['iss']).toBe(ISSUER);
    expect(payload['aud']).toBe(AUDIENCE);
  });

  it('is short-lived, and the TTL is the fifteen minutes 02 §4.4 asks for', async () => {
    const { provider: p } = provider();
    const issued = await p.issueToken(ALICE.subject, ['pwd'], 'corr-1');
    const payload = decodeJwt(issued.token);
    expect(Number(payload['exp']) - Number(payload['iat'])).toBe(DEFAULT_TOKEN_TTL_SECONDS);
    expect(DEFAULT_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(900);
  });

  it('pins HS256 in the header and names the kid, so rotation can overlap', async () => {
    const { provider: p } = provider();
    const issued = await p.issueToken(ALICE.subject, ['pwd'], 'corr-1');
    const header = decodeProtectedHeader(issued.token);
    expect(header.alg).toBe('HS256');
    expect(header.kid).toBe('kid-active');
  });

  it('accepts a token signed by a previous key during the overlap window', async () => {
    const oldKey = generateLocalSigningKey('kid-old');
    const newKey = generateLocalSigningKey('kid-new');
    const before = localTokenIssuer({ issuer: ISSUER, audience: AUDIENCE, signingKey: oldKey });
    const after = localTokenIssuer({
      issuer: ISSUER,
      audience: AUDIENCE,
      signingKey: newKey,
      previousKeys: [oldKey],
    });
    const issued = await before.issue({
      ...ALICE,
      idp: 'local',
      authTime: new Date(),
      amr: ['pwd'],
    });
    await expect(after.verify(issued.token, 'corr-1')).resolves.toMatchObject({
      subject: ALICE.subject,
    });
    expect(after.acceptedKeyIds).toEqual(['kid-new', 'kid-old']);
  });

  it('refuses a token signed by a key that is not on the keyring', async () => {
    const foreign = localTokenIssuer({
      issuer: ISSUER,
      audience: AUDIENCE,
      signingKey: generateLocalSigningKey('kid-active'), // same kid, different bytes
    });
    const issued = await foreign.issue({
      ...ALICE,
      idp: 'local',
      authTime: new Date(),
      amr: ['pwd'],
    });
    await expect(issuer().verify(issued.token, 'corr-1')).rejects.toBeInstanceOf(ForgeError);
  });

  it('refuses an unsigned (alg: none) token', async () => {
    // Hand-built, because no library in the repo will mint one.
    const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${b64({ alg: 'none', kid: 'kid-active' })}.${b64({ sub: ALICE.subject })}.`;
    await expect(issuer().verify(unsigned, 'corr-1')).rejects.toBeInstanceOf(ForgeError);
  });

  it('refuses an expired token, and the refusal is AUTH_REQUIRED with a real next', async () => {
    const clock = { at: new Date('2026-08-30T09:00:00.000Z') };
    const iss = localTokenIssuer({
      issuer: ISSUER,
      audience: AUDIENCE,
      signingKey: generateLocalSigningKey('kid-active'),
      now: () => clock.at,
    });
    const issued = await iss.issue({
      ...ALICE,
      idp: 'local',
      authTime: clock.at,
      amr: ['pwd'],
    });
    clock.at = new Date(clock.at.getTime() + (DEFAULT_TOKEN_TTL_SECONDS + 1) * 1000);
    const error = await iss.verify(issued.token, 'corr-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForgeError);
    expect((error as ForgeError).code).toBe('AUTH_REQUIRED');
    expect((error as ForgeError).next.trim().length).toBeGreaterThan(0);
  });

  it('refuses a token minted for a different audience', async () => {
    const other = localTokenIssuer({
      issuer: ISSUER,
      audience: 'someone-elses-resource',
      signingKey: generateLocalSigningKey('kid-active'),
    });
    const issued = await other.issue({
      ...ALICE,
      idp: 'local',
      authTime: new Date(),
      amr: ['pwd'],
    });
    await expect(issuer().verify(issued.token, 'corr-1')).rejects.toBeInstanceOf(ForgeError);
  });
});

describe('clause 1 — nothing downstream consumes anything but Principal', () => {
  it('authenticate() takes a Request and hands back a Principal, nothing else', async () => {
    const { provider: p } = provider();
    const issued = await p.issueToken(ALICE.subject, ['pwd', 'otp'], 'corr-1');

    // Typed as the bare interface: a downstream consumer sees these three
    // methods and no local-provider extras (no `issueToken`, no key access).
    const seam: IdentityProvider = p;
    const principal = await seam.authenticate(request(issued.token));

    expect(Object.keys(principal).sort()).toEqual([
      'amr',
      'authTime',
      'displayName',
      'email',
      'groups',
      'idp',
      'subject',
    ]);
    expect(principal.subject).toBe(ALICE.subject);
    expect(principal.amr).toEqual(['pwd', 'otp']);
    expect(principal.idp).toBe('local');
    // The token itself does not ride along on the Principal — a downstream
    // consumer cannot re-present it, log it, or store it, because it never
    // gets it.
    expect(JSON.stringify(principal)).not.toContain(issued.token);
  });

  it('refuses a request with no bearer credential — there is no default subject', async () => {
    const { provider: p } = provider();
    const error = await p
      .authenticate(new Request('https://gateway.local/mcp'))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForgeError);
    expect((error as ForgeError).code).toBe('AUTH_REQUIRED');
  });

  it('refuses a verified token whose subject this deployment does not know', async () => {
    // The token verifies — same key, same issuer, same audience — but names a
    // subject with no account. That is IDENTITY_UNRESOLVED, hard, no fallback.
    const tokens = issuer();
    const p = localIdentityProvider({
      issuer: tokens,
      source: staticLocalPrincipalSource([ALICE]),
    });
    const ghost: Principal = {
      subject: 'local:nobody',
      displayName: 'Ghost',
      groups: [],
      idp: 'local',
      authTime: new Date(),
      amr: ['pwd'],
    };
    const issued = await tokens.issue(ghost);
    // authenticate() reconstructs from claims by design; the hard failure lands
    // at the first point that asks the deployment about this subject.
    const principal = await p.authenticate(request(issued.token));
    const error = await p.resolveGroups(principal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForgeError);
    expect((error as ForgeError).code).toBe('IDENTITY_UNRESOLVED');
    expect((error as ForgeError).retryable).toBe(false);
  });

  it('resolveGroups reads the source, not the token claims', async () => {
    const tokens = issuer();
    const issued = await tokens.issue({
      ...ALICE,
      groups: ['stale-group'],
      idp: 'local',
      authTime: new Date(),
      amr: ['pwd'],
    });
    const p = localIdentityProvider({
      issuer: tokens,
      source: staticLocalPrincipalSource([ALICE]),
    });
    const principal = await p.authenticate(request(issued.token));
    expect(principal.groups).toEqual(['stale-group']);
    expect(await p.resolveGroups(principal)).toEqual([...ALICE.groups]);
  });
});

describe('clause 3 — the Wave 1 issuer swap changes nothing downstream', () => {
  it('the claim set round-trips a Principal with no side lookup', () => {
    const principal: Principal = {
      ...ALICE,
      idp: 'local',
      authTime: new Date('2026-08-30T08:55:00.000Z'),
      amr: ['pwd', 'otp'],
    };
    const claims = principalToClaims(principal, {
      issuer: ISSUER,
      audience: AUDIENCE,
      issuedAt: new Date('2026-08-30T09:00:00.000Z'),
      expiresAt: new Date('2026-08-30T09:15:00.000Z'),
      jti: 'jti-1',
    });
    expect(principalFromClaims(claims, 'local', 'corr-1')).toEqual(principal);
    expect(claims.auth_time).toBe(epochSeconds(principal.authTime));
  });

  it('an oidc-shaped claim set reconstructs by the identical path', () => {
    // The proof that the seam is issuer-agnostic: the same pure function that
    // W0-D3 will hand LTM AD's claims to, handed an oidc claim set today.
    const claims = {
      iss: 'https://login.microsoftonline.com/ltm/v2.0',
      aud: AUDIENCE,
      sub: 'aad:9f0b2c1e-...',
      iat: 1_780_000_000,
      exp: 1_780_000_900,
      nbf: 1_780_000_000,
      jti: 'jti-2',
      name: 'Alice Okonkwo',
      email: ALICE.email,
      groups: ['CN=AP Clerks,OU=Groups,DC=ltm,DC=com'],
      auth_time: 1_779_999_900,
      amr: ['pwd', 'mfa'],
      idp: 'oidc',
    };
    const principal = principalFromClaims(claims, 'oidc', 'corr-1');
    expect(principal.subject).toBe('aad:9f0b2c1e-...');
    expect(principal.idp).toBe('oidc');
    expect(principal.groups).toEqual(['CN=AP Clerks,OU=Groups,DC=ltm,DC=com']);
  });

  it('refuses a local token that claims to be an oidc one', async () => {
    const localIssued = await issuer().issue({
      ...ALICE,
      idp: 'local',
      authTime: new Date(),
      amr: ['pwd'],
    });
    const claims = decodeJwt(localIssued.token);
    expect(() => principalFromClaims(claims, 'oidc', 'corr-1')).toThrow(ForgeError);
  });

  it('rejects a claim set missing a required Principal field', () => {
    for (const missing of ['sub', 'name', 'groups', 'auth_time', 'amr', 'idp']) {
      const claims: Record<string, unknown> = {
        sub: ALICE.subject,
        name: ALICE.displayName,
        groups: [],
        auth_time: 1,
        amr: ['pwd'],
        idp: 'local',
      };
      delete claims[missing];
      expect(() => principalFromClaims(claims, 'local', 'corr-1')).toThrow(ForgeError);
    }
  });

  it('the config discriminant is the only switch, and it is total', () => {
    const local: IdentityConfig = {
      provider: 'local',
      issuer: ISSUER,
      audience: AUDIENCE,
      signingKeyRef: 'secretRef://gateway/local-issuer/jwt-signing',
    };
    const oidc: IdentityConfig = {
      provider: 'oidc',
      issuer: 'https://login.microsoftonline.com/ltm/v2.0',
      audience: AUDIENCE,
      discoveryUrl: 'https://login.microsoftonline.com/ltm/v2.0/.well-known/openid-configuration',
      clientId: 'mcpforge',
    };
    expect(identityProviderKind(local)).toBe('local');
    expect(identityProviderKind(oidc)).toBe('oidc');
    // CLAUDE.md non-negotiable 8: a config block carries a reference, never a
    // value. Asserted rather than assumed, because this type is what an
    // overlay — a git artefact — is deserialised into.
    expect(local.signingKeyRef.startsWith('secretRef://')).toBe(true);
  });
});

describe('key handling', () => {
  it('refuses key material below the HS256 floor', () => {
    expect(() => localSigningKeyFrom('kid', new Uint8Array(31))).toThrow(/at least 32 bytes/);
  });

  it('does not expose key bytes through the LocalSigningKey object', () => {
    const key = generateLocalSigningKey('kid-active');
    // A KeyObject, not a buffer: it serialises to an empty object rather than
    // printing the secret into a log line or a test snapshot.
    expect(JSON.stringify(key)).not.toMatch(/[0-9a-f]{32}/i);
    expect(String(key.key)).not.toMatch(/[0-9a-f]{32}/i);
  });

  it('metadata() is honest about there being no Authorization Server at Wave 0', () => {
    const { provider: p } = provider();
    const metadata = p.metadata();
    expect(metadata.kind).toBe('local');
    expect(metadata.oauthDiscoveryReady).toBe(false);
    expect(metadata.authorizationEndpoint).toBeNull();
    expect(metadata.tokenEndpoint).toBeNull();
    expect(metadata.jwksUri).toBeNull();
    expect(metadata.signingAlgorithms).toEqual(['HS256']);
  });
});
