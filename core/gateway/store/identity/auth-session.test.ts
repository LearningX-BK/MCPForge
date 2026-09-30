// MCPForge — the sign-in session state machine. W0-P5a, W0-P4 §9 decision 6:
// refresh tokens "stored hashed ..., rotated on every use, and reuse of a spent
// refresh token revokes the whole session".
//
// Against the real SQLite store. The Postgres leg is the store contract suite's
// job; this repository uses only the dialect-neutral SQL the others use.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../store.js';
import { AUTH_REFRESH_TOKEN } from '../schema/spec.js';
import { AUTH_SESSION_ID_PREFIX } from './auth-session.js';
import type { RuntimeStore } from '../repository.js';

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-auth-session-'));
const T0 = '2026-09-27T09:00:00.000Z';
const T1 = '2026-09-27T09:10:00.000Z';
const IDLE = '2026-09-27T17:00:00.000Z';
const ABSOLUTE = '2026-09-27T21:00:00.000Z';

let store: RuntimeStore;
let seq = 0;
const hash = (label: string) => `${label}-${(seq += 1)}`.padEnd(64, '0');

async function openSession(tokenHash: string) {
  return store.authSessions.open({
    subject: 'local:0192-aaaa',
    providerId: 'local',
    amr: ['pwd'],
    tokenHash,
    now: T0,
    idleExpiresAt: IDLE,
    absoluteExpiresAt: ABSOLUTE,
  });
}

beforeAll(async () => {
  store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'runtime.db') });
});

