// W0-P3b: the read client returns one of five states and never throws to a
// page, never turns a failure into `[]`, and always sends BOTH halves of the
// caller (consumer assertion + the viewer's bearer, non-negotiable 6).

import { describe, expect, it, vi } from 'vitest';

vi.mock('../viewer/session', () => ({ sessionIdFromCookies: () => Promise.resolve(undefined) }));

import { ConsumerCredentialError } from './consumer-assertion';
import { readCall, readCalls, type ReadDeps } from './read-client';

const OK_PAGE = { asOf: '2026-09-28T00:00:00Z', items: [], nextCursor: null };

function deps(overrides: Partial<ReadDeps> = {}): ReadDeps {
  return {
    baseUrl: 'http://gw.test',
    accessToken: () => Promise.resolve('human-token'),
    consumerHeaders: () => Promise.resolve({ 'mcpforge-consumer-assertion': 'signed' }),
    fetch: () => Promise.resolve(new Response(JSON.stringify(OK_PAGE), { status: 200 })),
    ...overrides,
  };
}

describe('read client', () => {
  it('sends the consumer assertion AND the viewer bearer, and parses with the shared contract', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(OK_PAGE), { status: 200 })),
    );
    const r = await readCalls({ limit: 5 }, deps({ fetch }));
    expect(r).toEqual({ kind: 'ok', data: OK_PAGE });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://gw.test/api/v1/calls?limit=5');
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer human-token');
    expect(headers['mcpforge-consumer-assertion']).toBe('signed');
    expect(init.method).toBe('GET');
  });

  it('is signed-out, and calls nothing, when there is no session', async () => {
    const fetch = vi.fn();
    const r = await readCalls({}, deps({ fetch, accessToken: () => Promise.resolve(null) }));
    expect(r.kind).toBe('signed-out');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('defaults to the request session, which is signed-out with no cookie', async () => {
    const all = deps();
    const rest: ReadDeps = {
      baseUrl: all.baseUrl!,
      consumerHeaders: all.consumerHeaders!,
      fetch: all.fetch!,
    };
    expect((await readCalls({}, rest)).kind).toBe('signed-out');
  });

  it('is gateway-down, naming the endpoint, when the connection fails', async () => {
    const r = await readCalls(
      {},
      deps({ fetch: () => Promise.reject(new TypeError('ECONNREFUSED')) }),
    );
    expect(r).toMatchObject({ kind: 'gateway-down', endpoint: 'http://gw.test' });
    if (r.kind === 'gateway-down') expect(r.next).toMatch(/gateway/);
  });

  it('is refused, with the portal key command, when the portal cannot present its consumer', async () => {
    const r = await readCalls(
      {},
      deps({
        consumerHeaders: () =>
          Promise.reject(new ConsumerCredentialError('CONSUMER_KEY_MISSING', 'no key', 'issue it')),
      }),
    );
    expect(r).toEqual({
      kind: 'refused',
      code: 'CONSUMER_KEY_MISSING',
      message: 'no key',
      next: 'issue it',
    });
  });

  it('passes a gateway refusal through with its code, next and correlation id', async () => {
    const body = {
      error: { code: 'AUTH_REQUIRED', message: 'm', next: 'sign in', correlationId: 'c1' },
    };
    const r = await readCalls(
      {},
      deps({ fetch: () => Promise.resolve(new Response(JSON.stringify(body), { status: 401 })) }),
    );
    expect(r).toEqual({
      kind: 'refused',
      code: 'AUTH_REQUIRED',
      message: 'm',
      next: 'sign in',
      correlationId: 'c1',
    });
  });

  it('maps the gateway 404 to not-found', async () => {
    const body = {
      error: { code: 'NOT_FOUND', message: 'no call', next: 'check', correlationId: 'c2' },
    };
    const r = await readCall(
      'x',
      deps({ fetch: () => Promise.resolve(new Response(JSON.stringify(body), { status: 404 })) }),
    );
    expect(r.kind).toBe('not-found');
  });

  it('refuses a 200 that does not match the contract, rather than rendering it', async () => {
    const r = await readCalls(
      {},
      deps({ fetch: () => Promise.resolve(new Response('{"items":"nope"}', { status: 200 })) }),
    );
    expect(r).toMatchObject({ kind: 'refused', code: 'CONTRACT_MISMATCH' });
  });

  it('treats a non-MCPForge error body as the gateway being unavailable, never as empty', async () => {
    const r = await readCalls(
      {},
      deps({ fetch: () => Promise.resolve(new Response('<html>', { status: 502 })) }),
    );
    expect(r.kind).toBe('gateway-down');
  });
});
