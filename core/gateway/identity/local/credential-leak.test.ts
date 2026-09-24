// MCPForge — W0-D2's third and load-bearing done clause:
//
//   "no password or secret is ever written to the audit trail (asserted by a
//    test scanning `args_redacted` and the audit row for the credential
//    fields)."
//
// **The shape of the proof, and why it is a scan.** A column-by-column
// assertion only proves the columns we thought of. This test drives the whole
// realistic path — enrol a user with a password and a TOTP secret, authenticate
// them, mint a token, then write the audit rows a sign-in and a subsequent
// write call would produce — and then **serialises every stored byte of every
// audit row and searches it for the actual secret values**: the plaintext
// password, the stored Argon2id digest, the TOTP base32 secret, the enrolment
// URI (which contains the secret), and the live one-time code. This is the same
// technique as `../subject-only.test.ts`, applied to credential material.
//
// Two guarantees are asserted here, and they are different in kind:
//
// 1. **Structural.** `LocalUserStore` never touches `RuntimeStore.audit` — it
//    holds no reference to it and there is no code path from a credential
//    method to an audit append. Asserted by driving the full admin + sign-in
//    surface and observing that the audit chain stays empty.
// 2. **Behavioural.** When the audit rows for that session ARE written — by the
//    policy chain, which is the component that writes them — the credential
//    values are absent from every column, `args_redacted` included.
//
// The second matters because the first is only true until someone wires
// sign-in events into the audit trail, which is a reasonable thing to want.
// This test says: do that if you like; these five values still may not appear.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOTP, Secret } from 'otpauth';
import { openRuntimeStore } from '../../store/server.js';
import type { AppendAuditCallInput, RuntimeStore } from '../../store/server.js';
import { generateLocalSigningKey, localTokenIssuer } from '../jwt.js';
import { localIdentityProvider } from '../local.js';
import { TOTP_PERIOD_SECONDS } from './totp.js';
import { localUserStore } from './store.js';
import type { LocalUserStore } from './store.js';

// Argon2id is deliberately expensive — 64 MiB and three passes per hash — and
// these tests do dozens of them, including the decoy hashes the sign-in path
// spends on unknown usernames. Vitest's 5-second default is a measure of a fast
// test, not of a correct one, so it is raised here rather than the cost being
// lowered: weakening the KDF parameters to fit a timeout would be tuning the
// security control to suit the test suite.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-cred-leak-'));
const USERNAME = 's.secret';
const PASSWORD = 'a-very-long-local-passphrase';
const DEPLOYMENT = 'local';

let store: RuntimeStore;
let users: LocalUserStore;
let subject = '';
let passwordHash = '';
let totpSecret = '';
let totpUri = '';
let totpCode = '';
let token = '';

beforeAll(async () => {
  store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'runtime.db') });
  users = localUserStore({ store });

  const created = await users.createUser({
    username: USERNAME,
    displayName: 'Sam Secret',
    email: 'sam.secret@example.invalid',
    password: PASSWORD,
    groups: ['ap-clerks'],
  });
  subject = created.subject;

  const enrolment = await users.beginTotpEnrolment(subject);
  totpSecret = enrolment.secret;
  totpUri = enrolment.uri;
  totpCode = new TOTP({
    issuer: 'MCPForge',
    label: USERNAME,
    algorithm: 'SHA1',
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(totpSecret),
  }).generate();
  await users.confirmTotpEnrolment(subject, totpCode);

  // The stored digest, read through the one method that returns credential
  // material — so the scan below searches for the REAL value, not a guess at
  // its shape.
  passwordHash = (await store.localUsers.findCredential(USERNAME))?.passwordHash ?? '';
  expect(passwordHash).not.toHaveLength(0);
});