afterAll(async () => {
  await store?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('auth sessions', () => {
  it('the token hash column is UNIQUE in the single schema definition', () => {
    const unique = (AUTH_REFRESH_TOKEN.indexes ?? []).find(
      (ix) => ix.columns.join() === 'token_hash',
    );
    expect(unique?.unique).toBe(true);
    // No column could hold a token value: the only token column is the hash.
    expect(Object.keys(AUTH_REFRESH_TOKEN.columns).filter((c) => c.includes('token'))).toEqual([
      'token_hash',
    ]);
  });

  it('opens a session with its first refresh token', async () => {
    const first = hash('a');
    const { session, token } = await openSession(first);
    expect(session.id.startsWith(AUTH_SESSION_ID_PREFIX)).toBe(true);
    expect(session).toMatchObject({
      subject: 'local:0192-aaaa',
      providerId: 'local',
      amr: ['pwd'],
      absoluteExpiresAt: ABSOLUTE,
      revokedAt: null,
    });
    expect(token).toMatchObject({ tokenHash: first, spentAt: null, idleExpiresAt: IDLE });
    expect(await store.authSessions.findByTokenHash(first)).toMatchObject({
      session: { id: session.id },
    });
  });

  it('rotates: the presented token is spent and names its successor', async () => {
    const first = hash('b');
    const next = hash('b');
    const { session } = await openSession(first);
    const outcome = await store.authSessions.rotate({
      presentedHash: first,
      newHash: next,
      now: T1,
      idleExpiresAt: IDLE,
    });
    expect(outcome.kind).toBe('rotated');
    if (outcome.kind !== 'rotated') return;
    expect(outcome.session.id).toBe(session.id);
    expect(outcome.token.tokenHash).toBe(next);
    const spent = await store.authSessions.findByTokenHash(first);
    expect(spent?.token.spentAt).toBe(T1);
    expect(spent?.token.replacedBy).toBe(outcome.token.id);
  });

  it('reuse of a spent token revokes the whole session, successor included', async () => {
    const first = hash('c');
    const next = hash('c');
    const { session } = await openSession(first);
    await store.authSessions.rotate({
      presentedHash: first,
      newHash: next,
      now: T1,
      idleExpiresAt: IDLE,
    });

    const replay = await store.authSessions.rotate({
      presentedHash: first,
      newHash: hash('c'),
      now: T1,
      idleExpiresAt: IDLE,
    });
    expect(replay.kind).toBe('reused');
    expect((await store.authSessions.get(session.id))?.revokedReason).toBe('refresh_reuse');

    // The legitimate successor is dead too: whoever renews second loses both.
    const successor = await store.authSessions.rotate({
      presentedHash: next,
      newHash: hash('c'),
      now: T1,
      idleExpiresAt: IDLE,
    });
    expect(successor.kind).toBe('revoked');
  });

  it('two concurrent renewals with one token: exactly one rotates, and the session ends', async () => {
    const first = hash('d');
    const { session } = await openSession(first);
    const [a, b] = await Promise.all([
      store.authSessions.rotate({
        presentedHash: first,
        newHash: hash('d'),
        now: T1,
        idleExpiresAt: IDLE,
      }),
      store.authSessions.rotate({
        presentedHash: first,
        newHash: hash('d'),
        now: T1,
        idleExpiresAt: IDLE,
      }),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(['reused', 'rotated']);
    expect((await store.authSessions.get(session.id))?.revokedReason).toBe('refresh_reuse');
  });

  it('refuses past the idle deadline and revokes', async () => {
    const first = hash('e');
    const { session } = await openSession(first);
    const outcome = await store.authSessions.rotate({
      presentedHash: first,
      newHash: hash('e'),
      now: IDLE,
      idleExpiresAt: ABSOLUTE,
    });
    expect(outcome.kind).toBe('idle_expired');
    expect((await store.authSessions.get(session.id))?.revokedReason).toBe('idle_expired');
  });

  it('refuses past the absolute deadline even when recently active', async () => {
    const first = hash('f');
    const { session } = await store.authSessions.open({
      subject: 'local:0192-bbbb',
      providerId: 'local',
      amr: ['pwd', 'otp'],
      tokenHash: first,
      now: T0,
      idleExpiresAt: '2099-01-01T00:00:00.000Z',
      absoluteExpiresAt: T1,
    });
    const outcome = await store.authSessions.rotate({
      presentedHash: first,
      newHash: hash('f'),
      now: T1,
      idleExpiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(outcome.kind).toBe('absolute_expired');
    expect((await store.authSessions.get(session.id))?.revokedReason).toBe('absolute_expired');
  });

  it('a revoked session keeps its first reason and renews nothing', async () => {
    const first = hash('g');
    const { session } = await openSession(first);
    await store.authSessions.revoke(session.id, 'signed_out', T1);
    await store.authSessions.revoke(session.id, 'account_unavailable', T1);
    expect((await store.authSessions.get(session.id))?.revokedReason).toBe('signed_out');
    const outcome = await store.authSessions.rotate({
      presentedHash: first,
      newHash: hash('g'),
      now: T1,
      idleExpiresAt: IDLE,
    });
    expect(outcome.kind).toBe('revoked');
  });

  it('revokeAllForSubject ends every live session of that subject only, keeping first reasons (W0-P29)', async () => {
    const other = await store.authSessions.open({
      subject: 'local:0192-bbbb',
      providerId: 'local',
      amr: ['pwd'],
      tokenHash: hash('other'),
      now: T0,
      idleExpiresAt: IDLE,
      absoluteExpiresAt: ABSOLUTE,
    });
    const live = await openSession(hash('h'));
    const signedOut = await openSession(hash('h'));
    await store.authSessions.revoke(signedOut.session.id, 'signed_out', T1);

    const ended = await store.authSessions.revokeAllForSubject(
      'local:0192-aaaa',
      'credential_reset',
      T1,
    );
    expect(ended).toBeGreaterThanOrEqual(1);
    expect((await store.authSessions.get(live.session.id))?.revokedReason).toBe('credential_reset');
    expect((await store.authSessions.get(signedOut.session.id))?.revokedReason).toBe('signed_out');
    expect((await store.authSessions.get(other.session.id))?.revokedAt).toBeNull();
    expect(
      await store.authSessions.revokeAllForSubject('local:0192-aaaa', 'credential_reset', T1),
    ).toBe(0);
  });

  it('an unknown token is unknown, and changes nothing', async () => {
    const outcome = await store.authSessions.rotate({
      presentedHash: hash('nobody'),
      newHash: hash('nobody'),
      now: T1,
      idleExpiresAt: IDLE,
    });
    expect(outcome).toEqual({ kind: 'unknown' });
  });
});
