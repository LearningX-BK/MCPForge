// MCPForge — the runtime store's public surface. Everything above
// `core/gateway/store/` imports from here and from nowhere deeper: the driver
// modules, the connection and the SQL live behind this boundary (02 §10.2).
//
// `./dialect.js` is deliberately NOT re-exported. It is the only file that
// touches `better-sqlite3` and `pg`, and exporting a live connection would
// hand callers a way around the repository interface.

export {
  DEFAULT_SQLITE_PATH,
  WAVE_0_SINGLE_INSTANCE,
  describeStore,
  storeConfigFromEnv,
  type PostgresStoreConfig,
  type SqliteStoreConfig,
  type StoreConfig,
  type StoreDescriptor,
  type StoreKind,
} from './config.js';
export { isUuidv7, uuidv7, uuidv7Millis } from './id.js';
export {
  type Heartbeat,
  type HeartbeatRepository,
  type RecordHeartbeatInput,
  type RuntimeStore,
} from './repository.js';
// `openRuntimeStore` (and `./store.js` generally) is deliberately NOT
// re-exported here. `store.ts` imports `./dialect.js`, which is the ONLY file
// that touches `better-sqlite3`/`pg`/`node:fs` — and this barrel is the one
// portal *client* components reach through `@mcpforge/gateway/store` for
// client-safe types (`StoreDescriptor`, `describeStore`, …). Bundling
// `store.ts` in here would drag the native driver and Node builtins into the
// browser bundle and crash those routes. Server code that actually needs to
// open a store imports `openRuntimeStore` from `@mcpforge/gateway/store/server`
// (`./server.ts`), which re-exports this whole barrel plus that one function.
export type { OpenRuntimeStoreOptions } from './store.js';
// W0-C2 — the audit trail. `./audit/hash.js` is deliberately NOT re-exported
// here: it imports `node:crypto` for `auditRowHash`'s `createHash`, so — same
// reasoning as `./dialect.js` above — it belongs only in the server-only
// surface. `forge audit verify` (W0-C4) still recomputes with THIS
// implementation, never a second one; it just reaches it via
// `@mcpforge/gateway/store/server`. Only the value-free type is safe here.
export type { AuditHashValue } from './audit/hash.js';
// `applyAuditImmutability` and `sqliteAppendOnlyDdl` are deliberately NOT
// re-exported. The first takes a live DialectConnection; the second hands out
// executable DDL. Both would be a route around `RuntimeStore`, which is what
// `driver-isolation.test.ts` guards. Immutability is applied from `store.ts`
// on every open; the two constants below are documentation, not statements to
// run against the live store.
export { APPEND_ONLY_TABLES, POSTGRES_IMMUTABILITY_RECOMMENDATION } from './audit/immutability.js';
// W0-C4 — `forge audit verify` and the retention job. The verification TYPES
// are exported because the CLI renders them and the portal's Integrity panel
// (Phase 3 §5.3) will too; the walk itself is reached only through
// `RuntimeStore.audit.verifyChain`, never as a loose function over a
// connection, for the same reason `applyAuditImmutability` is not exported.
export {
  type AuditChainBreak,
  type AuditChainBreakReason,
  type AuditChainOrigin,
  type AuditChainStatus,
  type AuditChainVerification,
} from './audit/verify.js';
// The attestation vocabulary is exported so a reader of an audit row — the
// portal, an operator, a future SIEM mapping — can recognise a retention row
// without re-deriving its shape. `parseRetentionAttestation` is the only
// sanctioned way to decide whether an `args_redacted` value IS one.
export {
  AUDIT_RETENTION_ATTESTATION_KIND,
  AUDIT_RETENTION_TOOL_ID,
  parseRetentionAttestation,
  type AuditRetentionAttestation,
} from './audit/attestation.js';
export {
  type AuditRetentionRepository,
  type RetentionSweepRecord,
  type RetentionSweepResult,
  type RunRetentionSweepInput,
} from './audit/retention.js';
export {
  type AppendAuditCallInput,
  type AuditCallRecord,
  type AuditCredentialRef,
  type AuditOutcome,
  type AuditPhase,
  type AuditRepository,
  type AuditResultKey,
  type CompensatingControl,
} from './audit/types.js';
// W0-C3 — the write path's runtime state. `./runtime/idempotency.js` is
// deliberately NOT re-exported here: it imports `node:crypto` for
// `createHash`, same reasoning as `./audit/hash.js` above, so it lives only
// in the server-only surface (`@mcpforge/gateway/store/server`). The policy
// chain (W0-F3) still derives the key with THIS implementation, never a
// second one that could drift — it just reaches it via `/server`.
export { APPROVAL_ID_PREFIX } from './runtime/approvals.js';
export {
  ApprovalNotPendingError,
  ConfirmNonceAlreadyConsumedError,
  IdempotencyNotPendingError,
  type ApprovalRepository,
  type ApprovalRequest,
  type ApprovalStatus,
  type BeginIdempotentInput,
  type BeginIdempotentOutcome,
  type BeginIdempotentResult,
  type CompleteIdempotentInput,
  type ConfirmNonceConsumption,
  type ConfirmNonceRepository,
  type ConsumeNonceInput,
  type CreateApprovalInput,
  type DecideApprovalInput,
  type FailIdempotentInput,
  type IdempotencyLookupOptions,
  type IdempotencyRecord,
  type IdempotencyRepository,
  type IdempotencyStatus,
} from './runtime/types.js';
// W0-D2 — the local user store's persistence. `LocalUserCredential` is
// exported as a TYPE because `core/gateway/identity/local/**` must name what
// `findCredential` returns; nothing about that export widens who can obtain
// one, which is still only through `RuntimeStore.localUsers.findCredential`.
export {
  LocalUserExistsError,
  LocalUserNotFoundError,
  type CreateLocalUserInput,
  type LocalUserCredential,
  type LocalUserRecord,
  type LocalUserRepository,
  type RecordLocalAuthInput,
  type SetLocalPasswordInput,
  type SetLocalTotpInput,
  type UpdateLocalUserInput,
} from './identity/types.js';
export { RUNTIME_TABLES, type ColumnKind, type ColumnSpec, type TableSpec } from './schema/spec.js';
// W0-E5 — the kill switch's persistence.
export {
  type CreateRuntimeFlagInput,
  type RuntimeFlagsRepository,
  type StoredRuntimeFlag,
} from './flags/types.js';
// W0-N7 — consumer usage rollups (02 §11.6). `bucketStartFor` is exported for
// the same reason the audit hash helpers are: the caps quota check
// (`core/gateway/caps/consumer-quota.ts`) must compute "this consumer's
// current window" with the SAME bucket-flooring rule the rollup itself uses,
// never a second one that could disagree at a boundary.
export { bucketStartFor } from './usage/repository.js';
export {
  CONSUMER_USAGE_GRANULARITIES,
  type ConsumerUsageBucket,
  type ConsumerUsageGranularity,
  type ConsumerUsageRefusal,
  type RecordUsageCallInput,
  type UsageRepository,
} from './usage/types.js';
// W0-N10 — the consumption feed (02 §4.6, §11.3). `consumptionRepository` is
// exported for symmetry with `anomalyEventRepository` below, NOT as a second
// write path: `audit.append` is the only caller of `recordEdge` in the
// product, which is what keeps the feed's rows in step with the trail's.
export { consumptionRepository } from './consumption/repository.js';
export {
  type ConsumptionEdge,
  type ConsumptionRepository,
  type ListConsumptionEdgesFilter,
  type RecordConsumptionInput,
} from './consumption/types.js';
// W0-N8 — the anomaly event schema (02 §11.6). Exported as the store surface
// the Wave 3 monitoring product reads; the DETECTOR side of the substrate is
// `core/gateway/anomaly/**` and deliberately does not travel through here.
export { anomalyEventRepository } from './anomaly/repository.js';
export {
  ANOMALY_EVENT_STATES,
  ANOMALY_SEVERITIES,
  type AnomalyEvent,
  type AnomalyEventRepository,
  type AnomalyEventState,
  type AnomalySeverity,
  type ListAnomalyEventsFilter,
  type RecordAnomalyEventInput,
} from './anomaly/types.js';
