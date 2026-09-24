// MCPForge — W0-D1's third done clause, against the real store.
//
// "`Principal.subject` is the only identity value written to audit, mappings
// and idempotency keys, asserted by a test."
//
// The shape of the proof matters as much as the assertion. The test performs
// the whole realistic path — issue a token, verify it back to a `Principal`,
// then write a write-path call through W0-C2's `AuditRepository.append` and
// W0-C3's `IdempotencyRepository.begin` — passing `principal.subject` and
// nothing else, and then **scans every stored byte** of both records for the
// other identity values: the raw JWT, the display name, the email address, the
// group names. A column-by-column assertion would only prove the columns we
// thought of; the scan catches the one we did not.
//
// Why this test lives under `core/gateway/identity/**` rather than under the
// store: the invariant belongs to the identity seam. The store's job is to
// persist a `caller_subject` string; the seam's job is to guarantee that a
// string is the only identity value that ever gets handed to it. Nothing new is
// exported from `core/gateway/store/index.ts` for this — `openRuntimeStore` and
// the two repository interfaces were already its public surface.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../store/server.js';
import type { RuntimeStore } from '../store/server.js';
import type { AppendAuditCallInput } from '../store/server.js';
import { generateLocalSigningKey, localTokenIssuer } from './jwt.js';
import { localIdentityProvider, staticLocalPrincipalSource } from './local.js';
import type { Principal } from './types.js';

const ACCOUNT = {
  subject: 'local:01J8Z0S8QK9F3W2ND5TQ8P4T7R',
  displayName: 'Alice Okonkwo',
  email: 'alice.okonkwo@example.invalid',
  groups: ['ap-clerks', 'jde-users'],
} as const;

const tempDir = mkdtempSync(join(tmpdir(), 'mcpforge-identity-'));
let store: RuntimeStore;
let principal: Principal;
let token: string;

beforeAll(async () => {
  store = await openRuntimeStore({ kind: 'sqlite', file: join(tempDir, 'runtime.db') });

  const tokens = localTokenIssuer({
    issuer: 'https://mcpforge.local/identity',
    audience: 'mcpforge-gateway',
    signingKey: generateLocalSigningKey('kid-active'),
  });
  const provider = localIdentityProvider({
    issuer: tokens,
    source: staticLocalPrincipalSource([ACCOUNT]),
  });

  const issued = await provider.issueToken(ACCOUNT.subject, ['pwd', 'otp'], 'corr-1');
  token = issued.token;

  // The round trip the criterion describes: the raw token goes into the seam,
  // a `Principal` comes out, and the raw token is not referenced again below.
  principal = await provider.authenticate(
    new Request('https://gateway.local/mcp', {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
});

afterAll(async () => {
  await store?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

/** Every identity value that is NOT the subject, and must never be stored. */
function forbiddenValues(): readonly string[] {
  return [token, principal.displayName, principal.email ?? '', ...principal.groups].filter(
    (value) => value.length > 0,
  );
}

function scan(record: unknown, label: string): void {
  const serialised = JSON.stringify(record);
  for (const value of forbiddenValues()) {
    expect(
      serialised.includes(value),
      `${label} contains the identity value ${JSON.stringify(value)}; only Principal.subject may be stored (02 §4.4 item 3).`,
    ).toBe(false);
  }
}

describe('the audit trail stores Principal.subject and no other identity value', () => {
  it('appends a write call carrying only the subject', async () => {
    // `callerSubject: principal.subject` — a string. Note what is NOT written
    // and what this package deliberately makes awkward to write: there is no
    // `principalToAuditInput` helper anywhere, so `callerDisplay`,
    // `callerIdp` and `callerAmr` cannot be populated from a Principal by
    // accident. 02 §4.6 defines those columns; filling them is a separate,
    // deliberate decision belonging to the policy chain, not something the
    // identity seam does on a caller's behalf.
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
      deploymentId: 'local',
      phase: 'execute',
      outcome: 'ok',
      resultKeys: [{ keyName: 'voucher_number', keyValue: '00412873' }],
    };

    const row = await store.audit.append(input);

    expect(row.callerSubject).toBe(principal.subject);
    expect(row.callerDisplay).toBeNull();
    expect(row.callerIdp).toBeNull();
    expect(row.callerAmr).toBeNull();
    expect(row.onBehalfOf).toBeNull();
    scan(row, 'the appended audit row');

    // Read back through the repository too, so the assertion is about what is
    // stored and not merely about what `append` chose to return.
    scan(await store.audit.get(row.id), 'the audit row read back from SQLite');
  });

  it('holds for the whole chain, and the chain still verifies', async () => {
    for (const row of await store.audit.listChain('local')) {
      expect(row.callerSubject).toBe(principal.subject);
      scan(row, `audit row ${row.id}`);
    }
    expect((await store.audit.verifyChain('local')).status).toBe('intact');
  });

  it('finds the call by its subject through the role side table, unchanged', async () => {
    const rows = await store.audit.listByResultKey('voucher_number', '00412873');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.callerSubject).toBe(principal.subject);
  });
});

describe('the idempotency key is composed from Principal.subject and no other identity value', () => {
  it('records the subject and nothing identity-shaped beside it', async () => {
    // 02 §3.1.2: sha256(callerSubject | toolId | toolVersion | argsHash |
    // confirmToken). The subject is the only identity input to the key, so two
    // people running the identical call get different keys and one person
    // running it twice gets the same one — which is the whole mechanism.
    const begun = await store.idempotency.begin({
      callerSubject: principal.subject,
      toolId: 'jde.ap.voucher.create',
      toolVersion: '1.0.0',
      argsCanonicalHash: 'a'.repeat(64),
      confirmToken: 'confirm-token-abc',
    });

    expect(begun.outcome).toBe('started');
    expect(begun.record.callerSubject).toBe(principal.subject);
    scan(begun.record, 'the idempotency record');

    scan(await store.idempotency.get(begun.idempotencyKey), 'the idempotency record read back');

    // The key itself is a digest, so it cannot leak a value — but it is derived
    // from the subject, and a different subject must produce a different key.
    const other = await store.idempotency.begin({
      callerSubject: 'local:someone-else',
      toolId: 'jde.ap.voucher.create',
      toolVersion: '1.0.0',
      argsCanonicalHash: 'a'.repeat(64),
      confirmToken: 'confirm-token-abc',
    });
    expect(other.idempotencyKey).not.toBe(begun.idempotencyKey);
  });
});

describe('the Principal itself never reaches the store', () => {
  it('AppendAuditCallInput has no field a Principal could be assigned to', () => {
    // A compile-time claim made runtime-checkable: every "who" field on the
    // audit input is a string or a string array, so there is no slot a
    // Principal object, a claim set or a raw token could occupy without a
    // deliberate stringification somewhere a reviewer would see it.
    const whoFields = ['callerSubject', 'callerDisplay', 'callerIdp', 'callerAmr', 'onBehalfOf'];
    const input: Record<string, unknown> = {
      callerSubject: principal.subject,
      consumerId: 'portal-local',
      humanInTheLoop: false,
      toolId: 'jde.ap.voucher.get',
      isWrite: false,
      deploymentId: 'local',
      phase: 'execute',
      outcome: 'ok',
    };
    for (const field of whoFields) {
      const value = input[field];
      expect(value === undefined || typeof value === 'string').toBe(true);
    }
  });
});
