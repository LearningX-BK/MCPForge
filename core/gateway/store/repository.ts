// MCPForge — the repository interface. 02 §1.5, restated by §10.2: "**all
// runtime persistence goes through a thin repository interface**
// (`core/gateway/store/*.ts`)". Every store operation in the product is
// reachable only through `RuntimeStore`; nothing above this module holds a
// connection, a driver handle, or a SQL string.
//
// W0-C1 defined the seam and one repository; W0-C2 adds `audit`; W0-C3 adds
// the write path's runtime state — `idempotency`, `nonces` and `approvals`. The
// rest are separate tasks and are deliberately absent here: identity mappings
// (W0-D1), the kill switch (W0-E5). Each adds its table to `schema/spec.ts` and
// its repository property to `RuntimeStore`.

import type { StoreDescriptor, StoreKind } from './config.js';
import type { AuditRepository } from './audit/types.js';
import type { AuditRetentionRepository } from './audit/retention.js';
import type {
  ApprovalRepository,
  ConfirmNonceRepository,
  IdempotencyRepository,
} from './runtime/types.js';
import type { LocalUserRepository } from './identity/types.js';
import type { RuntimeFlagsRepository } from './flags/types.js';
import type { UsageRepository } from './usage/types.js';
import type { AnomalyEventRepository } from './anomaly/types.js';
import type { ConsumptionRepository } from './consumption/types.js';

/** One `store_heartbeat` row. Times are ISO-8601 UTC strings (schema/spec.ts). */
export interface Heartbeat {
  readonly id: string;
  readonly instanceId: string;
  readonly storeKind: StoreKind;
  readonly observedAt: string;
  readonly note: string | null;
}

export interface RecordHeartbeatInput {
  readonly instanceId: string;
  readonly note?: string;
  /** Injectable clock, so the contract suite does not depend on wall time. */
  readonly observedAt?: string;
}

export interface HeartbeatRepository {
  record(input: RecordHeartbeatInput): Promise<Heartbeat>;
  get(id: string): Promise<Heartbeat | undefined>;
  /** Most recent first — UUIDv7 ids make that a primary-key-ordered scan. */
  listRecent(limit: number): Promise<Heartbeat[]>;
  /** Retention. Returns the number of rows removed. */
  deleteOlderThan(observedAtIso: string): Promise<number>;
}

/**
 * The only sanctioned entry point to runtime state.
 *
 * `kind` is what the gateway API surfaces as `runtime.store.kind` for the
 * portal's data-class chip (03 §11.2, 02 §10.5).
 */
export interface RuntimeStore {
  readonly kind: StoreKind;
  readonly descriptor: StoreDescriptor;
  readonly heartbeats: HeartbeatRepository;
  /**
   * The append-only audit trail (W0-C2, 02 §4.6). Append and read only —
   * there is deliberately no update or delete on it. On SQLite the trigger
   * layer that backs that makes tampering **detectable, not preventable**
   * (02 §10.4 item 1); see `./audit/immutability.ts`.
   */
  readonly audit: AuditRepository;
  /**
   * Retention (W0-C4, 02 §4.6) — **the single exception to append-only**, and
   * the only path in the product that can delete an audit row. It is a
   * separate property rather than a method on `audit` precisely so that "the
   * audit repository cannot delete" remains true as written: deletion is
   * gated, prefix-only, and writes its own hash-chained attestation row.
   */
  readonly retention: AuditRetentionRepository;
  /**
   * Idempotency records (W0-C3, 02 §3.1.2). Written **before** the binding is
   * invoked and completed after; a repeat inside `scopeHours` replays the
   * original result rather than executing again.
   */
  readonly idempotency: IdempotencyRepository;
  /**
   * Single-use confirm nonces (W0-C3, 02 §3.1.1). Consume inside the same
   * transaction as the execute — that is what makes single-use and the write
   * atomic together rather than merely adjacent.
   */
  readonly nonces: ConfirmNonceRepository;
  /**
   * The `awaiting_human_approval` queue's state machine (W0-C3, 02 §3.1.1).
   * The gateway owns the state machine; Phase 3 owns the queue's UX.
   */
  readonly approvals: ApprovalRepository;
  /**
   * The Wave 0 local accounts (W0-D2, 02 §4.4). Persistence only: this
   * repository hashes nothing and verifies nothing, and credential material
   * leaves it through exactly one method (`findCredential`), consumed only by
   * `core/gateway/identity/local/**`.
   */
  readonly localUsers: LocalUserRepository;
  /**
   * The kill switch's persistence (W0-E5, 02 §4.7). Append-only from the
   * caller's point of view — `clear` soft-flips `active` rather than deleting,
   * so the history of who kill-switched what, and when it was lifted, is
   * never lost.
   */
  readonly runtimeFlags: RuntimeFlagsRepository;
  /**
   * Hourly and daily consumer usage rollups (W0-N7, 02 §11.6). Written by
   * `audit.append` from inside its own transaction — never call
   * `usage.recordCall` directly from outside the audit path, or the "same
   * outbox transaction" guarantee is broken.
   */
  readonly usage: UsageRepository;
  /**
   * The `anomaly_event` trail (W0-N8, 02 §11.6). Append plus one triage
   * transition (`setState`) and nothing else — a detector never holds this
   * interface at all; it is handed frozen data and returns frozen data, and
   * `core/gateway/anomaly/runner.ts` is the only writer.
   */
  readonly anomalies: AnomalyEventRepository;
  /**
   * The `consumption_edge` feed (W0-N10, 02 §4.6/§11.3) — "tool -> consuming
   * agent", where the consuming agent is the AUTHENTICATED `consumer_id` and
   * never a self-declared client name. Written by `audit.append` from inside
   * its own transaction; never call `consumption.recordEdge` directly from
   * outside the audit path, or the feed can carry an edge for a call the trail
   * does not record.
   */
  readonly consumption: ConsumptionRepository;
  /** Apply the migration set generated for the active dialect. */
  migrate(): Promise<void>;
  /**
   * Run `work` inside one transaction on the active connection.
   *
   * **Reentrant** (W0-C3): a `transaction` opened inside another one JOINS it
   * as a savepoint rather than starting a second, independent unit, so the
   * write path — consume the nonce, write the idempotency record, invoke the
   * binding, append the audit row — composes into ONE atomic unit out of
   * repository methods that each transact internally. See `./dialect.ts`.
   *
   * That atomicity is atomic **on one node**: the Wave 0 gateway runs as one
   * instance and SQLite is a single-writer, single-host store (02 §10.4 item
   * 6). Multi-replica is a Postgres-era property.
   */
  transaction<T>(work: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
