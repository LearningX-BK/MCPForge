// MCPForge — the `runtime_flags` repository. W0-E5.
//
// One implementation, not one per dialect, matching every other repository in
// this store (`../heartbeat.ts`, `../audit/repository.ts`): the statements are
// built from the single schema definition's column names and compiled by
// drizzle for whichever dialect is connected.

import { sql } from 'drizzle-orm';
import type { DialectConnection } from '../dialect.js';
import { uuidv7 } from '../id.js';
import { RUNTIME_FLAG } from '../schema/spec.js';
import type { KillScope } from '../../scope/types.js';
import type { CreateRuntimeFlagInput, RuntimeFlagsRepository, StoredRuntimeFlag } from './types.js';

const T = sql.identifier(RUNTIME_FLAG.name);
const C = {
  id: sql.identifier('id'),
  scope: sql.identifier('scope'),
  target: sql.identifier('target'),
  reason: sql.identifier('reason'),
  until: sql.identifier('until'),
  createdBy: sql.identifier('created_by'),
  createdAt: sql.identifier('created_at'),
  auditCallId: sql.identifier('audit_call_id'),
  active: sql.identifier('active'),
} as const;

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function required(row: Row, column: string): string {
  const value = text(row[column]);
  if (value === null) {
    throw new Error(`${RUNTIME_FLAG.name}.${column} is NOT NULL but came back null.`);
  }
  return value;
}

function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value === '1' || value === 't' || value === 'true';
}

function toFlag(row: Row): StoredRuntimeFlag {
  return {
    id: required(row, 'id'),
    scope: required(row, 'scope') as KillScope,
    target: required(row, 'target'),
    reason: required(row, 'reason'),
    until: text(row['until']),
    createdBy: required(row, 'created_by'),
    createdAt: required(row, 'created_at'),
    auditCallId: text(row['audit_call_id']),
    active: bool(row['active']),
  };
}

export function runtimeFlagsRepository(connection: DialectConnection): RuntimeFlagsRepository {
  const select = sql`select * from ${T}`;
  const bindable = (value: unknown): unknown =>
    typeof value === 'boolean' && connection.kind === 'sqlite' ? (value ? 1 : 0) : value;

  return {
    async create(input: CreateRuntimeFlagInput): Promise<StoredRuntimeFlag> {
      const row = {
        id: uuidv7(),
        scope: input.scope,
        target: input.target,
        reason: input.reason,
        until: input.until ?? null,
        created_by: input.createdBy,
        created_at: input.now ?? new Date().toISOString(),
        audit_call_id: input.auditCallId ?? null,
        active: true,
      };
      await connection.run(
        sql`insert into ${T} (${C.id}, ${C.scope}, ${C.target}, ${C.reason}, ${C.until}, ${C.createdBy}, ${C.createdAt}, ${C.auditCallId}, ${C.active}) values (${row.id}, ${row.scope}, ${row.target}, ${row.reason}, ${row.until}, ${row.created_by}, ${row.created_at}, ${row.audit_call_id}, ${bindable(row.active)})`,
      );
      return toFlag(row);
    },

    async get(id: string): Promise<StoredRuntimeFlag | undefined> {
      const rows = await connection.all<Row>(sql`${select} where ${C.id} = ${id}`);
      const first = rows[0];
      return first === undefined ? undefined : toFlag(first);
    },

    async listActive(): Promise<StoredRuntimeFlag[]> {
      const activeValue = connection.kind === 'sqlite' ? 1 : true;
      const rows = await connection.all<Row>(
        sql`${select} where ${C.active} = ${activeValue} order by ${C.id} asc`,
      );
      return rows.map(toFlag);
    },

    async clear(id: string, now?: string): Promise<StoredRuntimeFlag | undefined> {
      const inactiveValue = bindable(false);
      await connection.run(
        sql`update ${T} set ${C.active} = ${inactiveValue} where ${C.id} = ${id}`,
      );
      void now; // clearing does not change created_at/until; kept for interface symmetry.
      const rows = await connection.all<Row>(sql`${select} where ${C.id} = ${id}`);
      const first = rows[0];
      return first === undefined ? undefined : toFlag(first);
    },
  };
}
