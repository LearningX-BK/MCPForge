// MCPForge — W0-D2's first two done clauses:
//
//   "users can be created, authenticated and assigned groups; passwords are
//    Argon2id with per-user salts"
//
// Run against the real SQLite runtime store, through `LocalUserStore`'s public
// surface only — no direct SQL, no reaching into the repository — so what is
// proved here is what a caller can actually do.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOTP, Secret } from 'otpauth';
import { openRuntimeStore } from '../../store/server.js';
import type { RuntimeStore } from '../../store/server.js';
import { generateLocalSigningKey, localTokenIssuer } from '../jwt.js';
import { localIdentityProvider } from '../local.js';
import {
  ARGON2_ITERATIONS,
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
} from './password.js';
import { TOTP_PERIOD_SECONDS, verifyTotp } from './totp.js';
import { LOCAL_SUBJECT_PREFIX, localUserStore } from './store.js';
import type { LocalUserStore } from './store.js';

// Argon2id is deliberately expensive — 64 MiB and three passes per hash — and
// these tests do dozens of them, including the decoy hashes the sign-in path
// spends on unknown usernames. Vitest's 5-second default is a measure of a fast
// test, not of a correct one, so it is raised here rather than the cost being
// lowered: weakening the KDF parameters to fit a timeout would be tuning the
// security control to suit the test suite.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-local-users-'));
const PASSWORD = 'correct-horse-battery-staple';
const OTHER_PASSWORD = 'a-different-long-passphrase';

let store: RuntimeStore;
let users: LocalUserStore;

beforeAll(async () => {
  store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'runtime.db') });
  users = localUserStore({ store });
});

