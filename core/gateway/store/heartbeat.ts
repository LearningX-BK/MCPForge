// MCPForge — the `store_heartbeat` repository. The implementation is one
// implementation, not one per dialect: the statements are built from the single
// schema definition's column names and compiled by drizzle for whichever
// dialect is connected, so a query cannot drift between engines by hand.

import { sql } from 'drizzle-orm';
import type { DialectConnection } from './dialect.js';
import { STORE_HEARTBEAT } from './schema/spec.js';
import { uuidv7 } from './id.js';
import type { StoreKind } from './config.js';
import type { Heartbeat, HeartbeatRepository, RecordHeartbeatInput } from './repository.js';

const T = sql.identifier(STORE_HEARTBEAT.name);
const C = {
  id: sql.identifier('id'),
  instanceId: sql.identifier('instance_id'),
  storeKind: sql.identifier('store_kind'),
  observedAt: sql.identifier('observed_at'),
  note: sql.identifier('note'),
} as const;

interface HeartbeatRow extends Record<string, unknown> {
  id: string;
  instance_id: string;
  store_kind: string;
  observed_at: string;
  note: string | null;
}

function toHeartbeat(row: HeartbeatRow): Heartbeat {
  return {
    id: row.id,
    instanceId: row.instance_id,
    storeKind: row.store_kind as StoreKind,
    observedAt: row.observed_at,
    note: row.note ?? null,
  };
}

export function heartbeatRepository(connection: DialectConnection): HeartbeatRepository {
  const select = sql`select ${C.id}, ${C.instanceId}, ${C.storeKind}, ${C.observedAt}, ${C.note} from ${T}`;

  return {
    async record(input: RecordHeartbeatInput): Promise<Heartbeat> {
      const row: HeartbeatRow = {
        // UUIDv7 in the application — never gen_random_uuid() (02 §10.4 item 4).
        id: uuidv7(),
        instance_id: input.instanceId,
        store_kind: connection.kind,
        observed_at: input.observedAt ?? new Date().toISOString(),
        note: input.note ?? null,
      };
      await connection.run(
        sql`insert into ${T} (${C.id}, ${C.instanceId}, ${C.storeKind}, ${C.observedAt}, ${C.note}) values (${row.id}, ${row.instance_id}, ${row.store_kind}, ${row.observed_at}, ${row.note})`,
      );
      return toHeartbeat(row);
    },

    async get(id: string): Promise<Heartbeat | undefined> {
      const rows = await connection.all<HeartbeatRow>(sql`${select} where ${C.id} = ${id}`);
      const first = rows[0];
      return first === undefined ? undefined : toHeartbeat(first);
    },

    async listRecent(limit: number): Promise<Heartbeat[]> {
      const capped = Math.max(0, Math.trunc(limit));
      const rows = await connection.all<HeartbeatRow>(
        sql`${select} order by ${C.observedAt} desc, ${C.id} desc limit ${capped}`,
      );
      return rows.map(toHeartbeat);
    },

    async deleteOlderThan(observedAtIso: string): Promise<number> {
      // Counted then deleted inside one transaction, so the number returned is
      // the number actually removed on both dialects — `changes` and
      // `rowCount` are driver-specific and would not survive the swap.
      return connection.transaction(async () => {
        const counted = await connection.all<{ n: number }>(
          sql`select count(*) as ${sql.identifier('n')} from ${T} where ${C.observedAt} < ${observedAtIso}`,
        );
        const n = Number(counted[0]?.n ?? 0);
        await connection.run(sql`delete from ${T} where ${C.observedAt} < ${observedAtIso}`);
        return n;
      });
    },
  };
}
