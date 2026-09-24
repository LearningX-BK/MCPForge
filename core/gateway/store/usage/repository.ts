// MCPForge — the `consumer_usage_*` repository. W0-N7, 02 §11.6.
//
// One implementation, not one per dialect, matching every other repository in
// this package (`../heartbeat.ts`, `../audit/repository.ts`). Every write here
// runs INSIDE the caller's already-open transaction (`../dialect.ts`'s
// reentrant `AsyncLocalStorage` scope) — this module never calls
// `connection.transaction` itself, because doing so would either open a
// second, independently-committable unit (if called outside a transaction) or
// silently be fine as a no-op savepoint (if called inside one) — the second
// case is the ONLY case `../audit/repository.ts` is allowed to rely on, and
// spelling out a `transaction()` call here would make it look like this module
// might run standalone, which the done criterion's "same outbox transaction"
// clause forbids.

import { sql } from 'drizzle-orm';
import type { DialectConnection } from '../dialect.js';
import { uuidv7 } from '../id.js';
import {
  CONSUMER_USAGE_BINDING_TYPE,
  CONSUMER_USAGE_BUCKET,
  CONSUMER_USAGE_IDENTITY_MISMATCH,
  CONSUMER_USAGE_LATENCY,
  CONSUMER_USAGE_REFUSAL,
  CONSUMER_USAGE_SUBJECT,
  CONSUMER_USAGE_TOOL,
} from '../schema/spec.js';
import type {
  ConsumerUsageBucket,
  ConsumerUsageGranularity,
  RecordUsageCallInput,
  UsageRepository,
} from './types.js';
import { CONSUMER_USAGE_GRANULARITIES } from './types.js';

const BUCKET = sql.identifier(CONSUMER_USAGE_BUCKET.name);
const REFUSAL = sql.identifier(CONSUMER_USAGE_REFUSAL.name);
const TOOL = sql.identifier(CONSUMER_USAGE_TOOL.name);
const BINDING_TYPE = sql.identifier(CONSUMER_USAGE_BINDING_TYPE.name);
const SUBJECT = sql.identifier(CONSUMER_USAGE_SUBJECT.name);
const LATENCY = sql.identifier(CONSUMER_USAGE_LATENCY.name);
const IDENTITY_MISMATCH = sql.identifier(CONSUMER_USAGE_IDENTITY_MISMATCH.name);

type Row = Record<string, unknown>;

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Floor an ISO-8601 UTC instant to the start of its hour or day. Text
 * manipulation rather than a date library: both dialects store `timestamp`
 * columns as ISO-8601 UTC text (schema/spec.ts), and a bucket boundary is
 * exactly the string prefix that survives truncation.
 */
export function bucketStartFor(granularity: ConsumerUsageGranularity, ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`bucketStartFor: "${ts}" is not a valid ISO-8601 instant.`);
  }
  const floored =
    granularity === 'day'
      ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
      : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours());
  return new Date(floored).toISOString();
}

