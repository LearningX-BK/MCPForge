// MCPForge — the `consumption_edge` repository. W0-N10, 02 §4.6/§11.3.
//
// One implementation, not one per dialect, matching every other repository in
// this package. Every write here runs INSIDE the caller's already-open
// transaction (`../dialect.ts`'s reentrant `AsyncLocalStorage` scope); this
// module never calls `connection.transaction` itself, for the reason
// `../usage/repository.ts` spells out at length — a `transaction()` call here
// would make it look as though the feed might legitimately run standalone,
// which the "fed from the audit row" property forbids.

import { sql, type SQL } from 'drizzle-orm';
import type { DialectConnection } from '../dialect.js';
import { uuidv7 } from '../id.js';
import { CONSUMPTION_EDGE } from '../schema/spec.js';
import type {
  ConsumptionEdge,
  ConsumptionRepository,
  ListConsumptionEdgesFilter,
  RecordConsumptionInput,
} from './types.js';

const EDGE = sql.identifier(CONSUMPTION_EDGE.name);

type Row = Record<string, unknown>;

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function required(row: Row, column: string): string {
  const value = str(row[column]);
  if (value === null) {
    throw new Error(`consumption_edge.${column} is NOT NULL but came back null.`);
  }
  return value;
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toEdge(row: Row): ConsumptionEdge {
  return {
    deploymentId: required(row, 'deployment_id'),
    consumerId: required(row, 'consumer_id'),
    toolId: required(row, 'tool_id'),
    bindingType: str(row['binding_type']),
    lastCallId: required(row, 'last_call_id'),
    firstSeenAt: required(row, 'first_seen_at'),
    lastSeenAt: required(row, 'last_seen_at'),
    callCount: num(row['call_count']),
    writeCount: num(row['write_count']),
  };
}

/**
 * The one guard that makes "authenticated or absent" a property of the code
 * rather than of the caller's good manners.
 *
 * `consumer_id` reaches `audit_call` only from a `LoadedConsumer` that `[2a]`
 * verified, so a blank one cannot arise from an authenticated session at all —
 * which is exactly why a blank one arriving here means something upstream
 * invented a consumer rather than resolving one. The response is to throw,
 * inside the audit transaction, which rolls the audit row back with it. That
 * is deliberate and it is the safe direction: a refused call is recoverable, a
 * consumption feed carrying an unauthenticated agent is not.
 */
function assertAuthenticatedConsumerId(value: string): void {
  if (value.trim().length === 0) {
    throw new Error(
      'consumption_edge: refusing to write an edge with no consumer id. The consuming agent is the authenticated `consumer_id` from step [2a] (02 §11.3) — never a self-declared name, and never a placeholder. If no consumer was resolved, the edge is absent.',
    );
  }
}

export function consumptionRepository(connection: DialectConnection): ConsumptionRepository {
  const ALL = sql.join(
    Object.keys(CONSUMPTION_EDGE.columns).map((name) => sql.identifier(name)),
    sql`, `,
  );

  async function find(
    deploymentId: string,
    consumerId: string,
    toolId: string,
  ): Promise<Row | undefined> {
    const rows = await connection.all<Row>(
      sql`select ${ALL} from ${EDGE} where ${sql.identifier('deployment_id')} = ${deploymentId} and ${sql.identifier('consumer_id')} = ${consumerId} and ${sql.identifier('tool_id')} = ${toolId}`,
    );
    return rows[0];
  }

  return {
    async recordEdge(input: RecordConsumptionInput): Promise<void> {
      assertAuthenticatedConsumerId(input.consumerId);

      const write = input.isWrite ? 1 : 0;
      const existing = await find(input.deploymentId, input.consumerId, input.toolId);

      if (existing === undefined) {
        await connection.run(
          sql`insert into ${EDGE} (${ALL}) values (${uuidv7()}, ${input.deploymentId}, ${input.consumerId}, ${input.toolId}, ${input.bindingType}, ${input.callId}, ${input.ts}, ${input.ts}, ${1}, ${write})`,
        );
        return;
      }

      // `first_seen_at` is never rewritten — an edge's opening date is the fact
      // "when did this agent first reach this tool", and an update path that
      // could move it forward would erase exactly the answer the feed exists
      // to give.
      await connection.run(
        sql`update ${EDGE} set ${sql.identifier('call_count')} = ${sql.identifier('call_count')} + ${1}, ${sql.identifier('write_count')} = ${sql.identifier('write_count')} + ${write}, ${sql.identifier('binding_type')} = ${input.bindingType}, ${sql.identifier('last_call_id')} = ${input.callId}, ${sql.identifier('last_seen_at')} = ${input.ts} where ${sql.identifier('id')} = ${required(existing, 'id')}`,
      );
    },

    async listEdges(filter: ListConsumptionEdgesFilter = {}): Promise<ConsumptionEdge[]> {
      const wheres: SQL[] = [];
      if (filter.deploymentId !== undefined) {
        wheres.push(sql`${sql.identifier('deployment_id')} = ${filter.deploymentId}`);
      }
      if (filter.consumerId !== undefined) {
        wheres.push(sql`${sql.identifier('consumer_id')} = ${filter.consumerId}`);
      }
      if (filter.toolId !== undefined) {
        wheres.push(sql`${sql.identifier('tool_id')} = ${filter.toolId}`);
      }
      const where = wheres.length === 0 ? sql`` : sql` where ${sql.join(wheres, sql` and `)}`;
      const limit =
        filter.limit === undefined ? sql`` : sql` limit ${Math.max(0, Math.floor(filter.limit))}`;
      const rows = await connection.all<Row>(
        sql`select ${ALL} from ${EDGE}${where} order by ${sql.identifier('last_seen_at')} desc, ${sql.identifier('id')} desc${limit}`,
      );
      return rows.map(toEdge);
    },

    async getEdge(deploymentId, consumerId, toolId) {
      const row = await find(deploymentId, consumerId, toolId);
      return row === undefined ? undefined : toEdge(row);
    },
  };
}
