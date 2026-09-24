// MCPForge — the `idempotency_record` repository. W0-C3, 02 §3.1.2.
//
// One implementation, not one per dialect: the statements are built from the
// single schema definition's column names and compiled by drizzle for whichever
// dialect is connected, matching `../heartbeat.ts` and `../audit/repository.ts`.
//
// **The ordering this file exists to guarantee** (02 §3.1.2): the record is
// written BEFORE the binding is invoked and the outcome is written back AFTER.
// `begin` is the before; `complete` and `fail` are the after. A caller that
// invoked the binding first and recorded afterwards would leave the ambiguous
// timeout — the case the whole mechanism exists for — uncovered.

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { DialectConnection } from '../dialect.js';
import { uuidv7 } from '../id.js';
import { IDEMPOTENCY_RECORD } from '../schema/spec.js';
import { IdempotencyNotPendingError } from './types.js';
import type {
  BeginIdempotentInput,
  BeginIdempotentResult,
  CompleteIdempotentInput,
  FailIdempotentInput,
  IdempotencyLookupOptions,
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyStatus,
} from './types.js';

/** 02 §3.1.2 — `writeSafety.idempotency.scopeHours` defaults to 24. */
export const DEFAULT_IDEMPOTENCY_SCOPE_HOURS = 24;

/**
 * Domain separator, versioned for the same reason `AUDIT_CHAIN_ALGORITHM` is:
 * a change to the composition below changes every key the product will ever
 * compute, and a silent change would make every in-window record unfindable —
 * which presents as a duplicate payable, not as an error.
 */
export const IDEMPOTENCY_KEY_ALGORITHM = 'mcpforge/idempotency-key/v1' as const;

const T = sql.identifier(IDEMPOTENCY_RECORD.name);
const C = {
  id: sql.identifier('id'),
  idempotencyKey: sql.identifier('idempotency_key'),
  callerSubject: sql.identifier('caller_subject'),
  toolId: sql.identifier('tool_id'),
  toolVersion: sql.identifier('tool_version'),
  argsCanonicalHash: sql.identifier('args_canonical_hash'),
  confirmTokenHash: sql.identifier('confirm_token_hash'),
  status: sql.identifier('status'),
  result: sql.identifier('result'),
  errorCode: sql.identifier('error_code'),
  callId: sql.identifier('call_id'),
  createdAt: sql.identifier('created_at'),
  completedAt: sql.identifier('completed_at'),
  scopeHours: sql.identifier('scope_hours'),
  expiresAt: sql.identifier('expires_at'),
} as const;

/**
 * 02 §3.1.2, verbatim:
 * `idempotencyKey = sha256(callerSubject | toolId | toolVersion | argsCanonicalHash | confirmToken)`.
 *
 * The pipe is the separator the spec writes, and the parts are joined with it
 * literally. That is safe here in a way it would not be for arbitrary text: four
 * of the five parts are a subject, a dotted tool id, a semver and a hex digest,
 * none of which may contain a pipe, and the fifth is an opaque base64url token.
 * A part that could contain the separator would let two different calls compose
 * the same key, which is why this composition may not be reused for anything
 * else.
 *
 * `argsCanonicalHash` arrives already computed — the canonicaliser (sorted keys,
 * normalised numbers, `confirm` excluded) is W0-F2's and there must be exactly
 * one of it.
 */
export function idempotencyKeyFor(parts: {
  readonly callerSubject: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly argsCanonicalHash: string;
  readonly confirmToken: string;
}): string {
  const preimage = [
    parts.callerSubject,
    parts.toolId,
    parts.toolVersion,
    parts.argsCanonicalHash,
    parts.confirmToken,
  ].join('|');
  return createHash('sha256')
    .update(`${IDEMPOTENCY_KEY_ALGORITHM}|${preimage}`, 'utf8')
    .digest('hex');
}

/**
 * The confirm token as it is allowed to be stored — hashed, never raw. The
 * token is a bearer value: a row holding it verbatim would let anyone with read
 * access to `.mcpforge/runtime.db` execute a plan a human approved. Same
 * primitive and encoding as `audit_call.confirm_token_hash`.
 */
export function confirmTokenHash(confirmToken: string): string {
  return createHash('sha256').update(confirmToken, 'utf8').digest('hex');
}

function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function required(row: Row, column: string): string {
  const value = text(row[column]);
  if (value === null) {
    throw new Error(`${IDEMPOTENCY_RECORD.name}.${column} is NOT NULL but came back null.`);
  }
  return value;
}

