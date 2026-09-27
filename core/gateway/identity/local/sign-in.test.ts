// MCPForge — sign-in, silent renewal and sign-out. W0-P5a, W0-P4 §2 and §9
// decision 6.
//
// Real SQLite store, real Argon2id `LocalUserStore`, real HS256 issuer. The
// clock is injected so the idle and absolute limits are tested at their edges
// rather than by waiting.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ForgeError } from '@mcpforge/shared/errors';
import { openRuntimeStore } from '../../store/server.js';
import type { RuntimeStore } from '../../store/server.js';
import { DEFAULT_LOCAL_AUDIENCE, DEFAULT_LOCAL_ISSUER } from '../config.js';
import { generateLocalSigningKey, localTokenIssuer } from '../jwt.js';
import { localIdentityProvider } from '../local.js';
import { localUserStore, type LocalUserStore } from './store.js';
import { hashRefreshToken, localSignInService, type LocalSignInService } from './sign-in.js';

// Argon2id is deliberately expensive; see local-user-store.test.ts.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-sign-in-'));
const PASSWORD = 'correct-horse-battery-staple';
const HOUR = 60 * 60 * 1000;
const ISSUER = { issuer: DEFAULT_LOCAL_ISSUER, audience: DEFAULT_LOCAL_AUDIENCE };

let store: RuntimeStore;
let users: LocalUserStore;
let service: LocalSignInService;
let clock = new Date('2026-09-27T09:00:00.000Z');
let subject: string;

function advance(ms: number): void {
  clock = new Date(clock.getTime() + ms);
}

async function code(p: Promise<unknown>): Promise<string> {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ForgeError);
  const shape = (error as ForgeError).toJSON();
  expect(shape.next.length).toBeGreaterThan(0);
  return shape.code;
}

beforeAll(async () => {
  store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'runtime.db') });
  users = localUserStore({ store, now: () => clock });
  const provider = localIdentityProvider({
    issuer: localTokenIssuer({
      ...ISSUER,
      signingKey: generateLocalSigningKey('sign-in-test'),
      now: () => clock,
    }),
    source: users.principalSource(),
    now: () => clock,
  });
  service = localSignInService({ store, users, provider, now: () => clock });
  subject = (
    await users.createUser({
      username: 'meera',
      displayName: 'Meera Rao',
      password: PASSWORD,
      groups: ['mcpforge-admins'],
    })
  ).subject;
});

