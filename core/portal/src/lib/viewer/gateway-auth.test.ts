// MCPForge — W0-P5b: the portal server's client for the gateway's local token
// endpoint (W0-P5a). A fake `fetch` stands in for the gateway; the real
// round trip is in core/gateway/launch.e2e.test.ts.

import { describe, expect, it } from 'vitest';

import {
  gatewayBaseUrl,
  gatewayRefresh,
  gatewaySignIn,
  gatewaySignOut,
  ViewerAuthError,
  type FetchLike,
} from './gateway-auth';

const GRANT = {
  tokenType: 'Bearer',
  accessToken: 'a',
  accessTokenExpiresAt: '2026-09-27T09:15:00.000Z',
  refreshToken: 'mfr_x',
  idleExpiresAt: '2026-09-27T17:00:00.000Z',
  sessionExpiresAt: '2026-09-27T21:00:00.000Z',
  principal: {
    subject: 'local:meera',
    displayName: 'Meera',
    groups: [],
    idp: 'local',
    providerId: 'local',
    amr: ['pwd'],
    authTime: '2026-09-27T09:00:00.000Z',
  },
};

function fakeFetch(
  status: number,
  body: unknown,
  seen: { url?: string; body?: string } = {},
): FetchLike {
  return (url, init) => {
    seen.url = url;
    seen.body = String(init.body);
    return Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
}

describe('gateway auth client', () => {
  it('signs in against /auth/local/token and returns the parsed grant', async () => {
    const seen: { url?: string; body?: string } = {};
    const grant = await gatewaySignIn(
      { username: 'meera', password: 'pw-long-enough' },
      { baseUrl: 'http://gw', fetch: fakeFetch(200, GRANT, seen) },
    );
    expect(seen.url).toBe('http://gw/auth/local/token');
    expect(JSON.parse(seen.body ?? '{}')).toEqual({
      username: 'meera',
      password: 'pw-long-enough',
    });
    expect(grant.principal.subject).toBe('local:meera');
  });

  it('passes a gateway refusal through with its own message and next', async () => {
    const error = await gatewaySignIn(
      { username: 'meera', password: 'wrong' },
      {
        baseUrl: 'http://gw',
        fetch: fakeFetch(401, {
          error: { code: 'AUTH_REQUIRED', message: 'did not authenticate', next: 'Re-enter it.' },
        }),
      },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ViewerAuthError);
    expect(error).toMatchObject({
      code: 'REFUSED',
      gatewayCode: 'AUTH_REQUIRED',
      message: 'did not authenticate',
      next: 'Re-enter it.',
    });
  });

  it('a gateway that is down is GATEWAY_UNREACHABLE with a next naming where it should be', async () => {
    const error = await gatewayRefresh('mfr_x', {
      baseUrl: 'http://127.0.0.1:1',
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'GATEWAY_UNREACHABLE' });
    expect((error as ViewerAuthError).next).toContain('http://127.0.0.1:1');
  });

  it('an unrecognisable success body is refused, not trusted', async () => {
    const error = await gatewaySignIn(
      { username: 'u', password: 'p' },
      { baseUrl: 'http://gw', fetch: fakeFetch(200, { accessToken: 'a' }) },
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'GATEWAY_ERROR' });
  });

  it('signs out with 204', async () => {
    await expect(
      gatewaySignOut('mfr_x', { baseUrl: 'http://gw', fetch: fakeFetch(204, undefined) }),
    ).resolves.toBeUndefined();
  });

  it('finds the gateway from MCPFORGE_GATEWAY_URL, else MCPFORGE_GATEWAY_PORT on loopback', () => {
    expect(gatewayBaseUrl({ MCPFORGE_GATEWAY_URL: 'http://gw:9/' })).toBe('http://gw:9');
    expect(gatewayBaseUrl({ MCPFORGE_GATEWAY_PORT: '4000' })).toBe('http://127.0.0.1:4000');
    expect(gatewayBaseUrl({})).toBe('http://127.0.0.1:3939');
  });
});