function toRecord(row: Row): IdempotencyRecord {
  const result = text(row['result']);
  return {
    id: required(row, 'id'),
    idempotencyKey: required(row, 'idempotency_key'),
    callerSubject: required(row, 'caller_subject'),
    toolId: required(row, 'tool_id'),
    toolVersion: required(row, 'tool_version'),
    argsCanonicalHash: required(row, 'args_canonical_hash'),
    confirmTokenHash: required(row, 'confirm_token_hash'),
    status: required(row, 'status') as IdempotencyStatus,
    result: result === null ? null : (JSON.parse(result) as unknown),
    errorCode: text(row['error_code']),
    callId: text(row['call_id']),
    createdAt: required(row, 'created_at'),
    completedAt: text(row['completed_at']),
    scopeHours: Number(row['scope_hours']),
    expiresAt: required(row, 'expires_at'),
  };
}

/** Null and undefined both mean "no result yet"; neither may become `"null"`. */
function toJsonText(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export function idempotencyRepository(connection: DialectConnection): IdempotencyRepository {
  const select = sql`select * from ${T}`;

  async function read(idempotencyKey: string): Promise<IdempotencyRecord | undefined> {
    const rows = await connection.all<Row>(
      sql`${select} where ${C.idempotencyKey} = ${idempotencyKey}`,
    );
    const first = rows[0];
    return first === undefined ? undefined : toRecord(first);
  }

  /**
   * Whether this record still governs at `now`. The row's own `expires_at`
   * governs by default; an explicit `scopeHours` recomputes the window from
   * `created_at` instead — see `IdempotencyLookupOptions`.
   */
  function inWindow(record: IdempotencyRecord, now: string, scopeHours?: number): boolean {
    const until =
      scopeHours === undefined ? record.expiresAt : addHours(record.createdAt, scopeHours);
    return now < until;
  }

  function settle(
    idempotencyKey: string,
    status: Exclude<IdempotencyStatus, 'pending'>,
    result: unknown,
    errorCode: string | null,
    callId: string | null,
    now: string,
  ): Promise<IdempotencyRecord> {
    const callIdClause = callId === null ? sql`` : sql`, ${C.callId} = ${callId}`;
    return connection.transaction(async () => {
      const before = await read(idempotencyKey);
      if (before === undefined) {
        throw new Error(
          `No idempotency record for key ${idempotencyKey}; begin() was never called.`,
        );
      }
      // Checked here so the refusal can NAME the state that blocked it, and
      // guarded again in the `update` below so the atomicity does not rest on
      // this read. An outcome may only ever be written onto a `pending` record:
      // a second, late settle must not overwrite the original result that a
      // replay has already been serving — 02 §3.1.2 says the ORIGINAL result,
      // and a result that could be edited afterwards would not be it.
      if (before.status !== 'pending') {
        throw new IdempotencyNotPendingError(idempotencyKey, before.status);
      }
      await connection.run(
        sql`update ${T} set ${C.status} = ${status}, ${C.result} = ${toJsonText(result)}, ${C.errorCode} = ${errorCode}, ${C.completedAt} = ${now}${callIdClause} where ${C.idempotencyKey} = ${idempotencyKey} and ${C.status} = ${'pending'}`,
      );
      const record = await read(idempotencyKey);
      if (record === undefined || record.status !== status) {
        throw new IdempotencyNotPendingError(idempotencyKey, record?.status ?? 'pending');
      }
      return record;
    });
  }

  return {
    /**
     * **Written before the binding is invoked** (02 §3.1.2), and the claim is a
     * `UNIQUE`-constrained `INSERT` rather than a read-then-write, so two
     * attempts on one key cannot both come back `started`. The insert is run in
     * its own nested scope — a savepoint when the caller has already opened the
     * write transaction — so that a refused claim classifies as a replay
     * instead of poisoning the enclosing transaction.
     *
     * **This is atomic on one node.** 02 §10.4 item 6: SQLite is a
     * single-writer, single-host store and the Wave 0 gateway runs as one
     * instance; multi-replica is a Postgres-era property and no Wave 0 claim
     * may be written as if it works. The constraint itself is what carries the
     * guarantee across the migration.
     */
    async begin(input: BeginIdempotentInput): Promise<BeginIdempotentResult> {
      const now = input.now ?? new Date().toISOString();
      const scopeHours = input.scopeHours ?? DEFAULT_IDEMPOTENCY_SCOPE_HOURS;
      const idempotencyKey = idempotencyKeyFor(input);

      return connection.transaction(async () => {
        const claim = async (): Promise<IdempotencyRecord | undefined> => {
          try {
            return await connection.transaction(async () => {
              const id = uuidv7();
              await connection.run(
                sql`insert into ${T} (${C.id}, ${C.idempotencyKey}, ${C.callerSubject}, ${C.toolId}, ${C.toolVersion}, ${C.argsCanonicalHash}, ${C.confirmTokenHash}, ${C.status}, ${C.result}, ${C.errorCode}, ${C.callId}, ${C.createdAt}, ${C.completedAt}, ${C.scopeHours}, ${C.expiresAt}) values (${id}, ${idempotencyKey}, ${input.callerSubject}, ${input.toolId}, ${input.toolVersion}, ${input.argsCanonicalHash}, ${confirmTokenHash(input.confirmToken)}, ${'pending'}, ${null}, ${null}, ${null}, ${now}, ${null}, ${scopeHours}, ${addHours(now, scopeHours)})`,
              );
              return {
                id,
                idempotencyKey,
                callerSubject: input.callerSubject,
                toolId: input.toolId,
                toolVersion: input.toolVersion,
                argsCanonicalHash: input.argsCanonicalHash,
                confirmTokenHash: confirmTokenHash(input.confirmToken),
                status: 'pending' as const,
                result: null,
                errorCode: null,
                callId: null,
                createdAt: now,
                completedAt: null,
                scopeHours,
                expiresAt: addHours(now, scopeHours),
              };
            });
          } catch (error) {
            // Classified by looking, not by matching a driver's message text:
            // "UNIQUE constraint failed" and "duplicate key value violates" are
            // two different strings on two engines, and a parser over either is
            // a dialect dependency this layer exists to not have.
            if ((await read(idempotencyKey)) === undefined) {
              throw error;
            }
            return undefined;
          }
        };

        const started = await claim();
        if (started !== undefined) {
          return { outcome: 'started' as const, record: started, idempotencyKey };
        }

        const existing = await read(idempotencyKey);
        if (existing === undefined) {
          throw new Error(`Idempotency key ${idempotencyKey} was claimed and then vanished.`);
        }

        // Out of window: the record no longer governs, so the call may run
        // again. The stale row is removed and the key re-claimed rather than
        // revived, so `created_at` and `expires_at` describe THIS execution.
        if (!inWindow(existing, now, input.scopeHours)) {
          await connection.run(sql`delete from ${T} where ${C.idempotencyKey} = ${idempotencyKey}`);
          const reclaimed = await claim();
          if (reclaimed === undefined) {
            throw new Error(
              `Idempotency key ${idempotencyKey} could not be re-claimed after expiry.`,
            );
          }
          return { outcome: 'started' as const, record: reclaimed, idempotencyKey };
        }

        // In window and still pending: the same call is in flight, or a
        // previous attempt died between the record and the outcome. Either way
        // the binding must NOT be invoked — see `BeginIdempotentOutcome`.
        if (existing.status === 'pending') {
          return { outcome: 'in_flight' as const, record: existing, idempotencyKey };
        }

        // In window with an outcome — including `failed`. A failed record is
        // replayed rather than retried, deliberately and conservatively: a
        // binding that returned an error may still have committed at the
        // target, and this product's stated bias (CLAUDE.md, write safety) is
        // to refuse a possible duplicate rather than risk one. A caller that
        // genuinely wants a fresh attempt changes an argument, which changes
        // `argsCanonicalHash`, which changes the key.
        return { outcome: 'replayed' as const, record: existing, idempotencyKey };
      });
    },

    complete(input: CompleteIdempotentInput): Promise<IdempotencyRecord> {
      return settle(
        input.idempotencyKey,
        'completed',
        input.result,
        null,
        input.callId ?? null,
        input.now ?? new Date().toISOString(),
      );
    },

    fail(input: FailIdempotentInput): Promise<IdempotencyRecord> {
      return settle(
        input.idempotencyKey,
        'failed',
        input.result ?? null,
        input.errorCode,
        input.callId ?? null,
        input.now ?? new Date().toISOString(),
      );
    },

    get(idempotencyKey: string): Promise<IdempotencyRecord | undefined> {
      return read(idempotencyKey);
    },

    async findReplay(
      idempotencyKey: string,
      options: IdempotencyLookupOptions = {},
    ): Promise<IdempotencyRecord | undefined> {
      const record = await read(idempotencyKey);
      if (record === undefined || record.status === 'pending') {
        return undefined;
      }
      const now = options.now ?? new Date().toISOString();
      return inWindow(record, now, options.scopeHours) ? record : undefined;
    },

    deleteExpired(nowIso?: string): Promise<number> {
      const now = nowIso ?? new Date().toISOString();
      // Counted then deleted inside one transaction, so the number returned is
      // the number actually removed on both dialects — `changes` and `rowCount`
      // are driver-specific and would not survive the swap (../heartbeat.ts).
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
