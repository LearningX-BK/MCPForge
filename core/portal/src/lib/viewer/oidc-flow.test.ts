// MCPForge — W0-P23: authorization code + PKCE from the portal's side, against a
// fake provider and a fake gateway. No network.

import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import type { FetchLike } from './gateway-auth';
import { beginOidcSignIn, completeOidcSignIn } from './oidc-flow';
import { RENEW_BEFORE_EXPIRY_MS, resolveViewer } from './viewer';
import { refreshGrant } from './refresh';
import { readSession, resetSessionStoreForTests } from './session-store';

const ORIGIN = 'http://localhost:3000';
const NOW = new Date('2026-10-05T12:00:00Z');

const PROVIDERS = {
  providers: [
    { id: 'local', kind: 'local', displayName: 'MCPForge account' },
    {
      id: 'entra',
      kind: 'oidc',
      displayName: 'LTM (Entra ID)',
      issuer: 'https://idp.example/t/v2.0',
      authorizationEndpoint: 'https://idp.example/t/authorize',
      tokenEndpoint: 'https://idp.example/t/token',
      clientId: 'portal-client',
      scopes: ['openid', 'offline_access'],
    },
  ],
  sessionLimits: { idleSeconds: 28800, absoluteSeconds: 43200 },
};

function principal(providerId: string, extra: Record<string, unknown> = {}) {
  return {
    subject: `${providerId}:abc`,
    displayName: 'Meera',
    groups: ['grp'],
    idp: 'https://idp.example/t/v2.0',
    providerId,
    amr: ['pwd'],
    authTime: NOW.toISOString(),
    ...extra,
  };
}

interface Fake {
  readonly fetch: FetchLike;
  readonly tokenBodies: URLSearchParams[];
  readonly principalAuth: string[];
  resolvesTo: string;
}

function fake(): Fake {
  const f: Fake = {
    tokenBodies: [],
    principalAuth: [],
    resolvesTo: 'entra',
    fetch: (input, init) => {
      const json = (status: number, body: unknown) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (input.endsWith('/auth/providers')) return json(200, PROVIDERS);
      if (input.endsWith('/auth/principal')) {
        const auth = (init.headers as Record<string, string>)['authorization'] ?? '';
        f.principalAuth.push(auth);
        return json(200, { principal: principal(f.resolvesTo) });
      }
      if (input === 'https://idp.example/t/token') {
        const body = new URLSearchParams(String(init.body));
        f.tokenBodies.push(body);
        return body.get('grant_type') === 'authorization_code' && body.get('code') !== 'good'
          ? json(400, { error: 'invalid_grant' })
          : json(200, {
              access_token: `at-${f.tokenBodies.length}`,
              refresh_token: `rt-${f.tokenBodies.length}`,
              expires_in: 3600,
            });
      }
      return json(404, {});
    },
  };
  return f;
}

beforeEach(resetSessionStoreForTests);

