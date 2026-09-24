// MCPForge — W0-C4's done criterion, clause by clause.
//
//   "`forge audit verify --json` walks the chain and reports either
//    intact-with-origin or the FIRST broken row by id; a test that mutates a
//    row (with triggers dropped, simulating direct file access) makes it fail
//    at exactly that row; the retention job is the single audited exception to
//    append-only and logs its own deletion."
//
// Runs against a temp-file SQLite store, the Wave 0 default. Several tests
// reach the file directly with `better-sqlite3` — legitimate only inside
// `core/gateway/store/**`, and necessary here because the whole point is to
// act as a writer that is NOT going through the repository interface. That is
// the tamper the chain exists to detect, and **on SQLite it is detectable, not
// preventable** (02 §10.4 item 1).

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../store.js';
import { AUDIT_CALL, AUDIT_RETENTION_GATE } from '../schema/spec.js';
import { AUDIT_CHAIN_GENESIS } from './hash.js';
import { AUDIT_RETENTION_TOOL_ID, parseRetentionAttestation } from './attestation.js';
import type { RuntimeStore } from '../repository.js';
import type { AppendAuditCallInput } from './types.js';

let tempDir: string;
let dbFile: string;
let store: RuntimeStore;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'mcpforge-retention-'));
  dbFile = join(tempDir, 'runtime.db');
  store = await openRuntimeStore({ kind: 'sqlite', file: dbFile });
});

afterEach(async () => {
  await store?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function raw(): Database.Database {
  return new Database(dbFile);
}

function call(overrides: Partial<AppendAuditCallInput> = {}): AppendAuditCallInput {
  return {
    callerSubject: 'bikash',
    callerRoles: ['p2p'],
    consumerId: 'portal-local',
    humanInTheLoop: true,
    toolId: 'jde.ap.voucher.create',
    toolVersion: '1.0.0',
    bindingType: 'plsql',
    isWrite: true,
    deploymentId: 'local',
    phase: 'execute',
    outcome: 'ok',
    resultKeys: [{ keyName: 'voucher_no', keyValue: '12345' }],
    credentialRefs: [{ secretRef: 'secretRef://binding/jde-ap/wrapper-schema', version: '1' }],
    ...overrides,
  };
}

/** `n` rows, one per day starting at 2020-01-01, so a cutoff is meaningful. */
async function seed(n: number, deploymentId = 'local'): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const day = String(i + 1).padStart(2, '0');
    const written = await store.audit.append(
      call({ deploymentId, ts: `2020-01-${day}T00:00:00.000Z`, correlationId: `c-${i}` }),
    );
    ids.push(written.id);
  }
  return ids;
}

