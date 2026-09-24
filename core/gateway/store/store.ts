// MCPForge — the runtime store factory. `openRuntimeStore` is the only way to
// obtain a `RuntimeStore`, and a `RuntimeStore` is the only way to reach
// runtime state. 02 §10.2.

import { describeStore, storeConfigFromEnv, type StoreConfig } from './config.js';
import { openConnection } from './dialect.js';
import { heartbeatRepository } from './heartbeat.js';
import { auditRepository } from './audit/repository.js';
import { applyAuditImmutability } from './audit/immutability.js';
import { auditRetentionRepository } from './audit/retention.js';
import { idempotencyRepository } from './runtime/idempotency.js';
import { confirmNonceRepository } from './runtime/nonce.js';
import { approvalRepository } from './runtime/approvals.js';
import { localUserRepository } from './identity/local-user.js';
import { runtimeFlagsRepository } from './flags/repository.js';
import { usageRepository } from './usage/repository.js';
import { consumptionRepository } from './consumption/repository.js';
import { anomalyEventRepository } from './anomaly/repository.js';
import type { RuntimeStore } from './repository.js';

export interface OpenRuntimeStoreOptions {
  /** Apply the active dialect's migration set on open. Defaults to true. */
  readonly migrate?: boolean;
}

export async function openRuntimeStore(
  config: StoreConfig = storeConfigFromEnv(),
  options: OpenRuntimeStoreOptions = {},
): Promise<RuntimeStore> {
  const connection = await openConnection(config);
  if (options.migrate !== false) {
    await connection.migrate();
    // The append-only triggers are applied after the migration set, on every
    // open, and are idempotent. They are NOT part of the drizzle-kit output:
    // drizzle-kit generates table DDL from the schema projections, and a
    // trigger hand-added to a generated file would be lost on the next
    // regeneration. On SQLite this makes tampering detectable, not
    // preventable (02 §10.4 item 1).
    await applyAuditImmutability(connection);
  }
  // W0-N7 — built before the audit repository so it can be passed in: usage
  // rollups are written from INSIDE `audit.append`'s own transaction, never as
  // a second, separately-committed write (02 §11.6).
  const usage = usageRepository(connection);
  // W0-N10 — likewise built before the audit repository: the consumption edge
  // is written from INSIDE `audit.append`'s own transaction, fed from the row
  // it just wrote (02 §4.6, §11.3).
  const consumption = consumptionRepository(connection);
  const audit = auditRepository(connection, { usage, consumption });
  return {
    kind: connection.kind,
    descriptor: describeStore(config),
    heartbeats: heartbeatRepository(connection),
    audit,
    usage,
    // W0-N10 — the consumption feed (02 §4.6). Read-only from above; its one
    // writer is `audit.append`.
    consumption,
    // W0-C4 — the one gated deletion path. It takes the audit repository
    // because its attestation row is appended through the ordinary audit path,
    // hashed and chained by the same code every other row is.
    retention: auditRetentionRepository(connection, audit),
    // W0-C3 — the write path's runtime state. All three share the one
    // connection, which is what lets `store.transaction(...)` wrap a nonce
    // consume, an idempotency claim and an audit append into one unit.
    idempotency: idempotencyRepository(connection),
    nonces: confirmNonceRepository(connection),
    approvals: approvalRepository(connection),
    // W0-D2 — the local user store's persistence.
    localUsers: localUserRepository(connection),
    // W0-E5 — the kill switch's persistence.
    runtimeFlags: runtimeFlagsRepository(connection),
    // W0-N8 — the anomaly event trail (02 §11.6).
    anomalies: anomalyEventRepository(connection),
    migrate: async () => {
      await connection.migrate();
      await applyAuditImmutability(connection);
    },
    transaction: (work) => connection.transaction(work),
    close: () => connection.close(),
  };
}
