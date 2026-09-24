// MCPForge — the SQLite projection of `./spec.ts`. This file declares no
// column of its own; it mechanically renders the single schema definition into
// drizzle's SQLite builders so that `drizzle-kit generate` can emit the SQLite
// migration set. 02 §10.2.

import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn, SQLiteColumnBuilderBase } from 'drizzle-orm/sqlite-core';
import { RUNTIME_TABLES, type ColumnSpec, type TableSpec } from './spec.js';

/**
 * Tables already projected, keyed by physical name, so a `references` spec can
 * be resolved. Drizzle takes the referenced column through a thunk, so the
 * lookup happens after every table is built — but `RUNTIME_TABLES` is declared
 * in dependency order anyway, which is what keeps this honest rather than
 * merely lucky.
 */
const built = new Map<string, Record<string, AnySQLiteColumn>>();

function referencedColumn(table: string, columnName: string): AnySQLiteColumn {
  const target = built.get(table)?.[columnName];
  if (target === undefined) {
    throw new Error(`Foreign key targets ${table}.${columnName}, which is not projected yet.`);
  }
  return target;
}

function column(name: string, spec: ColumnSpec): SQLiteColumnBuilderBase {
  const kinded = (() => {
    switch (spec.kind) {
      case 'integer':
        return integer(name);
      case 'boolean':
        // 0/1 in SQLite; drizzle's boolean mode gives the same TS value the
        // Postgres projection gives, which is the parity this file exists for.
        return integer(name, { mode: 'boolean' });
      case 'text':
      case 'timestamp': // ISO-8601 UTC text — see spec.ts.
      case 'json': // JSON document as text; read with json_extract (02 §10.4 item 5).
        return text(name);
    }
  })();
  const ref = spec.references;
  const base =
    ref === undefined ? kinded : kinded.references(() => referencedColumn(ref.table, ref.column));
  const withNotNull = spec.notNull === true ? base.notNull() : base;
  const withPk = spec.primaryKey === true ? withNotNull.primaryKey() : withNotNull;
  return spec.unique === true ? withPk.unique() : withPk;
}

function columns(spec: TableSpec): Record<string, SQLiteColumnBuilderBase> {
  return Object.fromEntries(
    Object.entries(spec.columns).map(([name, col]) => [name, column(name, col)]),
  );
}

function table(spec: TableSpec) {
  const projected = sqliteTable(spec.name, columns(spec), (t) =>
    (spec.indexes ?? []).map((ix) => {
      const cols = ix.columns.map((c) => t[c]).filter((c) => c !== undefined);
      const [first, ...rest] = cols;
      if (first === undefined) {
        throw new Error(`Index ${ix.name} names no column that exists on ${spec.name}.`);
      }
      const builder = ix.unique === true ? uniqueIndex(ix.name) : index(ix.name);
      return builder.on(first, ...rest);
    }),
  );
  built.set(spec.name, projected as unknown as Record<string, AnySQLiteColumn>);
  return projected;
}

export const storeHeartbeat = table(RUNTIME_TABLES.storeHeartbeat);
// W0-C2 — declared in `spec.ts`'s dependency order: `audit_call` before the
// satellites that reference it.
export const auditCall = table(RUNTIME_TABLES.auditCall);
export const auditResultKey = table(RUNTIME_TABLES.auditResultKey);
export const auditCallRole = table(RUNTIME_TABLES.auditCallRole);
export const auditCredentialRef = table(RUNTIME_TABLES.auditCredentialRef);
export const auditRetentionGate = table(RUNTIME_TABLES.auditRetentionGate);
// W0-C3 — the write path's runtime state.
export const idempotencyRecord = table(RUNTIME_TABLES.idempotencyRecord);
export const confirmNonce = table(RUNTIME_TABLES.confirmNonce);
export const approvalRequest = table(RUNTIME_TABLES.approvalRequest);
// W0-D2 — the local user store; `local_user` before the table referencing it.
export const localUser = table(RUNTIME_TABLES.localUser);
export const localUserGroup = table(RUNTIME_TABLES.localUserGroup);
// W0-E5 — the kill switch.
export const runtimeFlags = table(RUNTIME_TABLES.runtimeFlags);
// W0-N7 — consumer usage rollups; `consumerUsageBucket` before its satellites.
export const consumerUsageBucket = table(RUNTIME_TABLES.consumerUsageBucket);
export const consumerUsageRefusal = table(RUNTIME_TABLES.consumerUsageRefusal);
export const consumerUsageTool = table(RUNTIME_TABLES.consumerUsageTool);
export const consumerUsageBindingType = table(RUNTIME_TABLES.consumerUsageBindingType);
export const consumerUsageSubject = table(RUNTIME_TABLES.consumerUsageSubject);
export const consumerUsageLatency = table(RUNTIME_TABLES.consumerUsageLatency);
// W0-N9 — the identity-echo-mismatch rollup.
export const consumerUsageIdentityMismatch = table(RUNTIME_TABLES.consumerUsageIdentityMismatch);

// W0-N8 — the anomaly event trail; `anomalyEvent` before the side table
// that references it (and `auditCall`, which it also references, is above).
export const anomalyEvent = table(RUNTIME_TABLES.anomalyEvent);
export const anomalyEventAuditCall = table(RUNTIME_TABLES.anomalyEventAuditCall);

// W0-N10 — 02 §4.6's `consumption_edge`; after `auditCall`, which it references.
export const consumptionEdge = table(RUNTIME_TABLES.consumptionEdge);
