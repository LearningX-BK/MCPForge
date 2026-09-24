// MCPForge — the PostgreSQL projection of `./spec.ts`. Same rule as its SQLite
// twin: no column is declared here, only rendered. 02 §10.2 — Postgres is a
// "driver, connection-string and migration-set change, not a rewrite", and
// this file is what keeps that true.

import { boolean, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import type { AnyPgColumn, PgColumnBuilderBase } from 'drizzle-orm/pg-core';
import { RUNTIME_TABLES, type ColumnSpec, type TableSpec } from './spec.js';

/** Mirrors the SQLite projection's foreign-key registry — see `./sqlite.ts`. */
const built = new Map<string, Record<string, AnyPgColumn>>();

function referencedColumn(table: string, columnName: string): AnyPgColumn {
  const target = built.get(table)?.[columnName];
  if (target === undefined) {
    throw new Error(`Foreign key targets ${table}.${columnName}, which is not projected yet.`);
  }
  return target;
}

function column(name: string, spec: ColumnSpec): PgColumnBuilderBase {
  const kinded = (() => {
    switch (spec.kind) {
      case 'integer':
        return integer(name);
      case 'boolean':
        return boolean(name);
      case 'text':
      case 'timestamp': // ISO-8601 UTC text, matching SQLite — see spec.ts.
      case 'json': // JSON document as text; a jsonb operator would break parity (02 §10.4 item 5).
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

function columns(spec: TableSpec): Record<string, PgColumnBuilderBase> {
  return Object.fromEntries(
    Object.entries(spec.columns).map(([name, col]) => [name, column(name, col)]),
  );
}

function table(spec: TableSpec) {
  const projected = pgTable(spec.name, columns(spec), (t) =>
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
  built.set(spec.name, projected as unknown as Record<string, AnyPgColumn>);
  return projected;
}

export const storeHeartbeat = table(RUNTIME_TABLES.storeHeartbeat);
// W0-C2 — same order as the SQLite projection, from the same definition.
export const auditCall = table(RUNTIME_TABLES.auditCall);
export const auditResultKey = table(RUNTIME_TABLES.auditResultKey);
export const auditCallRole = table(RUNTIME_TABLES.auditCallRole);
export const auditCredentialRef = table(RUNTIME_TABLES.auditCredentialRef);
export const auditRetentionGate = table(RUNTIME_TABLES.auditRetentionGate);
// W0-C3 — same order as the SQLite projection, from the same definition.
export const idempotencyRecord = table(RUNTIME_TABLES.idempotencyRecord);
export const confirmNonce = table(RUNTIME_TABLES.confirmNonce);
export const approvalRequest = table(RUNTIME_TABLES.approvalRequest);
// W0-D2 — same order as the SQLite projection, from the same definition.
export const localUser = table(RUNTIME_TABLES.localUser);
export const localUserGroup = table(RUNTIME_TABLES.localUserGroup);
// W0-E5 — the kill switch.
export const runtimeFlags = table(RUNTIME_TABLES.runtimeFlags);
// W0-N7 — consumer usage rollups; same order as the SQLite projection.
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
