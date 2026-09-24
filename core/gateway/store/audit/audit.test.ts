// MCPForge — W0-C2's done criterion, clause by clause.
//
// Runs against a temp-file SQLite store, the Wave 0 default (02 §10.4 item 8).
// A few tests reach the file directly with `better-sqlite3` — legitimate only
// inside `core/gateway/store/**`, and necessary here because the whole point
// of the trigger tests is to act as a writer that is NOT going through the
// repository interface. That is exactly the tamper the triggers exist for, and
// **on SQLite it demonstrates that tampering is detectable, not preventable**
// (02 §10.4 item 1).

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRuntimeStore } from '../store.js';
import { isUuidv7 } from '../id.js';
import { AUDIT_CALL } from '../schema/spec.js';
import { AUDIT_CHAIN_GENESIS, auditRowHash, type AuditHashValue } from './hash.js';
import { POSTGRES_IMMUTABILITY_RECOMMENDATION } from './immutability.js';
import type { RuntimeStore } from '../repository.js';
import type { AppendAuditCallInput } from './types.js';

const tempDir = mkdtempSync(join(tmpdir(), 'mcpforge-audit-'));
const dbFile = join(tempDir, 'runtime.db');
let store: RuntimeStore;

beforeAll(async () => {
  store = await openRuntimeStore({ kind: 'sqlite', file: dbFile });
});