describe('forge audit verify — the chain walk', () => {
  it('reports an empty deployment as empty, not as a break', async () => {
    const result = await store.audit.verifyChain('never-used');
    expect(result.status).toBe('empty');
    expect(result.firstBreak).toBeNull();
    expect(result.rowsChecked).toBe(0);
  });

  it('reports intact WITH ITS ORIGIN — the chain runs from genesis', async () => {
    const ids = await seed(5);
    const result = await store.audit.verifyChain('local');
    expect(result.status).toBe('intact');
    expect(result.firstBreak).toBeNull();
    expect(result.rowsChecked).toBe(5);
    expect(result.origin).toEqual({
      kind: 'genesis',
      firstRowId: ids[0],
      firstRowPrevHash: AUDIT_CHAIN_GENESIS,
    });
  });

  it('lists every deployment that has written a row', async () => {
    await seed(2, 'local');
    await seed(1, 'other');
    expect(await store.audit.listDeployments()).toEqual(['local', 'other']);
  });

  // THE done-criterion clause: mutate a row with the triggers dropped, exactly
  // as anyone holding the file can, and the walk must fail at THAT row.
  it('fails at exactly the mutated row when a hashed column is rewritten with the triggers dropped', async () => {
    const ids = await seed(6);
    const target = ids[3]!;

    const db = raw();
    try {
      db.exec(`DROP TRIGGER ${AUDIT_CALL.name}_no_update`);
      db.prepare(`UPDATE ${AUDIT_CALL.name} SET caller_subject = 'mallory' WHERE id = ?`).run(
        target,
      );
    } finally {
      db.close();
    }

    const result = await store.audit.verifyChain('local');
    expect(result.status).toBe('broken');
    expect(result.firstBreak?.rowId).toBe(target);
    expect(result.firstBreak?.position).toBe(3);
    expect(result.firstBreak?.reason).toBe('row_hash_mismatch');
    // Actionable enough to work from: expected vs actual, and a non-empty
    // `next` that names an action rather than "try again" (non-negotiable 5).
    expect(result.firstBreak?.expected).not.toBe(result.firstBreak?.actual);
    expect(result.firstBreak?.next).not.toMatch(/try again/i);
    expect(result.firstBreak?.next.length).toBeGreaterThan(0);

    // The guard is restored on the next open; the chain stays broken.
    await store.migrate();
    expect((await store.audit.verifyChain('local')).firstBreak?.rowId).toBe(target);
  });

  it('reports the FIRST broken row, not the last, when two rows are rewritten', async () => {
    const ids = await seed(6);
    const db = raw();
    try {
      db.exec(`DROP TRIGGER ${AUDIT_CALL.name}_no_update`);
      const update = db.prepare(
        `UPDATE ${AUDIT_CALL.name} SET error_message_agent = 'x' WHERE id = ?`,
      );
      update.run(ids[4]!);
      update.run(ids[1]!);
    } finally {
      db.close();
    }
    const result = await store.audit.verifyChain('local');
    expect(result.firstBreak?.rowId).toBe(ids[1]);
  });

  // Deleting a row from the MIDDLE is not retention — retention is a prefix —
  // so it must surface as a broken link at the orphaned successor.
  it('detects a hole punched in the middle of the chain as a prev_hash break', async () => {
    const ids = await seed(5);
    const db = raw();
    try {
      db.exec(`DROP TRIGGER ${AUDIT_CALL.name}_no_delete`);
      db.exec(`DROP TRIGGER audit_result_key_no_delete`);
      db.exec(`DROP TRIGGER audit_call_role_no_delete`);
      db.exec(`DROP TRIGGER audit_credential_ref_no_delete`);
      for (const satellite of ['audit_result_key', 'audit_call_role', 'audit_credential_ref']) {
        db.prepare(`DELETE FROM ${satellite} WHERE call_id = ?`).run(ids[2]!);
      }
      db.prepare(`DELETE FROM ${AUDIT_CALL.name} WHERE id = ?`).run(ids[2]!);
    } finally {
      db.close();
    }
    const result = await store.audit.verifyChain('local');
    expect(result.status).toBe('broken');
    expect(result.firstBreak?.rowId).toBe(ids[3]);
    expect(result.firstBreak?.reason).toBe('prev_hash_mismatch');
    await store.migrate();
  });

  // The scenario the whole attestation design exists for: a PREFIX deleted by
  // someone who is not the retention job leaves no receipt, and must not be
  // mistaken for retention.
  it('reports an unexplained non-genesis origin as a break — deletion without a receipt is tampering', async () => {
    const ids = await seed(5);
    const db = raw();
    try {
      db.exec(`DROP TRIGGER ${AUDIT_CALL.name}_no_delete`);
      db.exec(`DROP TRIGGER audit_result_key_no_delete`);
      db.exec(`DROP TRIGGER audit_call_role_no_delete`);
      db.exec(`DROP TRIGGER audit_credential_ref_no_delete`);
      for (const id of ids.slice(0, 2)) {
        for (const satellite of ['audit_result_key', 'audit_call_role', 'audit_credential_ref']) {
          db.prepare(`DELETE FROM ${satellite} WHERE call_id = ?`).run(id);
        }
        db.prepare(`DELETE FROM ${AUDIT_CALL.name} WHERE id = ?`).run(id);
      }
    } finally {
      db.close();
    }
    const result = await store.audit.verifyChain('local');
    expect(result.status).toBe('broken');
    expect(result.firstBreak?.rowId).toBe(ids[2]);
    expect(result.firstBreak?.position).toBe(0);
    expect(result.firstBreak?.reason).toBe('unexplained_chain_origin');
    await store.migrate();
  });
});

