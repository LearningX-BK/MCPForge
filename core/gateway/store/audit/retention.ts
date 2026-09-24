// MCPForge — the retention job. W0-C4.
//
// 02 §4.6: "Retention. Configured per deployment in the overlay, defaulting to
// 7 years for `financial`, 2 years otherwise. **Retention deletion is the one
// exception to append-only and runs as a privileged, separately-audited
// job.**"
//
// This file is that job, and everything about its shape follows from the two
// words *one exception*:
//
//  * It deletes a **contiguous prefix** of the chain and nothing else. Not a
//    predicate, not a middle slice, not "rows matching this caller". Retention
//    is by age; the chain is time-ordered by UUIDv7; so the legitimate shape of
//    a retention deletion is a prefix, and restricting the job to that shape is
//    what lets `./verify.ts` treat any hole in the middle as tampering without
//    a second thought. A row older than the cutoff that sits *after* a newer
//    one is deliberately RETAINED rather than punched out.
//  * It opens the gate for the duration of one transaction and closes it in the
//    same transaction. The gate is the delete trigger's only off-switch
//    (`./immutability.ts`), so leaving it open is leaving append-only off.
//  * It writes its own audit row. "Separately audited" is not satisfied by a
//    log line: the attestation is an ordinary `audit_call` row in the same
//    hash chain, which is what makes the deletion itself tamper-EVIDENT and
//    what lets a verifier accept the resulting non-genesis chain origin. See
//    `./attestation.ts` for the full statement of what that does and does not
//    buy on SQLite.
//
// **The concurrency constraint, stated rather than assumed.** The sweep holds
// one transaction across a delete and an `audit.append`. The audit repository
// serialises its own appends, so an append issued from *outside* the sweep
// while the sweep is mid-transaction would wait for the sweep, and the sweep
// would wait for it. Retention at Wave 0 is an operator-invoked, offline job
// on a single-instance gateway (02 §10.4 item 6) and must not be run against a
// live traffic stream. When multi-replica arrives with Postgres, retention
// becomes a separately-privileged database role and this constraint is
// replaced rather than inherited.

import { sql } from 'drizzle-orm';
import type { DialectConnection } from '../dialect.js';
import { uuidv7 } from '../id.js';
import {
  AUDIT_CALL,
  AUDIT_CALL_ROLE,
  AUDIT_CREDENTIAL_REF,
  AUDIT_RESULT_KEY,
  AUDIT_RETENTION_GATE,
} from '../schema/spec.js';
import {
  AUDIT_RETENTION_TOOL_ID,
  AUDIT_RETENTION_ATTESTATION_KIND,
  type AuditRetentionAttestation,
} from './attestation.js';
import type { AuditRepository } from './types.js';

const CALL = sql.identifier(AUDIT_CALL.name);
const GATE = sql.identifier(AUDIT_RETENTION_GATE.name);

const SATELLITES = [AUDIT_RESULT_KEY.name, AUDIT_CALL_ROLE.name, AUDIT_CREDENTIAL_REF.name];

export interface RunRetentionSweepInput {
  readonly deploymentId: string;
  /** Rows with `ts` strictly older than this ISO-8601 instant are in scope. */
  readonly olderThanIso: string;
  /** Why this sweep ran. Recorded in the gate log AND in the attestation. */
  readonly reason: string;
  /** The privileged operator. 02 §4.6 — retention is separately audited. */
  readonly actorSubject: string;
  /** The registered consumer the job runs as (CLAUDE.md non-negotiable 6). */
  readonly consumerId: string;
  /** Injectable clock, so tests do not depend on wall time. */
  readonly now?: string;
}

/** One row of `audit_retention_gate`, as the operational log it is. */
export interface RetentionSweepRecord {
  readonly id: string;
  readonly deploymentId: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly cutoffTs: string;
  readonly reason: string;
  readonly deletedCount: number | null;
  readonly boundaryRowHash: string | null;
  readonly attestationCallId: string | null;
  readonly actorSubject: string;
  readonly consumerId: string;
}