afterAll(async () => {
  await store?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

/** A realistic write call: a JD Edwards voucher creation, executed. */
function call(overrides: Partial<AppendAuditCallInput> = {}): AppendAuditCallInput {
  return {
    callerSubject: 'bikash',
    callerDisplay: 'Bikash Pattnaik',
    callerIdp: 'local',
    callerAmr: 'pwd',
    callerRoles: ['p2p'],
    consumerId: 'portal-local',
    consumerRecordSha: 'c'.repeat(64),
    consumerAuthMethod: 'client_secret',
    consumerSessionId: 'sess-1',
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
    ...overrides,
  };
}

function raw(): Database.Database {
  return new Database(dbFile);
}

describe('every column in 02 §4.6 exists (as extended by §11.3)', () => {
  // Transcribed from the document, not derived from the code — otherwise the
  // test would only prove the code agrees with itself.
  const SPEC_COLUMNS = [
    'id',
    'ts',
    'correlation_id',
    'session_id',
    'parent_call_id',
    // who
    'caller_subject',
    'caller_display',
    'caller_idp',
    'caller_amr',
    'caller_roles',
    'on_behalf_of',
    // who — Phase 5, 02 §11.3
    'consumer_id',
    'consumer_record_sha',
    'consumer_auth_method',
    'consumer_session_id',
    'human_in_the_loop',
    // what
    'tool_id',
    'tool_version',
    'manifest_sha',
    'server_id',
    'package_id',
    'binding_type',
    'archetype',
    'verb',
    'entity',
    'sensitivity_class',
    'is_write',
    // where
    'target_system',
    'target_env',
    'target_object',
    'deployment_id',
    'gateway_version',
    'bundle_version',
    // phase
    'phase',
    'confirm_token_hash',
    'plan_hash',
    'args_hash',
    'idempotency_key',
    'replayed',
    // inputs and outputs
    'args_redacted',
    'result_keys',
    'row_count',
    'bytes_out',
    // outcome
    'outcome',
    'error_code',
    'error_message_agent',
    'denied_by_rule',
    // identity honesty
    'identity_carrying',
    'target_identity_observed',
    'identity_match',
    'compensating_control',
    // reversal
    'reversal_class',
    // W0-F5 — the reversing tool id, frozen at execute time beside the class
    // (02 §3.1.4: "the gateway writes reversal_class, the reversing tool id,
    // and the extracted result_keys into the audit record").
    'reversal_tool_id',
    'reverses_call_id',
    'reversed_by_call_id',
    // performance
    'latency_ms_total',
    'latency_ms_gateway',
    'latency_ms_target',
    // integrity
    'prev_hash',
    'row_hash',
  ];

  it('the single schema definition declares exactly the documented columns', () => {
    expect(Object.keys(AUDIT_CALL.columns).sort()).toEqual([...SPEC_COLUMNS].sort());
  });

  it('the physical SQLite table has them all', () => {
    const db = raw();
    try {
      const actual = db
        .prepare(`PRAGMA table_info(${AUDIT_CALL.name})`)
        .all()
        .map((c) => (c as { name: string }).name)
        .sort();
      expect(actual).toEqual([...SPEC_COLUMNS].sort());
    } finally {
      db.close();
    }
  });

  it('round-trips every field through append and get', async () => {
    const written = await store.audit.append(
      call({
        deploymentId: 'roundtrip',
        correlationId: 'corr-1',
        sessionId: 'sess-1',
        onBehalfOf: 'someone-else',
        manifestSha: 'm'.repeat(64),
        serverId: 'jde-ap',
        packageId: 'jde-fin',
        archetype: 'transaction',
        verb: 'create',
        entity: 'voucher',
        sensitivityClass: 'financial',
        targetObject: 'MCPFORGE_WRAP.AP_VOUCHER',
        gatewayVersion: '0.0.0',
        bundleVersion: '0.0.1',
        confirmTokenHash: 'h'.repeat(64),
        planHash: 'p'.repeat(64),
        argsHash: 'a'.repeat(64),
        idempotencyKey: 'idem-1',
        replayed: false,
        argsRedacted: { supplier: '4242', amount: 100.5 },
        resultKeys: [{ keyName: 'voucher_no', keyValue: '12345' }],
        rowCount: 1,
        bytesOut: 512,
        identityCarrying: true,
        targetIdentityObserved: 'BIKASH',
        identityMatch: true,
        compensatingControl: 'wrapper_schema',
        reversalClass: 'void',
        latencyMsTotal: 120,
        latencyMsGateway: 20,
        latencyMsTarget: 100,
        credentialRefs: [{ secretRef: 'secretRef://binding/jde-ap/wrapper-schema', version: '3' }],
      }),
    );
    expect(isUuidv7(written.id)).toBe(true);
    expect(await store.audit.get(written.id)).toEqual(written);
  });
});

describe('prev_hash / row_hash chain correctly across inserts', () => {
  it('starts at the genesis sentinel and links each row to its predecessor', async () => {
    const first = await store.audit.append(call({ deploymentId: 'chain-a' }));
    const second = await store.audit.append(call({ deploymentId: 'chain-a' }));
    const third = await store.audit.append(call({ deploymentId: 'chain-a' }));

    expect(first.prevHash).toBe(AUDIT_CHAIN_GENESIS);
    expect(second.prevHash).toBe(first.rowHash);
    expect(third.prevHash).toBe(second.rowHash);
    expect(await store.audit.chainHead('chain-a')).toEqual(third);
  });

  it('re-walks intact — which is precisely what forge audit verify will do', async () => {
    for (let i = 0; i < 4; i += 1) {
      await store.audit.append(call({ deploymentId: 'chain-b', correlationId: `c-${i}` }));
    }
    const db = raw();
    try {
      const rows = db
        .prepare(`SELECT * FROM ${AUDIT_CALL.name} WHERE deployment_id = ? ORDER BY id ASC`)
        .all('chain-b') as Record<string, AuditHashValue>[];
      let expectedPrev = AUDIT_CHAIN_GENESIS;
      for (const row of rows) {
        expect(row['prev_hash']).toBe(expectedPrev);
        // Recomputed from what is ACTUALLY on disk, not from the returned record.
        expect(auditRowHash(row)).toBe(row['row_hash']);
        expectedPrev = String(row['row_hash']);
      }
      expect(rows.length).toBe(4);
    } finally {
      db.close();
    }
  });

  it('keeps deployments on independent chains (02 §4.6: per-deployment)', async () => {
    const a = await store.audit.append(call({ deploymentId: 'chain-c' }));
    const b = await store.audit.append(call({ deploymentId: 'chain-d' }));
    expect(a.prevHash).toBe(AUDIT_CHAIN_GENESIS);
    expect(b.prevHash).toBe(AUDIT_CHAIN_GENESIS);
    expect(await store.audit.chainHead('chain-c')).toEqual(a);
  });

  it('cannot fork: the database itself refuses a second row on the same predecessor', () => {
    const db = raw();
    try {
      const head = db
        .prepare(
          `SELECT * FROM ${AUDIT_CALL.name} WHERE deployment_id = ? ORDER BY id DESC LIMIT 1`,
        )
        .get('chain-a') as Record<string, unknown>;
      const clone: Record<string, unknown> = {
        ...head,
        id: '01930000-0000-7000-8000-0000000000ff',
        row_hash: 'forked',
      };
      const cols = Object.keys(clone);
      expect(() =>
        db
          .prepare(
            `INSERT INTO ${AUDIT_CALL.name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          )
          .run(cols.map((c) => clone[c])),
      ).toThrow(/UNIQUE/i);
    } finally {
      db.close();
    }
  });

  it('serialises concurrent appends rather than racing the chain head', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => store.audit.append(call({ deploymentId: 'chain-race' }))),
    );
    const byId = [...results].sort((x, y) => (x.id < y.id ? -1 : 1));
    let expectedPrev = AUDIT_CHAIN_GENESIS;
    for (const row of byId) {
      expect(row.prevHash).toBe(expectedPrev);
      expectedPrev = row.rowHash;
    }
    expect(new Set(byId.map((r) => r.rowHash)).size).toBe(12);
  });
});

describe('append-only enforcement — BEFORE UPDATE and BEFORE DELETE', () => {
  it('refuses an UPDATE with RAISE(ABORT)', async () => {
    const written = await store.audit.append(call({ deploymentId: 'triggers' }));
    const db = raw();
    try {
      expect(() =>
        db
          .prepare(`UPDATE ${AUDIT_CALL.name} SET caller_subject = 'mallory' WHERE id = ?`)
          .run(written.id),
      ).toThrow(/append-only/);
    } finally {
      db.close();
    }
  });

  it('refuses a DELETE with RAISE(ABORT)', async () => {
    const written = await store.audit.append(call({ deploymentId: 'triggers' }));
    const db = raw();
    try {
      expect(() =>
        db.prepare(`DELETE FROM ${AUDIT_CALL.name} WHERE id = ?`).run(written.id),
      ).toThrow(/append-only/);
      expect(await store.audit.get(written.id)).toBeDefined();
    } finally {
      db.close();
    }
  });

  it('protects the satellites too — their content is not covered by row_hash', async () => {
    const written = await store.audit.append(
      call({
        deploymentId: 'triggers',
        resultKeys: [{ keyName: 'voucher_no', keyValue: 'SAT-1' }],
        callerRoles: ['p2p'],
        credentialRefs: [{ secretRef: 'secretRef://binding/x/y', version: '1' }],
      }),
    );
    const db = raw();
    try {
      for (const [table, statement] of [
        ['audit_result_key', `UPDATE audit_result_key SET key_value = 'z' WHERE call_id = ?`],
        ['audit_result_key', `DELETE FROM audit_result_key WHERE call_id = ?`],
        ['audit_call_role', `UPDATE audit_call_role SET role_id = 'r2r' WHERE call_id = ?`],
        ['audit_call_role', `DELETE FROM audit_call_role WHERE call_id = ?`],
        ['audit_credential_ref', `UPDATE audit_credential_ref SET version = '9' WHERE call_id = ?`],
        ['audit_credential_ref', `DELETE FROM audit_credential_ref WHERE call_id = ?`],
      ] as const) {
        expect(() => db.prepare(statement).run(written.id), `${table}: ${statement}`).toThrow(
          /append-only/,
        );
      }
    } finally {
      db.close();
    }
  });

  it('is detectable, not preventable: dropping the triggers lets a rewrite through, and the chain then fails', async () => {
    const written = await store.audit.append(call({ deploymentId: 'tamper' }));
    const db = raw();
    try {
      // Exactly what 02 §10.4 item 1 says anyone with the file can do.
      db.exec(`DROP TRIGGER ${AUDIT_CALL.name}_no_update`);
      db.prepare(`UPDATE ${AUDIT_CALL.name} SET caller_subject = 'mallory' WHERE id = ?`).run(
        written.id,
      );

      const row = db
        .prepare(`SELECT * FROM ${AUDIT_CALL.name} WHERE id = ?`)
        .get(written.id) as Record<string, AuditHashValue>;
      expect(row['caller_subject']).toBe('mallory'); // the write was NOT prevented
      expect(auditRowHash(row)).not.toBe(row['row_hash']); // but it IS detectable
    } finally {
      db.close();
    }
    // Restore the guard: it is reapplied on every store open, idempotently.
    await store.migrate();
  });

  it('names the Postgres asymmetry rather than pretending the mechanisms match', () => {
    expect(POSTGRES_IMMUTABILITY_RECOMMENDATION).toContain('REVOKE UPDATE, DELETE');
    expect(POSTGRES_IMMUTABILITY_RECOMMENDATION).toContain('GRANT INSERT, SELECT');
    expect(POSTGRES_IMMUTABILITY_RECOMMENDATION).toContain(AUDIT_CALL.name);
  });
});

describe('result_keys — the JSON column AND the normalised side table', () => {
  it('writes both, in the same transaction as the row', async () => {
    const written = await store.audit.append(
      call({
        deploymentId: 'keys',
        resultKeys: [
          { keyName: 'voucher_no', keyValue: '12345' },
          { keyName: 'company', keyValue: '00100' },
        ],
      }),
    );
    const db = raw();
    try {
      const json = db
        .prepare(`SELECT result_keys FROM ${AUDIT_CALL.name} WHERE id = ?`)
        .get(written.id) as { result_keys: string };
      expect(JSON.parse(json.result_keys)).toEqual([
        { keyName: 'voucher_no', keyValue: '12345' },
        { keyName: 'company', keyValue: '00100' },
      ]);
      const side = db
        .prepare(`SELECT key_name, key_value FROM audit_result_key WHERE call_id = ? ORDER BY id`)
        .all(written.id);
      expect(side).toEqual([
        { key_name: 'voucher_no', key_value: '12345' },
        { key_name: 'company', key_value: '00100' },
      ]);
    } finally {
      db.close();
    }
  });

  it('is atomic: a failing satellite insert takes the audit_call row with it', async () => {
    // The satellites go in the SAME transaction as the row (02 §10.4 item 2).
    // A NOT NULL violation on the satellite is the cheapest way to prove it:
    // if the insert were a second transaction, the parent row would survive.
    const headBefore = await store.audit.chainHead('atomic');
    await expect(
      store.audit.append(
        call({
          deploymentId: 'atomic',
          correlationId: 'atomic-1',
          resultKeys: [{ keyName: 'voucher_no', keyValue: null as unknown as string }],
        }),
      ),
    ).rejects.toThrow();

    expect(await store.audit.chainHead('atomic')).toEqual(headBefore);
    const db = raw();
    try {
      const orphans = db
        .prepare(`SELECT COUNT(*) AS n FROM ${AUDIT_CALL.name} WHERE correlation_id = ?`)
        .get('atomic-1') as { n: number };
      expect(orphans.n).toBe(0);
    } finally {
      db.close();
    }

    // And the chain is undisturbed: the next append still links to the head
    // that existed before the failure.
    const next = await store.audit.append(call({ deploymentId: 'atomic' }));
    expect(next.prevHash).toBe(headBefore?.rowHash ?? AUDIT_CHAIN_GENESIS);
  });

  it('answers "who created document 12345" in one hop (02 §4.6 query 2)', async () => {
    const created = await store.audit.append(
      call({
        deploymentId: 'keys',
        callerSubject: 'anita',
        resultKeys: [{ keyName: 'voucher_no', keyValue: 'ONE-HOP-1' }],
      }),
    );
    const found = await store.audit.listByResultKey('voucher_no', 'ONE-HOP-1');
    expect(found.map((r) => r.id)).toEqual([created.id]);
    expect(found[0]?.callerSubject).toBe('anita');
    expect(found[0]?.reversedByCallId).toBeNull();
  });

  it('is backed by the (key_value, key_name) index — one indexed hop, not a scan', () => {
    const db = raw();
    try {
      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN SELECT 1 FROM audit_result_key WHERE key_value = ? AND key_name = ?`,
        )
        .all('ONE-HOP-1', 'voucher_no')
        .map((r) => (r as { detail: string }).detail)
        .join(' | ');
      expect(plan).toContain('audit_result_key_value_name_idx');
      expect(plan).not.toContain('SCAN audit_result_key');
    } finally {
      db.close();
    }
  });
});

describe('caller_roles — a JSON column plus the audit_call_role side table', () => {
  it('writes both and answers a membership query from the side table', async () => {
    const written = await store.audit.append(
      call({ deploymentId: 'roles', callerRoles: ['p2p', 'r2r'] }),
    );
    const db = raw();
    try {
      const json = db
        .prepare(`SELECT caller_roles FROM ${AUDIT_CALL.name} WHERE id = ?`)
        .get(written.id) as { caller_roles: string };
      expect(JSON.parse(json.caller_roles)).toEqual(['p2p', 'r2r']);
    } finally {
      db.close();
    }
    expect((await store.audit.get(written.id))?.callerRoles).toEqual(['p2p', 'r2r']);
    const byRole = await store.audit.listByRole('r2r');
    expect(byRole.map((r) => r.id)).toContain(written.id);
  });
});

describe('audit_credential_ref — 02 §11.3', () => {
  it('answers "which calls used this credential version" in one hop', async () => {
    const ref = 'secretRef://binding/ebs-p2p-ap/wrapper-schema';
    const v2 = await store.audit.append(
      call({ deploymentId: 'creds', credentialRefs: [{ secretRef: ref, version: '2' }] }),
    );
    const v3 = await store.audit.append(
      call({ deploymentId: 'creds', credentialRefs: [{ secretRef: ref, version: '3' }] }),
    );

    expect((await store.audit.listByCredentialRef(ref, '2')).map((r) => r.id)).toEqual([v2.id]);
    expect((await store.audit.listByCredentialRef(ref, '3')).map((r) => r.id)).toEqual([v3.id]);
    // Every version of the reference — the blast radius before a revoke.
    expect(new Set((await store.audit.listByCredentialRef(ref)).map((r) => r.id))).toEqual(
      new Set([v2.id, v3.id]),
    );
  });

  it('is backed by the secret_ref index', () => {
    const db = raw();
    try {
      const plan = db
        .prepare(`EXPLAIN QUERY PLAN SELECT 1 FROM audit_credential_ref WHERE secret_ref = ?`)
        .all('secretRef://binding/ebs-p2p-ap/wrapper-schema')
        .map((r) => (r as { detail: string }).detail)
        .join(' | ');
      expect(plan).toContain('audit_credential_ref_secret_ref_idx');
      expect(plan).not.toContain('SCAN audit_credential_ref');
    } finally {
      db.close();
    }
  });

  it('stores a reference and never a value (CLAUDE.md non-negotiable 8)', async () => {
    const written = await store.audit.append(
      call({
        deploymentId: 'creds',
        credentialRefs: [{ secretRef: 'secretRef://binding/x/wrapper-schema', version: null }],
      }),
    );
    expect(written.credentialRefs[0]?.secretRef.startsWith('secretRef://')).toBe(true);
  });
});

describe('the append-only rule is in the type system as well as the database', () => {
  it('exposes no update and no delete on the audit repository', () => {
    expect(Object.keys(store.audit).sort()).toEqual([
      'append',
      'chainHead',
      'get',
      'listByCredentialRef',
      'listByResultKey',
      'listByRole',
      'listChain',
      // W0-C4 added two READ methods. Still no `update` and no `delete`: the
      // one deletion path in the product is `store.retention`, which is a
      // separate, gated repository precisely so this assertion stays true.
      'listDeployments',
      // W0-F5 added one more READ method: both ends of a reversal edge, with
      // `reversed_by_call_id` resolved from the index because an append-only
      // row can never be rewritten once its reversal lands.
      'reversalLinks',
      'verifyChain',
    ]);
  });

  it('listChain returns the deployment in chain order, oldest first', async () => {
    const chain = await store.audit.listChain('chain-a');
    expect(chain.length).toBeGreaterThanOrEqual(3);
    expect(chain[0]?.prevHash).toBe(AUDIT_CHAIN_GENESIS);
    for (let i = 1; i < chain.length; i += 1) {
      expect(chain[i]?.prevHash).toBe(chain[i - 1]?.rowHash);
    }
  });
});

describe('the generated migration sets carry the new tables and indexes', () => {
  const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  for (const dialect of ['sqlite', 'postgres'] as const) {
    it(`${dialect}: declares the result-key, role and credential-ref indexes`, () => {
      const ddl = readdirSync(join(MIGRATIONS, dialect))
        .filter((f) => f.endsWith('.sql'))
        .map((f) => readFileSync(join(MIGRATIONS, dialect, f), 'utf8'))
        .join('\n')
        .toLowerCase();
      for (const index of [
        'audit_result_key_value_name_idx',
        'audit_call_role_role_id_idx',
        'audit_credential_ref_secret_ref_idx',
        'audit_call_chain_link_uq',
      ]) {
        expect(ddl).toContain(index);
      }
    });
  }
});