afterAll(async () => {
  await store?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('local sign-in', () => {
  it('signs in and returns a 15-minute access token, a refresh token and the principal', async () => {
    const grant = await service.signIn({ username: 'meera', password: PASSWORD }, 'c1');
    expect(grant.principal).toMatchObject({
      subject,
      displayName: 'Meera Rao',
      groups: ['mcpforge-admins'],
      idp: 'local',
      providerId: 'local',
      amr: ['pwd'],
    });
    expect(new Date(grant.accessTokenExpiresAt).getTime() - clock.getTime()).toBe(15 * 60 * 1000);
    expect(new Date(grant.idleExpiresAt).getTime() - clock.getTime()).toBe(8 * HOUR);
    expect(new Date(grant.sessionExpiresAt).getTime() - clock.getTime()).toBe(12 * HOUR);
    expect(grant.refreshToken.startsWith('mfr_')).toBe(true);
  });

  it('refuses a wrong password with the one sign-in refusal', async () => {
    expect(
      await code(service.signIn({ username: 'meera', password: 'wrong-but-long-enough' }, 'c2')),
    ).toBe('AUTH_REQUIRED');
  });

  it('stores the refresh token only as its hash', async () => {
    const grant = await service.signIn({ username: 'meera', password: PASSWORD }, 'c3');
    const found = await store.authSessions.findByTokenHash(hashRefreshToken(grant.refreshToken));
    expect(found?.token.tokenHash).toBe(hashRefreshToken(grant.refreshToken));
    // Nothing on disk under the store directory contains the token value.
    for (const file of readdirSync(dir)) {
      expect(readFileSync(join(dir, file)).includes(grant.refreshToken)).toBe(false);
      expect(readFileSync(join(dir, file)).includes(grant.accessToken)).toBe(false);
    }
  });

  it('renews silently: a new access token, a rotated refresh token, the same auth_time', async () => {
    const first = await service.signIn({ username: 'meera', password: PASSWORD }, 'c4');
    advance(14 * 60 * 1000);
    const renewed = await service.refresh(first.refreshToken, 'c5');
    expect(renewed.refreshToken).not.toBe(first.refreshToken);
    expect(renewed.accessToken).not.toBe(first.accessToken);
    expect(renewed.principal.authTime).toBe(first.principal.authTime);
    expect(renewed.sessionExpiresAt).toBe(first.sessionExpiresAt);
  });

  it('a replayed refresh token ends the session for both holders', async () => {
    const first = await service.signIn({ username: 'meera', password: PASSWORD }, 'c6');
    const renewed = await service.refresh(first.refreshToken, 'c7');
    expect(await code(service.refresh(first.refreshToken, 'c8'))).toBe('AUTH_REQUIRED');
    expect(await code(service.refresh(renewed.refreshToken, 'c9'))).toBe('AUTH_REQUIRED');
  });

  it('stops renewing after 8 hours idle', async () => {
    const grant = await service.signIn({ username: 'meera', password: PASSWORD }, 'c10');
    advance(8 * HOUR);
    expect(await code(service.refresh(grant.refreshToken, 'c11'))).toBe('AUTH_REQUIRED');
  });

  it('stops renewing at 12 hours absolute, however active the session', async () => {
    let grant = await service.signIn({ username: 'meera', password: PASSWORD }, 'c12');
    for (let i = 0; i < 11; i += 1) {
      advance(HOUR);
      grant = await service.refresh(grant.refreshToken, `c13-${i}`);
    }
    // 11 hours in: the reported idle deadline is clamped to the absolute one.
    expect(grant.idleExpiresAt).toBe(grant.sessionExpiresAt);
    advance(HOUR);
    expect(await code(service.refresh(grant.refreshToken, 'c14'))).toBe('AUTH_REQUIRED');
  });

  it('disabling the account stops renewal at the next refresh, and ends the session', async () => {
    const other = await users.createUser({
      username: 'arjun',
      displayName: 'Arjun Mehta',
      password: PASSWORD,
    });
    const grant = await service.signIn({ username: 'arjun', password: PASSWORD }, 'c15');
    await users.deactivateUser(other.subject);
    expect(await code(service.refresh(grant.refreshToken, 'c16'))).toBe('IDENTITY_UNRESOLVED');
    const found = await store.authSessions.findByTokenHash(hashRefreshToken(grant.refreshToken));
    expect(found?.session.revokedReason).toBe('account_unavailable');
  });

  it('signs out: the refresh token no longer renews; unknown tokens sign out silently', async () => {
    const grant = await service.signIn({ username: 'meera', password: PASSWORD }, 'c17');
    await service.signOut(grant.refreshToken, 'c18');
    expect(await code(service.refresh(grant.refreshToken, 'c19'))).toBe('AUTH_REQUIRED');
    await expect(service.signOut('mfr_not-a-real-token', 'c20')).resolves.toBeUndefined();
    await expect(service.signOut('garbage', 'c21')).resolves.toBeUndefined();
  });

  it('refuses a malformed refresh token without touching the store', async () => {
    expect(await code(service.refresh('not-a-refresh-token', 'c22'))).toBe('AUTH_REQUIRED');
  });

  it('refuses limits where idle exceeds absolute', () => {
    expect(() =>
      localSignInService({
        store,
        users,
        provider: localIdentityProvider({
          issuer: localTokenIssuer({ ...ISSUER, signingKey: generateLocalSigningKey('x') }),
          source: users.principalSource(),
        }),
        limits: { idleSeconds: 13 * 3600, absoluteSeconds: 12 * 3600 },
      }),
    ).toThrow(/idle limit/);
  });
});