afterAll(async () => {
  await store?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('admin CRUD', () => {
  it('creates a user with an opaque subject, a folded username and groups', async () => {
    const created = await users.createUser({
      username: 'A.Okonkwo',
      displayName: 'Alice Okonkwo',
      email: 'alice.okonkwo@example.invalid',
      password: PASSWORD,
      groups: ['ap-clerks', 'jde-users'],
    });

    expect(created.subject.startsWith(LOCAL_SUBJECT_PREFIX)).toBe(true);
    // The subject is NOT the username: renaming a person must not rewrite
    // their audit history (02 §4.4).
    expect(created.subject).not.toContain('okonkwo');
    expect(created.username).toBe('a.okonkwo');
    expect(created.groups).toEqual(['ap-clerks', 'jde-users']);
    expect(created.active).toBe(true);
    expect(created.totpEnrolled).toBe(false);
  });

  it('refuses a second account on the same username, in any case', async () => {
    const error = await users
      .createUser({ username: 'a.OKONKWO', displayName: 'Impostor', password: PASSWORD })
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe('INPUT_INVALID');
    // Non-negotiable 5: no dead ends.
    expect((error as { next?: string }).next ?? '').not.toHaveLength(0);
  });

  it('refuses a password below the length floor, without echoing it', async () => {
    const error = await users
      .createUser({ username: 'too.short', displayName: 'Short', password: 'hunter2xy' })
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe('INPUT_INVALID');
    // The rejected password is never echoed back — not in the message, not in
    // the condition, not in `next`. A refusal that quotes the credential puts
    // it in whatever log catches the error.
    expect(JSON.stringify(error)).not.toContain('hunter2xy');
    expect((error as { message?: string }).message).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it('updates the profile and reassigns groups', async () => {
    const user = await users.getUserByUsername('a.okonkwo');
    const subject = user?.subject ?? '';

    const renamed = await users.updateUser(subject, { displayName: 'Alice Okonkwo-Barrett' });
    expect(renamed.displayName).toBe('Alice Okonkwo-Barrett');
    // The subject survives the rename, which is the whole point of it.
    expect(renamed.subject).toBe(subject);

    expect((await users.addGroups(subject, ['ap-approvers'])).groups).toEqual([
      'ap-approvers',
      'ap-clerks',
      'jde-users',
    ]);
    expect((await users.addGroups(subject, ['ap-clerks'])).groups).toHaveLength(3);
    expect((await users.removeGroups(subject, ['ap-approvers'])).groups).toEqual([
      'ap-clerks',
      'jde-users',
    ]);
    expect((await users.setGroups(subject, ['r2r-analysts'])).groups).toEqual(['r2r-analysts']);
    await users.setGroups(subject, ['ap-clerks', 'jde-users']);

    expect((await users.listGroupMembers('ap-clerks')).map((u) => u.subject)).toEqual([subject]);
  });

  it('deactivates in place — the subject stays resolvable, sign-in does not', async () => {
    const created = await users.createUser({
      username: 'r.leaver',
      displayName: 'Rita Leaver',
      password: PASSWORD,
    });

    const deactivated = await users.deactivateUser(created.subject);
    expect(deactivated.active).toBe(false);
    // Still there, by design: an audit row seven years old must still be able
    // to name its actor. There is no hard delete on this store.
    expect(await users.getUser(created.subject)).toMatchObject({ subject: created.subject });
    expect((await users.listUsers()).map((u) => u.username)).not.toContain('r.leaver');
    expect((await users.listUsers({ includeInactive: true })).map((u) => u.username)).toContain(
      'r.leaver',
    );

    const source = users.principalSource();
    expect(await source.findBySubject(created.subject)).toBeUndefined();
    expect((await users.reactivateUser(created.subject)).active).toBe(true);
    expect(await source.findBySubject(created.subject)).toMatchObject({
      displayName: 'Rita Leaver',
    });
    await users.deactivateUser(created.subject);
  });
});

describe('passwords are Argon2id with per-user salts', () => {
  it('stores a PHC digest naming argon2id and the declared cost parameters', async () => {
    const user = await users.getUserByUsername('a.okonkwo');
    const credential = await store.localUsers.findCredential('a.okonkwo');
    expect(credential?.subject).toBe(user?.subject);
    expect(credential?.passwordAlgorithm).toBe('argon2id');

    const phc = credential?.passwordHash ?? '';
    expect(phc.startsWith('$argon2id$')).toBe(true);
    expect(phc).toContain(`m=${ARGON2_MEMORY_KIB}`);
    expect(phc).toContain(`t=${ARGON2_ITERATIONS}`);
    expect(phc).toContain(`p=${ARGON2_PARALLELISM}`);
    // The password itself is nowhere in what was stored.
    expect(phc).not.toContain(PASSWORD);
  });

  it('gives two users who chose the identical password two unrelated digests', async () => {
    // THE per-user-salt assertion. Deterministic hashing would make these two
    // strings equal, and one cracked digest would then be two accounts.
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).not.toBe(b);
    // The salt segment is the fourth field of the PHC string.
    expect(a.split('$')[4]).not.toBe(b.split('$')[4]);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword(PASSWORD, b)).toBe(true);
    expect(await verifyPassword(OTHER_PASSWORD, a)).toBe(false);
  });

  it('treats a corrupted digest as a failed verification, never as an exception', async () => {
    expect(await verifyPassword(PASSWORD, 'not-a-phc-string')).toBe(false);
    expect(await verifyPassword(PASSWORD, '')).toBe(false);
  });
});

describe('authentication', () => {
  it('authenticates a password-only account and reports amr = [pwd]', async () => {
    const result = await users.authenticate(
      { username: 'A.Okonkwo', password: PASSWORD },
      'corr-auth-1',
    );
    const user = await users.getUserByUsername('a.okonkwo');
    expect(result.subject).toBe(user?.subject);
    // `otp` is absent because no code was checked. An amr asserting a factor
    // nobody verified would be a lie recorded in the audit trail.
    expect(result.amr).toEqual(['pwd']);
    expect((await users.getUser(result.subject))?.failedAttempts).toBe(0);
  });

  it('refuses a wrong password with AUTH_REQUIRED and counts the failure', async () => {
    const before = await users.getUserByUsername('a.okonkwo');
    const error = await users
      .authenticate({ username: 'a.okonkwo', password: OTHER_PASSWORD }, 'corr-auth-2')
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe('AUTH_REQUIRED');
    expect((error as { next?: string }).next ?? '').not.toHaveLength(0);
    // The refusal never names the password, the username's existence, or the hash.
    expect(JSON.stringify(error)).not.toContain(OTHER_PASSWORD);

    const after = await users.getUser(before?.subject ?? '');
    expect(after?.failedAttempts).toBe(1);

    // A later good password clears the counter.
    await users.authenticate({ username: 'a.okonkwo', password: PASSWORD }, 'corr-auth-3');
    expect((await users.getUser(before?.subject ?? ''))?.failedAttempts).toBe(0);
  });

  it('refuses an unknown username with the identical refusal', async () => {
    const unknown = await users
      .authenticate({ username: 'nobody.here', password: PASSWORD }, 'corr-auth-4')
      .catch((e: unknown) => e);
    const wrong = await users
      .authenticate({ username: 'a.okonkwo', password: OTHER_PASSWORD }, 'corr-auth-5')
      .catch((e: unknown) => e);
    // Byte-identical, so sign-in is not a "does this account exist" oracle.
    expect((unknown as { message?: string }).message).toBe((wrong as { message?: string }).message);
    expect((unknown as { code?: string }).code).toBe((wrong as { code?: string }).code);
    await users.authenticate({ username: 'a.okonkwo', password: PASSWORD }, 'corr-auth-6');
  });

  it('refuses a deactivated account even with the right password', async () => {
    const created = await users.createUser({
      username: 'd.gone',
      displayName: 'Dana Gone',
      password: PASSWORD,
    });
    await users.deactivateUser(created.subject);
    const error = await users
      .authenticate({ username: 'd.gone', password: PASSWORD }, 'corr-auth-7')
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe('AUTH_REQUIRED');
  });

  it('locks an account after the threshold and refuses the right password while locked', async () => {
    const created = await users.createUser({
      username: 'l.locked',
      displayName: 'Lee Locked',
      password: PASSWORD,
    });
    const guessy = localUserStore({ store, lockoutThreshold: 3, lockoutSeconds: 900 });
    for (let i = 0; i < 3; i += 1) {
      await guessy
        .authenticate({ username: 'l.locked', password: OTHER_PASSWORD }, `corr-lock-${i}`)
        .catch(() => undefined);
    }
    const locked = await guessy.getUser(created.subject);
    expect(locked?.failedAttempts).toBe(3);
    expect(locked?.lockedUntil).not.toBeNull();

    const error = await guessy
      .authenticate({ username: 'l.locked', password: PASSWORD }, 'corr-lock-good')
      .catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe('AUTH_REQUIRED');

    // Setting a password clears the lockout — the guessed credential is gone,
    // so continuing to punish would only deny the person their own recovery.
    await guessy.setPassword(created.subject, OTHER_PASSWORD);
    const recovered = await guessy.getUser(created.subject);
    expect(recovered?.lockedUntil).toBeNull();
    expect(
      (await guessy.authenticate({ username: 'l.locked', password: OTHER_PASSWORD }, 'corr-ok'))
        .amr,
    ).toEqual(['pwd']);
  });
});

describe('optional TOTP — some accounts have it, some do not', () => {
  const label = 't.enrolled';
  let subject = '';
  let secret = '';
  let confirmingCode = '';
  let confirmedAtMs = 0;
  let signedInAtMs = 0;

  function codeFor(atMs: number): string {
    return new TOTP({
      issuer: 'MCPForge',
      label,
      algorithm: 'SHA1',
      digits: 6,
      period: TOTP_PERIOD_SECONDS,
      secret: Secret.fromBase32(secret),
    }).generate({ timestamp: atMs });
  }

  it('enrols a secret that is not a second factor until a live code proves it', async () => {
    const created = await users.createUser({
      username: label,
      displayName: 'Tomas Enrolled',
      password: PASSWORD,
    });
    subject = created.subject;

    const enrolment = await users.beginTotpEnrolment(subject);
    secret = enrolment.secret;
    expect(enrolment.uri.startsWith('otpauth://totp/')).toBe(true);
    expect(secret).toHaveLength(32);

    // Unconfirmed: sign-in must NOT yet demand a code, or a mistyped enrolment
    // would lock the account out of its own second factor.
    expect((await users.getUser(subject))?.totpEnrolled).toBe(false);
    expect(
      (await users.authenticate({ username: label, password: PASSWORD }, 'corr-t1')).amr,
    ).toEqual(['pwd']);

    confirmedAtMs = Date.now();
    confirmingCode = codeFor(confirmedAtMs);
    const confirmed = await users.confirmTotpEnrolment(subject, confirmingCode);
    expect(confirmed.totpEnrolled).toBe(true);
  });

  it('spends the confirming code, so it cannot also buy the first sign-in', async () => {
    // The code that proved the enrolment is a code that has been used. Leaving
    // the replay guard unset at confirmation time would leave it live for the
    // rest of its window — a real, if brief, second-factor bypass.
    const reused = await users
      .authenticate({ username: label, password: PASSWORD, totpCode: confirmingCode }, 'corr-t1b')
      .catch((e: unknown) => e);
    expect((reused as { code?: string }).code).toBe('AUTH_REQUIRED');
  });

  it('now requires the code, and reports amr = [pwd, otp]', async () => {
    const missing = await users
      .authenticate({ username: label, password: PASSWORD }, 'corr-t2')
      .catch((e: unknown) => e);
    expect((missing as { code?: string }).code).toBe('AUTH_REQUIRED');

    const wrong = await users
      .authenticate({ username: label, password: PASSWORD, totpCode: '000000' }, 'corr-t3')
      .catch((e: unknown) => e);
    expect((wrong as { code?: string }).code).toBe('AUTH_REQUIRED');

    // A code from the step AFTER the one the confirmation spent.
    signedInAtMs = confirmedAtMs + TOTP_PERIOD_SECONDS * 1000;
    const clocked = localUserStore({ store, now: () => new Date(signedInAtMs) });
    const result = await clocked.authenticate(
      { username: label, password: PASSWORD, totpCode: codeFor(signedInAtMs) },
      'corr-t4',
    );
    expect(result.subject).toBe(subject);
    expect(result.amr).toEqual(['pwd', 'otp']);
  });

  it('refuses a replay of a code that already verified, inside its own window', async () => {
    // The code is still cryptographically valid here — it is refused because
    // its counter was spent, which is what `totp_last_counter` is for.
    const atSignIn = localUserStore({ store, now: () => new Date(signedInAtMs) });
    const replayed = await atSignIn
      .authenticate(
        { username: label, password: PASSWORD, totpCode: codeFor(signedInAtMs) },
        'corr-t5',
      )
      .catch((e: unknown) => e);
    expect((replayed as { code?: string }).code).toBe('AUTH_REQUIRED');

    // The next step's code works, so this is a replay refusal and not a
    // wholesale lockout of the factor.
    const later = signedInAtMs + TOTP_PERIOD_SECONDS * 1000;
    const clocked = localUserStore({ store, now: () => new Date(later) });
    expect(
      (
        await clocked.authenticate(
          { username: label, password: PASSWORD, totpCode: codeFor(later) },
          'corr-t6',
        )
      ).amr,
    ).toEqual(['pwd', 'otp']);
  });

  it('drops back to password-only when TOTP is disabled', async () => {
    expect((await users.disableTotp(subject)).totpEnrolled).toBe(false);
    expect(
      (await users.authenticate({ username: label, password: PASSWORD }, 'corr-t7')).amr,
    ).toEqual(['pwd']);
  });

  it('rejects a malformed code without consulting the secret', () => {
    for (const code of ['', 'abcdef', '12345', '1234567']) {
      expect(verifyTotp({ secretBase32: secret, code, accountLabel: label }).ok).toBe(false);
    }
  });
});

describe('the W0-D1 seam', () => {
  it('feeds the identity provider, which mints a token carrying the amr that ran', async () => {
    // The whole realistic path: credentials in, `{subject, amr}` out, token
    // minted by W0-D1 from that amr, `Principal` verified back out of it.
    const authenticated = await users.authenticate(
      { username: 'a.okonkwo', password: PASSWORD },
      'corr-seam',
    );
    const provider = localIdentityProvider({
      issuer: localTokenIssuer({
        issuer: 'https://mcpforge.local/identity',
        audience: 'mcpforge-gateway',
        signingKey: generateLocalSigningKey('kid-test'),
      }),
      source: users.principalSource(),
    });
    const issued = await provider.issueToken(authenticated.subject, authenticated.amr, 'corr-seam');
    const principal = await provider.authenticate(
      new Request('https://gateway.local/mcp', {
        headers: { authorization: `Bearer ${issued.token}` },
      }),
    );
    expect(principal.subject).toBe(authenticated.subject);
    expect(principal.amr).toEqual(['pwd']);
    expect(await provider.resolveGroups(principal)).toEqual(['ap-clerks', 'jde-users']);
  });

  it('hands the provider a record with no credential field on it at all', async () => {
    const record = await users
      .principalSource()
      .findBySubject((await users.getUserByUsername('a.okonkwo'))?.subject ?? '');
    // `LocalPrincipalRecord` is four fields. The assertion is on the KEYS, not
    // on the values, so a credential column added to `LocalUserRecord` later
    // and spread through by accident fails here.
    expect(Object.keys(record ?? {}).sort()).toEqual(['displayName', 'email', 'groups', 'subject']);
  });
});
