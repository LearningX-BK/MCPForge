// MCPForge — the `confirm_nonce` repository. W0-C3, 02 §3.1.1:
//
//   "Tokens are single-use (a nonce table, consumed atomically), TTL-bounded
//    (default 300 s), and never valid across callers or tool versions."
//
// This file owns the first of those three. The TTL and the caller/version
// binding live in the token's HMAC-signed payload and are checked by the token
// verifier (W0-F2) before this is ever called; what a signature cannot express
// is that this particular token has now been spent, and that is the one fact
// the store holds.
//
// **Single-use holds on one node, and multi-replica is a Postgres-era
// property** (02 §10.4 item 6). SQLite is a single-writer, single-host store
// and the Wave 0 gateway runs as ONE instance, so the atomicity below is atomic
// on one node and no Wave 0 exit criterion or evidence may be written as if
// horizontal scale-out with shared nonce state works. The *security* property
// nevertheless survives the limitation intact, because single-use is enforced
// by the `UNIQUE` constraint on the nonce column with the consuming `INSERT`
// inside the same transaction as the execute — the same constraint that will
// keep it single-use across replicas once the store is Postgres.

import { sql } from 'drizzle-orm';
import type { DialectConnection } from '../dialect.js';
import { uuidv7 } from '../id.js';
import { CONFIRM_NONCE } from '../schema/spec.js';
import {
  ConfirmNonceAlreadyConsumedError,
  type ConfirmNonceConsumption,
  type ConfirmNonceRepository,
  type ConsumeNonceInput,
} from './types.js';

const T = sql.identifier(CONFIRM_NONCE.name);
const C = {
  id: sql.identifier('id'),
  nonce: sql.identifier('nonce'),
  callerSubject: sql.identifier('caller_subject'),
  toolId: sql.identifier('tool_id'),
  toolVersion: sql.identifier('tool_version'),
  planHash: sql.identifier('plan_hash'),
  consumedAt: sql.identifier('consumed_at'),
  expiresAt: sql.identifier('expires_at'),
  callId: sql.identifier('call_id'),
} as const;

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function required(row: Row, column: string): string {
  const value = text(row[column]);
  if (value === null) {
    throw new Error(`${CONFIRM_NONCE.name}.${column} is NOT NULL but came back null.`);
  }
  return value;
}

function toConsumption(row: Row): ConfirmNonceConsumption {
  return {
    id: required(row, 'id'),
    nonce: required(row, 'nonce'),
    callerSubject: required(row, 'caller_subject'),
    toolId: required(row, 'tool_id'),
    toolVersion: text(row['tool_version']),
    planHash: text(row['plan_hash']),
    consumedAt: required(row, 'consumed_at'),
    expiresAt: required(row, 'expires_at'),
    callId: text(row['call_id']),
  };
}

export function confirmNonceRepository(connection: DialectConnection): ConfirmNonceRepository {
  const select = sql`select * from ${T}`;

  async function read(nonce: string): Promise<ConfirmNonceConsumption | undefined> {
    const rows = await connection.all<Row>(sql`${select} where ${C.nonce} = ${nonce}`);
    const first = rows[0];
    return first === undefined ? undefined : toConsumption(first);
  }

  return {
    /**
     * **The atomic consume.** There is deliberately no `SELECT` before the
     * `INSERT`: a read-then-write would open exactly the window in which two
     * concurrent attempts both see "not yet consumed" and both proceed, which
     * is the double-execute this control exists to prevent. The claim IS the
     * insert, the `UNIQUE` index `confirm_nonce_nonce_uq` is the arbiter, and
     * the loser is decided by the database rather than by scheduling luck — so
     * a concurrent second attempt loses deterministically.
     *
     * Call this **inside the same transaction as the execute** (02 §3.1.1). The
     * insert runs in a nested scope of that transaction — a savepoint, see
     * `../dialect.ts` — for one reason only: so that the expected, handled
     * failure of a replayed token can be classified without aborting the
     * enclosing write unit, which is what an unhandled error inside a Postgres
     * transaction would do. Rolling back to the savepoint undoes the failed
     * insert and nothing else; the enclosing transaction, and with it the
     * atomicity of nonce-consume + execute + audit, is untouched.
     */
    async consume(input: ConsumeNonceInput): Promise<ConfirmNonceConsumption> {
      const consumption: ConfirmNonceConsumption = {
        // UUIDv7 in the application — never gen_random_uuid() (02 §10.4 item 4).
        id: uuidv7(),
        nonce: input.nonce,
        callerSubject: input.callerSubject,
        toolId: input.toolId,
        toolVersion: input.toolVersion ?? null,
        planHash: input.planHash ?? null,
        consumedAt: input.now ?? new Date().toISOString(),
        expiresAt: input.expiresAt,
        callId: input.callId ?? null,
      };

      try {
        await connection.transaction(async () => {
          await connection.run(
            sql`insert into ${T} (${C.id}, ${C.nonce}, ${C.callerSubject}, ${C.toolId}, ${C.toolVersion}, ${C.planHash}, ${C.consumedAt}, ${C.expiresAt}, ${C.callId}) values (${consumption.id}, ${consumption.nonce}, ${consumption.callerSubject}, ${consumption.toolId}, ${consumption.toolVersion}, ${consumption.planHash}, ${consumption.consumedAt}, ${consumption.expiresAt}, ${consumption.callId})`,
          );
        });
      } catch (error) {
        // Classified by looking, not by matching a driver's message text: the
        // unique-violation string differs between engines and a parser over
        // either would be the dialect dependency this layer exists to not have.
        const existing = await read(input.nonce);
        if (existing === undefined) {
          throw error;
        }
        throw new ConfirmNonceAlreadyConsumedError(existing);
      }

      return consumption;
    },

    find(nonce: string): Promise<ConfirmNonceConsumption | undefined> {
      return read(nonce);
    },

    deleteExpired(nowIso?: string): Promise<number> {
      const now = nowIso ?? new Date().toISOString();
      // Counted then deleted inside one transaction — `changes` and `rowCount`
      // are driver-specific and would not survive the dialect swap.
      return connection.transaction(async () => {
        const counted = await connection.all<{ n: number }>(
          sql`select count(*) as ${sql.identifier('n')} from ${T} where ${C.expiresAt} < ${now}`,
        );
        const n = Number(counted[0]?.n ?? 0);
        await connection.run(sql`delete from ${T} where ${C.expiresAt} < ${now}`);
        return n;
      });
    },
  };
}
