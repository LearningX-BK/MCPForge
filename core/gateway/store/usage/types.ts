// MCPForge — the `consumer_usage` repository's types. W0-N7, 02 §11.6.
//
// One TypeScript field per aggregated quantity 02 §11.6 names verbatim:
// "calls · writes · plans minted · plans never confirmed · refusals by error
// code · distinct tools touched · distinct binding types touched · distinct
// human subjects acted for · bytes out · p95 latency". `plansNeverConfirmed`
// and `p95LatencyMs` are DERIVED at read time (see `./repository.ts`) rather
// than stored columns — see `schema/spec.ts`'s `CONSUMER_USAGE_BUCKET` header
// for why that is a correctness choice, not a shortcut.

/** 02 §11.6 — "hourly and daily rollups". A closed, two-member set. */
export const CONSUMER_USAGE_GRANULARITIES = ['hour', 'day'] as const;
export type ConsumerUsageGranularity = (typeof CONSUMER_USAGE_GRANULARITIES)[number];

/** One (consumer, error code) refusal count within a bucket. */
export interface ConsumerUsageRefusal {
  readonly errorCode: string;
  readonly count: number;
}

/** One hourly or daily rollup, exactly as read back — 02 §11.6's full list. */
export interface ConsumerUsageBucket {
  readonly consumerId: string;
  readonly granularity: ConsumerUsageGranularity;
  /** ISO-8601 UTC, floored to the start of the hour or day. */
  readonly bucketStart: string;

  readonly calls: number;
  readonly writes: number;
  readonly plansMinted: number;
  readonly plansConfirmed: number;
  /** Derived: `plansMinted - plansConfirmed`, floored at 0 — see the header note above. */
  readonly plansNeverConfirmed: number;
  readonly refusals: readonly ConsumerUsageRefusal[];
  readonly distinctTools: number;
  readonly distinctBindingTypes: number;
  /** "distinct human subjects acted for" — the subject-fan-out detector's raw material (W0-N8). */
  readonly distinctSubjects: number;
  readonly bytesOut: number;
  /** Exact p95 over the bucket's own latency samples, or `null` with zero samples. */
  readonly p95LatencyMs: number | null;
  /**
   * W0-N9 — count of calls in this bucket whose `audit_call.identity_match`
   * was `false`. Backs `consumer_usage_identity_mismatch`
   * (`../schema/spec.ts`) — the `identity-echo-mismatch` detector's raw
   * material. A call whose `identityMatch` is `null` (identity carriage not
   * applicable to that binding) never increments this count.
   */
  readonly identityMismatches: number;

  readonly updatedAt: string;
}

/**
 * One call's worth of usage-relevant facts, in the shape the audit repository
 * already has to hand while it holds `AppendAuditCallInput` and the row it
 * just built — never re-derived from a second source, and never re-read from
 * the row it just wrote, because both would be a second serialisation of the
 * same fact (schema/spec.ts's own rule for `row_hash`, applied here too).
 */
export interface RecordUsageCallInput {
  readonly consumerId: string;
  /** `Principal.subject` — the only identity value written (CLAUDE.md §3). */
  readonly callerSubject: string;
  readonly toolId: string;
  readonly bindingType: string | null;
  readonly isWrite: boolean;
  /** 02 §4.6 — `plan | execute | reject | reverse`. */
  readonly phase: 'plan' | 'execute' | 'reject' | 'reverse';
  /** 02 §4.6 — `ok | business_error | policy_denied | binding_error | timeout`. */
  readonly outcome: 'ok' | 'business_error' | 'policy_denied' | 'binding_error' | 'timeout';
  readonly errorCode?: string | null;
  readonly bytesOut?: number | null;
  readonly latencyMsTotal?: number | null;
  /**
   * `audit_call.identity_match` (W0-N9) — `false` increments
   * `consumer_usage_identity_mismatch`; `true` or `null`/absent do not.
   */
  readonly identityMatch?: boolean | null;
  /** Injectable clock, so tests do not depend on wall time. Defaults to now. */
  readonly ts?: string;
}

/**
 * The usage repository. `recordCall` is called from INSIDE
 * `AuditRepository.append`'s own transaction (`../audit/repository.ts`), never
 * as a second, separately-committed write — 02 §11.6: "written from the same
 * outbox transaction as the audit row".
 */
export interface UsageRepository {
  /**
   * Upsert-increment both the hourly and the daily bucket for one call. Must
   * be called on a `DialectConnection` that already has an open transaction
   * scope (the reentrant `AsyncLocalStorage` scope in `../dialect.ts`) so the
   * increments join the caller's unit of work rather than opening a second one.
   */
  recordCall(input: RecordUsageCallInput): Promise<void>;
  /** Read one bucket back, or `undefined` if no call has landed in it yet. */
  getBucket(
    consumerId: string,
    granularity: ConsumerUsageGranularity,
    bucketStart: string,
  ): Promise<ConsumerUsageBucket | undefined>;
  /**
   * The bucket a given instant falls into, floored to the granularity's unit
   * — what `getBucket` needs and what the quota check (`../caps/**`) reads
   * "this consumer's current window" with.
   */
  bucketStartFor(granularity: ConsumerUsageGranularity, ts: string): string;
}