export interface RetentionSweepResult {
  /** Null when nothing was in scope: no rows deleted means no gate was opened. */
  readonly gateId: string | null;
  readonly deploymentId: string;
  readonly cutoffTs: string;
  readonly deletedCount: number;
  readonly deletedCallIds: readonly string[];
  /** `row_hash` of the newest deleted row — the surviving chain's new origin. */
  readonly boundaryRowHash: string | null;
  readonly attestationCallId: string | null;
}

/**
 * Retention's own surface on `RuntimeStore`. Deliberately NOT folded into
 * `AuditRepository`: that interface has no `delete` and that absence is a
 * designed property (`./types.ts`). Retention reaches the store through its
 * own named, gated path, so "the audit repository cannot delete" stays true as
 * written.
 */
export interface AuditRetentionRepository {
  /** Run one sweep. Returns what it removed, whether or not that was anything. */
  sweep(input: RunRetentionSweepInput): Promise<RetentionSweepResult>;
  /** The durable, inspectable deletion log. Newest first. */
  listSweeps(deploymentId?: string): Promise<RetentionSweepRecord[]>;
  /**
   * Gates left open — always empty in a healthy store, because `sweep` opens
   * and closes inside one transaction. A non-empty result means append-only is
   * currently switched OFF and is a finding in its own right.
   */
  listOpenGates(): Promise<RetentionSweepRecord[]>;
}

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toSweepRecord(row: Row): RetentionSweepRecord {
  const count = row['deleted_count'];
  return {
    id: String(row['id']),
    deploymentId: String(row['deployment_id']),
    openedAt: String(row['opened_at']),
    closedAt: text(row['closed_at']),
    cutoffTs: String(row['cutoff_ts']),
    reason: String(row['reason']),
    deletedCount: count === null || count === undefined ? null : Number(count),
    boundaryRowHash: text(row['boundary_row_hash']),
    attestationCallId: text(row['attestation_call_id']),
    actorSubject: String(row['actor_subject']),
    consumerId: String(row['consumer_id']),
  };
}

