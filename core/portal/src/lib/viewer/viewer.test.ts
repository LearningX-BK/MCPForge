// MCPForge — W0-P5b: resolving the viewer, with silent renewal (W0-P4 §9
// decision 6).

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GatewayGrant } from './gateway-auth';
import {
  createSession,
  readSession,
  resetSessionStoreForTests,
  selectPersona,
} from './session-store';
import { RENEW_BEFORE_EXPIRY_MS, resolveViewer } from './viewer';

const NOW = new Date('2026-09-27T09:00:00.000Z');
const plus = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

function grant(overrides: Partial<GatewayGrant> = {}, refreshToken = 'mfr_one'): GatewayGrant {
  return {
    tokenType: 'Bearer',
    accessToken: 'access-1',
    accessTokenExpiresAt: plus(15 * 60_000),
    refreshToken,
    idleExpiresAt: plus(8 * 3_600_000),
    sessionExpiresAt: plus(12 * 3_600_000),
    principal: {
      subject: 'local:meera',
      displayName: 'Meera Rao',
      groups: ['mcpforge-admins'],
      idp: 'local',
      providerId: 'local',
      amr: ['pwd'],
      authTime: NOW.toISOString(),
    },
    ...overrides,
  };
}

const personasFor = (groups: readonly string[]) =>
  groups.includes('mcpforge-admins') ? (['developer', 'admin'] as const) : ([] as const);

beforeEach(() => resetSessionStoreForTests());

describe('resolveViewer', () => {
  it('an unknown session id is nobody', async () => {
    const refresh = vi.fn();
    expect(await resolveViewer('nope', { now: () => NOW, refresh, personasFor })).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a fresh session resolves without renewing; personas come from the mapping, not the token', async () => {
    const id = createSession(grant());
    const refresh = vi.fn();
    const viewer = await resolveViewer(id, { now: () => NOW, refresh, personasFor });
    expect(viewer).toMatchObject({
      subject: 'local:meera',
      displayName: 'Meera Rao',
      personas: ['developer', 'admin'],
      persona: 'developer',
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(JSON.stringify(viewer)).not.toContain('access-1');
    expect(JSON.stringify(viewer)).not.toContain('mfr_one');
  });

  it('renews silently when the access token is near expiry, and keeps the new tokens', async () => {
    const id = createSession(grant({ accessTokenExpiresAt: plus(RENEW_BEFORE_EXPIRY_MS - 1) }));
    const refresh = vi.fn().mockResolvedValue(grant({ accessToken: 'access-2' }, 'mfr_two'));
    const viewer = await resolveViewer(id, { now: () => NOW, refresh, personasFor });
    expect(viewer?.subject).toBe('local:meera');
    expect(refresh).toHaveBeenCalledWith('mfr_one');
    expect(readSession(id)?.grant.refreshToken).toBe('mfr_two');
  });

  it('concurrent requests share ONE renewal (a second would present a spent token)', async () => {
    const id = createSession(grant({ accessTokenExpiresAt: plus(0) }));
    let release: (g: GatewayGrant) => void = () => undefined;
    const refresh = vi.fn(
      () =>
        new Promise<GatewayGrant>((resolve) => {
          release = resolve;
        }),
    );
    const a = resolveViewer(id, { now: () => NOW, refresh, personasFor });
    const b = resolveViewer(id, { now: () => NOW, refresh, personasFor });
    await Promise.resolve();
    release(grant({}, 'mfr_two'));
    const [va, vb] = await Promise.all([a, b]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(va?.subject).toBe('local:meera');
    expect(vb?.subject).toBe('local:meera');
  });

  it('a renewal refused by the gateway signs the viewer out of the portal', async () => {
    const id = createSession(grant({ accessTokenExpiresAt: plus(0) }));
    const refresh = vi.fn().mockRejectedValue(new Error('AUTH_REQUIRED'));
    expect(await resolveViewer(id, { now: () => NOW, refresh, personasFor })).toBeNull();
    expect(readSession(id)).toBeUndefined();
  });

  it('past the absolute limit the session is gone, with no renewal attempt', async () => {
    const id = createSession(grant({ sessionExpiresAt: plus(-1) }));
    const refresh = vi.fn();
    expect(await resolveViewer(id, { now: () => NOW, refresh, personasFor })).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a stored lens the viewer no longer holds is dropped, not honoured', async () => {
    const id = createSession(grant());
    selectPersona(id, 'admin');
    const noLongerAdmin = () => ['business'] as const;
    const viewer = await resolveViewer(id, {
      now: () => NOW,
      refresh: vi.fn(),
      personasFor: noLongerAdmin,
    });
    expect(viewer).toMatchObject({ personas: ['business'], persona: 'business' });
  });
});