describe('beginOidcSignIn', () => {
  it('builds an S256 PKCE authorization URL for a public client, with a fresh state', async () => {
    const f = fake();
    const { url, state } = await beginOidcSignIn(
      { providerId: 'entra', origin: ORIGIN, returnTo: '/catalog' },
      { fetch: f.fetch },
    );
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://idp.example/t/authorize');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('portal-client');
    expect(u.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/sign-in/oidc/callback`);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe(state);
    expect(state.length).toBeGreaterThanOrEqual(43);
    expect(url).not.toMatch(/secret/i);
  });

  it('refuses the local provider and an unknown one: only an OIDC provider has an authorization endpoint', async () => {
    for (const providerId of ['local', 'nope']) {
      await expect(
        beginOidcSignIn({ providerId, origin: ORIGIN, returnTo: '/' }, { fetch: fake().fetch }),
      ).rejects.toMatchObject({ code: 'REFUSED' });
    }
  });
});

describe('completeOidcSignIn', () => {
  async function begin(f: Fake) {
    const { url, state } = await beginOidcSignIn(
      { providerId: 'entra', origin: ORIGIN, returnTo: '/catalog' },
      { fetch: f.fetch },
    );
    return { state, challenge: new URL(url).searchParams.get('code_challenge')! };
  }

  it('exchanges the code with the PKCE verifier, asks the gateway who the token is, and holds the refresh token server-side', async () => {
    const f = fake();
    const { state, challenge } = await begin(f);
    const done = await completeOidcSignIn({ code: 'good', state }, { fetch: f.fetch, now: NOW });

    const body = f.tokenBodies[0]!;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_id')).toBe('portal-client');
    expect(body.has('client_secret')).toBe(false);
    expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(
      challenge,
    );
    expect(f.principalAuth).toEqual(['Bearer at-1']);

    expect(done.returnTo).toBe('/catalog');
    const stored = readSession(done.sessionId)!;
    expect(stored.grant.principal.subject).toBe('entra:abc');
    expect(stored.grant.refreshToken).toBe('rt-1');
    expect(stored.grant.accessTokenExpiresAt).toBe('2026-10-05T13:00:00.000Z');
    expect(stored.grant.idleExpiresAt).toBe('2026-10-05T20:00:00.000Z');
    expect(stored.grant.sessionExpiresAt).toBe('2026-10-06T00:00:00.000Z');
    expect(stored.idleMs).toBe(28800_000);
  });

  it('a state is single-use, and one this portal never issued is refused', async () => {
    const f = fake();
    const { state } = await begin(f);
    await completeOidcSignIn({ code: 'good', state }, { fetch: f.fetch });
    await expect(
      completeOidcSignIn({ code: 'good', state }, { fetch: f.fetch }),
    ).rejects.toMatchObject({ gatewayCode: 'STATE_MISMATCH' });
    await expect(
      completeOidcSignIn({ code: 'good', state: 'forged' }, { fetch: f.fetch }),
    ).rejects.toMatchObject({ gatewayCode: 'STATE_MISMATCH' });
  });

  it('a provider that refuses the code yields no session', async () => {
    const f = fake();
    const { state } = await begin(f);
    await expect(
      completeOidcSignIn({ code: 'bad', state }, { fetch: f.fetch }),
    ).rejects.toMatchObject({ gatewayCode: 'PROVIDER_REFUSED' });
  });

  it('a token the gateway resolves under another provider yields no session', async () => {
    const f = fake();
    f.resolvesTo = 'local';
    const { state } = await begin(f);
    await expect(
      completeOidcSignIn({ code: 'good', state }, { fetch: f.fetch }),
    ).rejects.toMatchObject({ gatewayCode: 'PROVIDER_MISMATCH' });
  });
});

describe('an OIDC session after sign-in', () => {
  const personasFor = () => [] as const;

  async function signedIn(f: Fake) {
    const { state } = await beginOidcSignIn(
      { providerId: 'entra', origin: ORIGIN, returnTo: '/' },
      { fetch: f.fetch },
    );
    return (await completeOidcSignIn({ code: 'good', state }, { fetch: f.fetch, now: NOW }))
      .sessionId;
  }

  it('renews at the PROVIDER with the held refresh token, then asks the gateway again who it is', async () => {
    const f = fake();
    const id = await signedIn(f);
    const later = new Date(NOW.getTime() + 3600_000 - RENEW_BEFORE_EXPIRY_MS + 1);
    const viewer = await resolveViewer(id, {
      now: () => later,
      refresh: (g) => refreshGrant(g, { fetch: f.fetch, now: later }),
      personasFor,
    });
    expect(viewer?.subject).toBe('entra:abc');
    const refresh = f.tokenBodies[1]!;
    expect(refresh.get('grant_type')).toBe('refresh_token');
    expect(refresh.get('refresh_token')).toBe('rt-1');
    expect(readSession(id)?.grant.refreshToken).toBe('rt-2');
    expect(f.principalAuth).toEqual(['Bearer at-1', 'Bearer at-2']);
  });

  it('ends after the idle limit with no use, and each use extends the idle window', async () => {
    const f = fake();
    const id = await signedIn(f);
    const deps = (at: Date) => ({
      now: () => at,
      refresh: (g: Parameters<typeof refreshGrant>[0]) =>
        refreshGrant(g, { fetch: f.fetch, now: at }),
      personasFor,
    });
    const t1 = new Date(NOW.getTime() + 2 * 3600_000);
    expect(await resolveViewer(id, deps(t1))).not.toBeNull();
    expect(readSession(id)?.grant.idleExpiresAt).toBe(
      new Date(t1.getTime() + 28800_000).toISOString(),
    );
    const idleOut = new Date(t1.getTime() + 28800_000 + 1);
    expect(await resolveViewer(id, deps(idleOut))).toBeNull();
    expect(readSession(id)).toBeUndefined();
  });

  it('a session without a refresh token ends when its access token does, and never reaches a provider', async () => {
    const f = fake();
    const id = await signedIn(f);
    const bare = readSession(id)!;
    const { refreshToken: _dropped, ...grant } = bare.grant;
    void _dropped;
    resetSessionStoreForTests();
    const { createSession } = await import('./session-store');
    const id2 = createSession({ ...grant, accessTokenExpiresAt: NOW.toISOString() });
    const calls = f.tokenBodies.length;
    expect(
      await resolveViewer(id2, {
        now: () => NOW,
        refresh: (g) => refreshGrant(g, { fetch: f.fetch }),
        personasFor,
      }),
    ).toBeNull();
    expect(f.tokenBodies.length).toBe(calls);
  });
});