export function usageRepository(connection: DialectConnection): UsageRepository {
  async function findBucket(
    consumerId: string,
    granularity: ConsumerUsageGranularity,
    bucketStart: string,
  ): Promise<Row | undefined> {
    const rows = await connection.all<Row>(
      sql`select * from ${BUCKET} where ${sql.identifier('consumer_id')} = ${consumerId} and ${sql.identifier('granularity')} = ${granularity} and ${sql.identifier('bucket_start')} = ${bucketStart}`,
    );
    return rows[0];
  }

  /**
   * Insert-or-ignore membership check for the three distinct-count side
   * tables: returns `true` (a first sighting, so the caller increments the
   * distinct count) only when the row did not already exist. Read-then-insert
   * rather than a dialect-specific `ON CONFLICT` clause, matching this
   * package's existing style of compiling one `sql` template for both engines
   * (`../audit/repository.ts` does the same for its own satellites).
   */
  async function firstSighting(
    table: ReturnType<typeof sql.identifier>,
    column: string,
    bucketId: string,
    value: string,
  ): Promise<boolean> {
    const col = sql.identifier(column);
    const existing = await connection.all<Row>(
      sql`select 1 as ${sql.identifier('n')} from ${table} where ${sql.identifier('bucket_id')} = ${bucketId} and ${col} = ${value}`,
    );
    if (existing.length > 0) return false;
    await connection.run(
      sql`insert into ${table} (${sql.identifier('id')}, ${sql.identifier('bucket_id')}, ${col}) values (${uuidv7()}, ${bucketId}, ${value})`,
    );
    return true;
  }

  async function upsertOneBucket(
    input: RecordUsageCallInput,
    granularity: ConsumerUsageGranularity,
    ts: string,
  ): Promise<void> {
    const bucketStart = bucketStartFor(granularity, ts);
    const existing = await findBucket(input.consumerId, granularity, bucketStart);

    const isWrite = input.isWrite ? 1 : 0;
    const isPlan = input.phase === 'plan' ? 1 : 0;
    // "plans never confirmed" (02 §11.6) is derived from minted vs confirmed —
    // an `execute` phase is what consumes the confirm token a `plan` minted
    // (02 §3.1.1), so it is the confirming event for this rollup's purposes.
    const isConfirm = input.phase === 'execute' ? 1 : 0;
    const bytesOut = input.bytesOut ?? 0;

    let bucketId: string;
    if (existing === undefined) {
      bucketId = uuidv7();
      await connection.run(
        sql`insert into ${BUCKET} (${sql.identifier('id')}, ${sql.identifier('consumer_id')}, ${sql.identifier('granularity')}, ${sql.identifier('bucket_start')}, ${sql.identifier('calls')}, ${sql.identifier('writes')}, ${sql.identifier('plans_minted')}, ${sql.identifier('plans_confirmed')}, ${sql.identifier('distinct_tools')}, ${sql.identifier('distinct_binding_types')}, ${sql.identifier('distinct_subjects')}, ${sql.identifier('bytes_out')}, ${sql.identifier('updated_at')}) values (${bucketId}, ${input.consumerId}, ${granularity}, ${bucketStart}, ${1}, ${isWrite}, ${isPlan}, ${isConfirm}, ${0}, ${0}, ${0}, ${bytesOut}, ${ts})`,
      );
    } else {
      bucketId = str(existing['id'])!;
      await connection.run(
        sql`update ${BUCKET} set ${sql.identifier('calls')} = ${sql.identifier('calls')} + ${1}, ${sql.identifier('writes')} = ${sql.identifier('writes')} + ${isWrite}, ${sql.identifier('plans_minted')} = ${sql.identifier('plans_minted')} + ${isPlan}, ${sql.identifier('plans_confirmed')} = ${sql.identifier('plans_confirmed')} + ${isConfirm}, ${sql.identifier('bytes_out')} = ${sql.identifier('bytes_out')} + ${bytesOut}, ${sql.identifier('updated_at')} = ${ts} where ${sql.identifier('id')} = ${bucketId}`,
      );
    }

    if (await firstSighting(TOOL, 'tool_id', bucketId, input.toolId)) {
      await connection.run(
        sql`update ${BUCKET} set ${sql.identifier('distinct_tools')} = ${sql.identifier('distinct_tools')} + 1 where ${sql.identifier('id')} = ${bucketId}`,
      );
    }
    if (
      input.bindingType !== null &&
      (await firstSighting(BINDING_TYPE, 'binding_type', bucketId, input.bindingType))
    ) {
      await connection.run(
        sql`update ${BUCKET} set ${sql.identifier('distinct_binding_types')} = ${sql.identifier('distinct_binding_types')} + 1 where ${sql.identifier('id')} = ${bucketId}`,
      );
    }
    if (await firstSighting(SUBJECT, 'caller_subject', bucketId, input.callerSubject)) {
      await connection.run(
        sql`update ${BUCKET} set ${sql.identifier('distinct_subjects')} = ${sql.identifier('distinct_subjects')} + 1 where ${sql.identifier('id')} = ${bucketId}`,
      );
    }

    // "refusals by error code" — only a non-ok outcome carrying an error code
    // is a refusal; an `ok` call with no error code touches nothing here.
    if (input.outcome !== 'ok' && input.errorCode) {
      const code = input.errorCode;
      const existingRefusal = await connection.all<Row>(
        sql`select ${sql.identifier('id')} from ${REFUSAL} where ${sql.identifier('bucket_id')} = ${bucketId} and ${sql.identifier('error_code')} = ${code}`,
      );
      const row = existingRefusal[0];
      if (row === undefined) {
        await connection.run(
          sql`insert into ${REFUSAL} (${sql.identifier('id')}, ${sql.identifier('bucket_id')}, ${sql.identifier('error_code')}, ${sql.identifier('count')}) values (${uuidv7()}, ${bucketId}, ${code}, ${1})`,
        );
      } else {
        await connection.run(
          sql`update ${REFUSAL} set ${sql.identifier('count')} = ${sql.identifier('count')} + 1 where ${sql.identifier('id')} = ${str(row['id'])}`,
        );
      }
    }

    if (input.latencyMsTotal !== undefined && input.latencyMsTotal !== null) {
      await connection.run(
        sql`insert into ${LATENCY} (${sql.identifier('id')}, ${sql.identifier('bucket_id')}, ${sql.identifier('latency_ms')}) values (${uuidv7()}, ${bucketId}, ${Math.trunc(input.latencyMsTotal)})`,
      );
    }

    // W0-N9 — "count of calls where identityMatch=false". A single-row-per-
    // bucket counter, the same read-then-increment shape as the bucket row
    // itself; `true` and `null`/absent never touch this table.
    if (input.identityMatch === false) {
      const existingMismatch = await connection.all<Row>(
        sql`select ${sql.identifier('id')} from ${IDENTITY_MISMATCH} where ${sql.identifier('bucket_id')} = ${bucketId}`,
      );
      const row = existingMismatch[0];
      if (row === undefined) {
        await connection.run(
          sql`insert into ${IDENTITY_MISMATCH} (${sql.identifier('id')}, ${sql.identifier('bucket_id')}, ${sql.identifier('count')}) values (${uuidv7()}, ${bucketId}, ${1})`,
        );
      } else {
        await connection.run(
          sql`update ${IDENTITY_MISMATCH} set ${sql.identifier('count')} = ${sql.identifier('count')} + 1 where ${sql.identifier('id')} = ${str(row['id'])}`,
        );
      }
    }
  }

  async function hydrateBucket(row: Row): Promise<ConsumerUsageBucket> {
    const bucketId = str(row['id'])!;
    const refusalRows = await connection.all<Row>(
      sql`select ${sql.identifier('error_code')}, ${sql.identifier('count')} from ${REFUSAL} where ${sql.identifier('bucket_id')} = ${bucketId} order by ${sql.identifier('error_code')}`,
    );
    const latencyRows = await connection.all<Row>(
      sql`select ${sql.identifier('latency_ms')} from ${LATENCY} where ${sql.identifier('bucket_id')} = ${bucketId} order by ${sql.identifier('latency_ms')} asc`,
    );
    const samples = latencyRows.map((r) => num(r['latency_ms']));
    const mismatchRows = await connection.all<Row>(
      sql`select ${sql.identifier('count')} from ${IDENTITY_MISMATCH} where ${sql.identifier('bucket_id')} = ${bucketId}`,
    );
    const identityMismatches = num(mismatchRows[0]?.['count']);
    // Exact p95, nearest-rank method: the smallest sample at or above the 95th
    // percentile rank — see schema/spec.ts's header for why an exact scan
    // (rather than a streaming digest) is the right call at Wave-0 volume.
    const p95 =
      samples.length === 0
        ? null
        : (samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)] ?? null);

    const plansMinted = num(row['plans_minted']);
    const plansConfirmed = num(row['plans_confirmed']);

    return {
      consumerId: str(row['consumer_id'])!,
      granularity: str(row['granularity']) as ConsumerUsageGranularity,
      bucketStart: str(row['bucket_start'])!,
      calls: num(row['calls']),
      writes: num(row['writes']),
      plansMinted,
      plansConfirmed,
      plansNeverConfirmed: Math.max(0, plansMinted - plansConfirmed),
      refusals: refusalRows.map((r) => ({
        errorCode: str(r['error_code'])!,
        count: num(r['count']),
      })),
      distinctTools: num(row['distinct_tools']),
      distinctBindingTypes: num(row['distinct_binding_types']),
      distinctSubjects: num(row['distinct_subjects']),
      bytesOut: num(row['bytes_out']),
      p95LatencyMs: p95,
      identityMismatches,
      updatedAt: str(row['updated_at'])!,
    };
  }

  return {
    async recordCall(input: RecordUsageCallInput): Promise<void> {
      const ts = input.ts ?? new Date().toISOString();
      for (const granularity of CONSUMER_USAGE_GRANULARITIES) {
        await upsertOneBucket(input, granularity, ts);
      }
    },

    async getBucket(
      consumerId: string,
      granularity: ConsumerUsageGranularity,
      bucketStart: string,
    ): Promise<ConsumerUsageBucket | undefined> {
      const row = await findBucket(consumerId, granularity, bucketStart);
      return row === undefined ? undefined : hydrateBucket(row);
    },

    bucketStartFor,
  };
}