export function auditRetentionRepository(
  connection: DialectConnection,
  audit: AuditRepository,
): AuditRetentionRepository {
  const selectGate = sql`select * from ${GATE}`;

  async function listWhere(
    where: ReturnType<typeof sql> | undefined,
  ): Promise<RetentionSweepRecord[]> {
    const clause = where === undefined ? sql`` : sql` where ${where}`;
    const rows = await connection.all<Row>(
      sql`${selectGate}${clause} order by ${sql.identifier('id')} desc`,
    );
    return rows.map(toSweepRecord);
  }

  return {
    async sweep(input: RunRetentionSweepInput): Promise<RetentionSweepResult> {
      const now = input.now ?? new Date().toISOString();

      return connection.transaction(async () => {
        // The candidate prefix. Ordered by id (UUIDv7 — chain order), and cut
        // at the FIRST row that is not older than the cutoff, so what is
        // deleted is always a prefix even if a caller-supplied `ts` is out of
        // order with respect to insertion order.
        const chain = await connection.all<Row>(
          sql`select ${sql.identifier('id')}, ${sql.identifier('ts')}, ${sql.identifier('row_hash')} from ${CALL} where ${sql.identifier('deployment_id')} = ${input.deploymentId} order by ${sql.identifier('id')} asc`,
        );
        const prefix: Row[] = [];
        for (const row of chain) {
          if (String(row['ts']) >= input.olderThanIso) {
            break;
          }
          prefix.push(row);
        }

        if (prefix.length === 0) {
          // Nothing in scope. No gate is opened — opening one would switch
          // append-only off for no reason, and a no-op sweep is not an
          // exception to anything.
          return {
            gateId: null,
            deploymentId: input.deploymentId,
            cutoffTs: input.olderThanIso,
            deletedCount: 0,
            deletedCallIds: [],
            boundaryRowHash: null,
            attestationCallId: null,
          };
        }

        const deletedCallIds = prefix.map((row) => String(row['id']));
        const boundaryRowHash = String(prefix[prefix.length - 1]!['row_hash']);
        const gateId = uuidv7();

        // 1. Open the gate. Until this row exists the delete trigger refuses
        //    every DELETE on audit_call and its satellites.
        await connection.run(
          sql`insert into ${GATE} (${sql.identifier('id')}, ${sql.identifier('opened_at')}, ${sql.identifier('reason')}, ${sql.identifier('deployment_id')}, ${sql.identifier('cutoff_ts')}, ${sql.identifier('closed_at')}, ${sql.identifier('deleted_count')}, ${sql.identifier('boundary_row_hash')}, ${sql.identifier('attestation_call_id')}, ${sql.identifier('actor_subject')}, ${sql.identifier('consumer_id')}) values (${gateId}, ${now}, ${input.reason}, ${input.deploymentId}, ${input.olderThanIso}, ${null}, ${null}, ${boundaryRowHash}, ${null}, ${input.actorSubject}, ${input.consumerId})`,
        );

        // 2. Delete the satellites FIRST — the foreign keys are declared
        //    without ON DELETE CASCADE and `PRAGMA foreign_keys = ON` is set
        //    (dialect.ts), so the parent delete would be refused otherwise.
        const ids = sql.join(
          deletedCallIds.map((id) => sql`${id}`),
          sql`, `,
        );
        for (const satellite of SATELLITES) {
          await connection.run(
            sql`delete from ${sql.identifier(satellite)} where ${sql.identifier('call_id')} in (${ids})`,
          );
        }
        await connection.run(sql`delete from ${CALL} where ${sql.identifier('id')} in (${ids})`);

        // 3. The attestation. Appended through the ordinary audit path, so it
        //    is hashed and chained by the same code every other row is — never
        //    a hand-built row, which would be a second chain implementation.
        const survivingFirst = chain[prefix.length];
        const attestation: AuditRetentionAttestation = {
          kind: AUDIT_RETENTION_ATTESTATION_KIND,
          gateId,
          deploymentId: input.deploymentId,
          cutoffTs: input.olderThanIso,
          reason: input.reason,
          deletedCount: prefix.length,
          boundaryRowHash,
          survivingFirstCallId: survivingFirst === undefined ? null : String(survivingFirst['id']),
        };
        const attestationRow = await audit.append({
          ts: now,
          callerSubject: input.actorSubject,
          consumerId: input.consumerId,
          // A retention sweep is an operator action, not an agent's: there is
          // a human behind it by definition.
          humanInTheLoop: true,
          toolId: AUDIT_RETENTION_TOOL_ID,
          isWrite: true,
          deploymentId: input.deploymentId,
          phase: 'execute',
          outcome: 'ok',
          // The hash-covered column. `result_keys` would NOT do: satellite
          // content is not covered by `row_hash` (./immutability.ts), and an
          // attestation a tamperer could edit without breaking the chain would
          // be worth nothing.
          argsRedacted: attestation,
          // Mirrored into the satellite as well, so the deletion is findable
          // by the same indexed business-key lookup as everything else.
          resultKeys: [
            { keyName: 'retention_gate_id', keyValue: gateId },
            { keyName: 'retention_boundary_row_hash', keyValue: boundaryRowHash },
          ],
          rowCount: prefix.length,
        });

        // 4. Close the gate, in the same transaction. append-only is back on
        //    before any other caller can observe the store.
        await connection.run(
          sql`update ${GATE} set ${sql.identifier('closed_at')} = ${now}, ${sql.identifier('deleted_count')} = ${prefix.length}, ${sql.identifier('attestation_call_id')} = ${attestationRow.id} where ${sql.identifier('id')} = ${gateId}`,
        );

        return {
          gateId,
          deploymentId: input.deploymentId,
          cutoffTs: input.olderThanIso,
          deletedCount: prefix.length,
          deletedCallIds,
          boundaryRowHash,
          attestationCallId: attestationRow.id,
        };
      });
    },

    listSweeps(deploymentId?: string): Promise<RetentionSweepRecord[]> {
      return listWhere(
        deploymentId === undefined
          ? undefined
          : sql`${sql.identifier('deployment_id')} = ${deploymentId}`,
      );
    },

    listOpenGates(): Promise<RetentionSweepRecord[]> {
      return listWhere(sql`${sql.identifier('closed_at')} is null`);
    },
  };
}