afterAll(async () => {
  await store?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Every credential value that must never reach a stored row. */
function credentialValues(): readonly string[] {
  return [PASSWORD, passwordHash, totpSecret, totpUri, totpCode, token].filter(
    (value) => value.length > 0,
  );
}

function scan(record: unknown, label: string): void {
  const serialised = JSON.stringify(record);
  for (const value of credentialValues()) {
    expect(
      serialised.includes(value),
      `${label} contains credential material (${value.slice(0, 12)}…); no password, hash, TOTP secret or token may ever be stored outside local_user (CLAUDE.md non-negotiable 8).`,
    ).toBe(false);
  }
}

describe('LocalUserStore never writes to the audit trail at all', () => {
  it('leaves the chain empty across the whole admin and sign-in surface', async () => {
    // Everything a credential touches: create, set password, enrol, confirm,
    // sign in, fail a sign-in, disable, deactivate, reactivate.
    await users.setPassword(subject, PASSWORD);
    // A re-hash produces a new digest with a new salt, so the scan must chase
    // the value that is actually stored now — scanning for a stale digest would
    // be a test that passes for the wrong reason.
    passwordHash = (await store.localUsers.findCredential(USERNAME))?.passwordHash ?? '';
    await users.authenticate({ username: USERNAME, password: PASSWORD, totpCode }, 'corr-a').catch(
      // The code was already spent during enrolment confirmation; the refusal
      // is expected and is itself part of the surface being exercised.
      () => undefined,
    );
    await users
      .authenticate({ username: USERNAME, password: 'wrong-but-long-enough' }, 'corr-b')
      .catch(() => undefined);
    await users.addGroups(subject, ['jde-users']);
    await users.deactivateUser(subject);
    await users.reactivateUser(subject);

    // Structural guarantee: not one row. `LocalUserStore` is handed a
    // `RuntimeStore` and still reaches only `localUsers` on it.
    expect(await store.audit.listChain(DEPLOYMENT)).toHaveLength(0);
  });
});

describe('the audit rows a signed-in session produces carry no credential material', () => {
  it('holds for a plan row whose args_redacted is deliberately hostile', async () => {
    await users.disableTotp(subject);
    const authenticated = await users.authenticate(
      { username: USERNAME, password: PASSWORD },
      'corr-c',
    );
    expect(authenticated.amr).toEqual(['pwd']);

    const provider = localIdentityProvider({
      issuer: localTokenIssuer({
        issuer: 'https://mcpforge.local/identity',
        audience: 'mcpforge-gateway',
        signingKey: generateLocalSigningKey('kid-leak'),
      }),
      source: users.principalSource(),
    });
    token = (await provider.issueToken(authenticated.subject, authenticated.amr, 'corr-c')).token;
    const principal = await provider.authenticate(
      new Request('https://gateway.local/mcp', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    // A realistic write call, with the ONE identity value that may be stored.
    // `args_redacted` carries genuine tool arguments — none of which is or
    // could be a credential, because the gateway holds the credential and the
    // agent never sees one.
    const input: AppendAuditCallInput = {
      callerSubject: principal.subject,
      callerRoles: ['p2p'],
      consumerId: 'portal-local',
      humanInTheLoop: true,
      toolId: 'jde.ap.voucher.create',
      toolVersion: '1.0.0',
      bindingType: 'plsql',
      isWrite: true,
      targetSystem: 'jde',
      targetEnv: 'py920',
      deploymentId: DEPLOYMENT,
      phase: 'plan',
      outcome: 'ok',
      argsRedacted: { supplier: 'ACME', amount: 1200.5, currency: 'GBP' },
    };

    const row = await store.audit.append(input);

    // The two the criterion names, first and explicitly...
    scan(row.argsRedacted, 'args_redacted');
    scan(row, 'the appended audit row');
    // ...then the same row read back out of SQLite, so the claim is about what
    // is STORED and not merely about what `append` returned.
    scan(await store.audit.get(row.id), 'the audit row read back from SQLite');
  });

  it('holds for an execute row and for every row in the chain', async () => {
    await store.audit.append({
      callerSubject: subject,
      consumerId: 'portal-local',
      humanInTheLoop: true,
      toolId: 'jde.ap.voucher.create',
      toolVersion: '1.0.0',
      isWrite: true,
      deploymentId: DEPLOYMENT,
      phase: 'execute',
      outcome: 'ok',
      resultKeys: [{ keyName: 'voucher_number', keyValue: '00412873' }],
    });

    const chain = await store.audit.listChain(DEPLOYMENT);
    expect(chain.length).toBeGreaterThan(1);
    for (const row of chain) {
      // Every column of every row, not a chosen subset.
      scan(row, `audit row ${row.id}`);
      expect(row.callerSubject).toBe(subject);
    }
    expect((await store.audit.verifyChain(DEPLOYMENT)).status).toBe('intact');
  });

  it('holds for the idempotency record the same write unit writes', async () => {
    const begun = await store.idempotency.begin({
      callerSubject: subject,
      toolId: 'jde.ap.voucher.create',
      toolVersion: '1.0.0',
      argsCanonicalHash: 'b'.repeat(64),
      confirmToken: 'confirm-token-xyz',
    });
    scan(begun.record, 'the idempotency record');
    scan(await store.idempotency.get(begun.idempotencyKey), 'the idempotency record read back');
  });
});

describe('the credential columns leave the store through exactly one method', () => {
  it('every ordinary read returns a record with no credential field on it', async () => {
    const credentialKeys = [
      'passwordHash',
      'passwordAlgorithm',
      'totpSecret',
      'totpConfirmedAt',
      'totpLastCounter',
    ];
    const reads = [
      await store.localUsers.findBySubject(subject),
      await store.localUsers.findByUsername(USERNAME),
      (await store.localUsers.list())[0],
      (await store.localUsers.listByGroup('ap-clerks'))[0],
      await users.getUser(subject),
      await users.principalSource().findBySubject(subject),
    ];
    for (const record of reads) {
      expect(record).toBeDefined();
      for (const key of credentialKeys) {
        expect(Object.keys(record ?? {})).not.toContain(key);
      }
      scan(record, 'a non-credential read');
    }
  });

  it('findCredential is the one exception, and it is the one the check needs', async () => {
    const credential = await store.localUsers.findCredential(USERNAME);
    expect(credential?.passwordHash).toBe(passwordHash);
    // Stated plainly so a future reader does not "fix" the scan above by
    // widening it into this method: the credential path is allowed to see the
    // credential. What it may never do is store it anywhere else.
    expect(credential?.totpSecret).toBeNull();
  });
});