describe('the retention job — the single audited exception to append-only', () => {
  it('a raw DELETE is refused while no gate is open', async () => {
    const ids = await seed(2);
    const db = raw();
    try {
      expect(() => db.prepare(`DELETE FROM ${AUDIT_CALL.name} WHERE id = ?`).run(ids[0]!)).toThrow(
        /append-only/,
      );
    } finally {
      db.close();
    }
    expect(await store.audit.get(ids[0]!)).toBeDefined();
  });

  it('deletes the qualifying prefix, and the gate is open only inside the sweep', async () => {
    const ids = await seed(6);
    const result = await store.retention.sweep({
      deploymentId: 'local',
      olderThanIso: '2020-01-04T00:00:00.000Z',
      reason: '2-year default retention (02 §4.6)',
      actorSubject: 'ops-bikash',
      consumerId: 'forge-cli',
      now: '2026-08-30T00:00:00.000Z',
    });

    expect(result.deletedCount).toBe(3);
    expect(result.deletedCallIds).toEqual(ids.slice(0, 3));
    for (const id of ids.slice(0, 3)) {
      expect(await store.audit.get(id)).toBeUndefined();
    }
    expect(await store.audit.get(ids[3]!)).toBeDefined();

    // The gate closed behind it: append-only is back on.
    expect(await store.retention.listOpenGates()).toEqual([]);
    const db = raw();
    try {
      expect(() => db.prepare(`DELETE FROM ${AUDIT_CALL.name} WHERE id = ?`).run(ids[3]!)).toThrow(
        /append-only/,
      );
    } finally {
      db.close();
    }
  });

  it('takes the satellites with it — no orphaned business keys survive the parent row', async () => {
    const ids = await seed(3);
    await store.retention.sweep({
      deploymentId: 'local',
      olderThanIso: '2020-01-03T00:00:00.000Z',
      reason: 'retention',
      actorSubject: 'ops-bikash',
      consumerId: 'forge-cli',
    });
    const db = raw();
    try {
      for (const satellite of ['audit_result_key', 'audit_call_role', 'audit_credential_ref']) {
        const rows = db
          .prepare(`SELECT COUNT(*) AS n FROM ${satellite} WHERE call_id IN (?, ?)`)
          .get(ids[0]!, ids[1]!) as { n: number };
        expect(rows.n, satellite).toBe(0);
      }
    } finally {
      db.close();
    }
  });

  it('logs its own deletion — durably, inspectably, in the gate table', async () => {
    await seed(5);
    const result = await store.retention.sweep({
      deploymentId: 'local',
      olderThanIso: '2020-01-03T00:00:00.000Z',
      reason: 'financial class, 7-year window elapsed',
      actorSubject: 'ops-bikash',
      consumerId: 'forge-cli',
      now: '2026-08-30T00:00:00.000Z',
    });

    const [logged, ...rest] = await store.retention.listSweeps('local');
    expect(rest).toEqual([]);
    expect(logged).toEqual({
      id: result.gateId,
      deploymentId: 'local',
      openedAt: '2026-08-30T00:00:00.000Z',
      closedAt: '2026-08-30T00:00:00.000Z',
      cutoffTs: '2020-01-03T00:00:00.000Z',
      reason: 'financial class, 7-year window elapsed',
      deletedCount: 2,
      boundaryRowHash: result.boundaryRowHash,
      attestationCallId: result.attestationCallId,
      actorSubject: 'ops-bikash',
      consumerId: 'forge-cli',
    });

    // And it survives in the store as a plain, readable row.
    const db = raw();
    try {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${AUDIT_RETENTION_GATE.name}`).get() as {
        n: number;
      };
      expect(row.n).toBe(1);
    } finally {
      db.close();
    }
  });

  it('logs its own deletion INTO THE CHAIN too — a hash-covered attestation row', async () => {
    await seed(4);
    const result = await store.retention.sweep({
      deploymentId: 'local',
      olderThanIso: '2020-01-03T00:00:00.000Z',
      reason: 'retention',
      actorSubject: 'ops-bikash',
      consumerId: 'forge-cli',
    });

    const attestationRow = await store.audit.get(result.attestationCallId!);
    expect(attestationRow?.toolId).toBe(AUDIT_RETENTION_TOOL_ID);
    expect(attestationRow?.callerSubject).toBe('ops-bikash');
    const parsed = parseRetentionAttestation(attestationRow?.argsRedacted);
    expect(parsed).toMatchObject({
      gateId: result.gateId,
      deploymentId: 'local',
      deletedCount: 2,
      boundaryRowHash: result.boundaryRowHash,
      reason: 'retention',
    });
  });

  it('does nothing, and opens no gate, when nothing is in scope', async () => {
    await seed(3);
    const result = await store.retention.sweep({
      deploymentId: 'local',
      olderThanIso: '2019-01-01T00:00:00.000Z',
      reason: 'nothing due',
      actorSubject: 'ops-bikash',
      consumerId: 'forge-cli',
    });
    expect(result.deletedCount).toBe(0);
    expect(result.gateId).toBeNull();
    expect(await store.retention.listSweeps()).toEqual([]);
    expect((await store.audit.verifyChain('local')).status).toBe('intact');
  });

  it('deletes a PREFIX only: an out-of-order older row after a newer one is retained', async () => {
    // ts is caller-supplied, so it can disagree with chain order. Retention
    // must still never punch a hole — it stops at the first row that is not
    // older than the cutoff.
    const a = await store.audit.append(call({ ts: '2020-01-01T00:00:00.000Z' }));
    const b = await store.audit.append(call({ ts: '2025-01-01T00:00:00.000Z' }));
    const c = await store.audit.append(call({ ts: '2020-01-02T00:00:00.000Z' }));

    const result = await store.retention.sweep({
      deploymentId: 'local',
      olderThanIso: '2021-01-01T00:00:00.000Z',
      reason: 'retention',
      actorSubject: 'ops-bikash',
      consumerId: 'forge-cli',
    });
    expect(result.deletedCallIds).toEqual([a.id]);
    expect(await store.audit.get(b.id)).toBeDefined();
    expect(await store.audit.get(c.id)).toBeDefined();
  });
});

describe('retention and the chain together — the interaction the design exists for', () => {
  it('verify still passes after a sweep, as intact_from_retention_boundary with the receipt', async () => {
    const ids = await seed(6);
    const result = await store.retention.sweep({
      deploymentId: 'local',
      olderThanIso: '2020-01-04T00:00:00.000Z',
      reason: '2-year default retention (02 §4.6)',
      actorSubject: 'ops-bikash',
      consumerId: 'forge-cli',
    });

    const verified = await store.audit.verifyChain('local');
    expect(verified.status).toBe('intact_from_retention_boundary');
    expect(verified.firstBreak).toBeNull();
    expect(verified.origin?.kind).toBe('retention_boundary');
    expect(verified.origin?.firstRowId).toBe(ids[3]);
    expect(verified.origin?.firstRowPrevHash).toBe(result.boundaryRowHash);
    expect(verified.origin?.attestation).toMatchObject({
      callId: result.attestationCallId,
      deletedCount: 3,
      reason: '2-year default retention (02 §4.6)',
    });
  });

  // Editing the receipt costs the tamperer twice: the attestation row itself
  // no longer hashes to its stored row_hash, AND — because a receipt that
  // fails its own content check is not allowed to explain anything — the
  // chain's origin goes back to being unaccounted for. The FIRST break, in
  // chain order, is therefore the surviving first row.
  it('a forged attestation does not survive: the receipt stops explaining the gap AND fails its own hash', async () => {
    const ids = await seed(6);
    const result = await store.retention.sweep({
      deploymentId: 'local',
      olderThanIso: '2020-01-04T00:00:00.000Z',
      reason: 'retention',
      actorSubject: 'ops-bikash',
      consumerId: 'forge-cli',
    });

    const db = raw();
    try {
      db.exec(`DROP TRIGGER ${AUDIT_CALL.name}_no_update`);
      db.prepare(`UPDATE ${AUDIT_CALL.name} SET args_redacted = ? WHERE id = ?`).run(
        JSON.stringify({ kind: 'mcpforge/audit-retention/v1', deletedCount: 0 }),
        result.attestationCallId!,
      );
    } finally {
      db.close();
    }

    const verified = await store.audit.verifyChain('local');
    expect(verified.status).toBe('broken');
    expect(verified.firstBreak?.rowId).toBe(ids[3]);
    expect(verified.firstBreak?.position).toBe(0);
    expect(verified.firstBreak?.reason).toBe('unexplained_chain_origin');
    expect(verified.origin).toBeNull();
    await store.migrate();
  });

  it('two sweeps in a row: the newer attestation explains the current origin', async () => {
    const ids = await seed(8);
    await store.retention.sweep({
      deploymentId: 'local',
      olderThanIso: '2020-01-03T00:00:00.000Z',
      reason: 'first sweep',
      actorSubject: 'ops-bikash',
      consumerId: 'forge-cli',
    });
    const second = await store.retention.sweep({
      deploymentId: 'local',
      olderThanIso: '2020-01-06T00:00:00.000Z',
      reason: 'second sweep',
      actorSubject: 'ops-bikash',
      consumerId: 'forge-cli',
    });

    const verified = await store.audit.verifyChain('local');
    expect(verified.status).toBe('intact_from_retention_boundary');
    expect(verified.origin?.firstRowId).toBe(ids[5]);
    expect(verified.origin?.attestation).toMatchObject({ reason: 'second sweep' });
    expect((await store.retention.listSweeps('local')).map((s) => s.reason)).toEqual([
      'second sweep',
      'first sweep',
    ]);
    expect(second.deletedCount).toBe(3);
  });
});
