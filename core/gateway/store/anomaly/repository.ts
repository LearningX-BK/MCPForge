// MCPForge — the `anomaly_event` repository. W0-N8, 02 §11.6.
//
// One implementation, not one per dialect, matching every other repository in
// this package. The two-table shape (`anomaly_event` + its normalised
// `anomaly_event_audit_call` side table, 02 §10.4 item 2) is known ONLY here:
// every caller above sees `auditCallIds` as an ordinary array.

import { sql } from 'drizzle-orm';
import type { DialectConnection } from '../dialect.js';
import { uuidv7 } from '../id.js';
import { ANOMALY_EVENT, ANOMALY_EVENT_AUDIT_CALL } from '../schema/spec.js';
import {
  ANOMALY_EVENT_STATES,
  ANOMALY_SEVERITIES,
  type AnomalyEvent,
  type AnomalyEventRepository,
  type AnomalyEventState,
  type AnomalySeverity,
  type ListAnomalyEventsFilter,
  type RecordAnomalyEventInput,
} from './types.js';

const T = sql.identifier(ANOMALY_EVENT.name);
const EVIDENCE = sql.identifier(ANOMALY_EVENT_AUDIT_CALL.name);
const C = {
  id: sql.identifier('id'),
  ts: sql.identifier('ts'),
  consumerId: sql.identifier('consumer_id'),
  detectorId: sql.identifier('detector_id'),
  severity: sql.identifier('severity'),
  window: sql.identifier('window'),
  observed: sql.identifier('observed'),
  threshold: sql.identifier('threshold'),
  state: sql.identifier('state'),
  eventId: sql.identifier('event_id'),
  callId: sql.identifier('call_id'),
} as const;

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function required(row: Row, column: string): string {
  const value = text(row[column]);
  if (value === null) {
    throw new Error(`${ANOMALY_EVENT.name}.${column} is NOT NULL but came back null.`);
  }
  return value;
}

/**
 * Canonical decimal text for a number column — see `schema/spec.ts`'s
 * `ANOMALY_EVENT` header for why `observed`/`threshold` are text. Rejects
 * anything that is not a finite number rather than silently storing `"NaN"`,
 * because an alert whose observed value is unreadable is worse than no alert.
 */
function numberToText(name: string, value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`anomaly_event.${name} must be a finite number, got ${String(value)}.`);
  }
  return String(value);
}

function textToNumber(row: Row, column: string): number {
  const parsed = Number(required(row, column));
  if (!Number.isFinite(parsed)) {
    throw new Error(`${ANOMALY_EVENT.name}.${column} is not a readable number.`);
  }
  return parsed;
}

function checkedSeverity(value: string): AnomalySeverity {
  if (!(ANOMALY_SEVERITIES as readonly string[]).includes(value)) {
    throw new Error(
      `"${value}" is not an anomaly severity. One of: ${ANOMALY_SEVERITIES.join(', ')}.`,
    );
  }
  return value as AnomalySeverity;
}

function checkedState(value: string): AnomalyEventState {
  if (!(ANOMALY_EVENT_STATES as readonly string[]).includes(value)) {
    throw new Error(
      `"${value}" is not an anomaly event state. One of: ${ANOMALY_EVENT_STATES.join(', ')}.`,
    );
  }
  return value as AnomalyEventState;
}

export function anomalyEventRepository(connection: DialectConnection): AnomalyEventRepository {
  async function evidenceFor(eventId: string): Promise<string[]> {
    const rows = await connection.all<Row>(
      sql`select ${C.callId} from ${EVIDENCE} where ${C.eventId} = ${eventId} order by ${C.callId} asc`,
    );
    return rows.map((r) => required(r, 'call_id'));
  }

  async function hydrate(row: Row): Promise<AnomalyEvent> {
    const id = required(row, 'id');
    return {
      id,
      ts: required(row, 'ts'),
      consumerId: required(row, 'consumer_id'),
      detectorId: required(row, 'detector_id'),
      severity: checkedSeverity(required(row, 'severity')),
      window: required(row, 'window'),
      observed: textToNumber(row, 'observed'),
      threshold: textToNumber(row, 'threshold'),
      auditCallIds: await evidenceFor(id),
      state: checkedState(required(row, 'state')),
    };
  }

  async function hydrateAll(rows: readonly Row[]): Promise<AnomalyEvent[]> {
    const out: AnomalyEvent[] = [];
    for (const row of rows) out.push(await hydrate(row));
    return out;
  }

  async function findById(id: string): Promise<Row | undefined> {
    const rows = await connection.all<Row>(sql`select * from ${T} where ${C.id} = ${id}`);
    return rows[0];
  }

  return {
    async record(input: RecordAnomalyEventInput): Promise<AnomalyEvent> {
      const id = uuidv7();
      const ts = input.ts ?? new Date().toISOString();
      const severity = checkedSeverity(input.severity);
      const state = checkedState(input.state ?? 'open');
      const observed = numberToText('observed', input.observed);
      const threshold = numberToText('threshold', input.threshold);
      // De-duplicated here rather than relying on the side table's UNIQUE
      // index to reject: a detector naming the same call twice is a harmless
      // detector bug, not a reason to lose the whole event.
      const callIds = [...new Set(input.auditCallIds)];

      // One unit of work: an event without its evidence would be an alert
      // nobody can act on, which is the failure 02 §11.6's side table exists
      // to prevent. Reentrant — joins the caller's transaction if there is one.
      return connection.transaction(async () => {
        await connection.run(
          sql`insert into ${T} (${C.id}, ${C.ts}, ${C.consumerId}, ${C.detectorId}, ${C.severity}, ${C.window}, ${C.observed}, ${C.threshold}, ${C.state}) values (${id}, ${ts}, ${input.consumerId}, ${input.detectorId}, ${severity}, ${input.window}, ${observed}, ${threshold}, ${state})`,
        );
        for (const callId of callIds) {
          await connection.run(
            sql`insert into ${EVIDENCE} (${C.id}, ${C.eventId}, ${C.callId}) values (${uuidv7()}, ${id}, ${callId})`,
          );
        }
        return {
          id,
          ts,
          consumerId: input.consumerId,
          detectorId: input.detectorId,
          severity,
          window: input.window,
          observed: input.observed,
          threshold: input.threshold,
          auditCallIds: [...callIds].sort(),
          state,
        };
      });
    },

    async get(id: string): Promise<AnomalyEvent | undefined> {
      const row = await findById(id);
      return row === undefined ? undefined : hydrate(row);
    },

    async list(filter: ListAnomalyEventsFilter = {}): Promise<AnomalyEvent[]> {
      const clauses = [sql`1 = 1`];
      if (filter.consumerId !== undefined)
        clauses.push(sql`${C.consumerId} = ${filter.consumerId}`);
      if (filter.detectorId !== undefined)
        clauses.push(sql`${C.detectorId} = ${filter.detectorId}`);
      if (filter.state !== undefined) clauses.push(sql`${C.state} = ${checkedState(filter.state)}`);
      const where = sql.join(clauses, sql` and `);
      const limit = Math.max(1, Math.trunc(filter.limit ?? 100));
      const rows = await connection.all<Row>(
        sql`select * from ${T} where ${where} order by ${C.ts} desc, ${C.id} desc limit ${limit}`,
      );
      return hydrateAll(rows);
    },

    async listByAuditCall(callId: string): Promise<AnomalyEvent[]> {
      const rows = await connection.all<Row>(
        sql`select ${T}.* from ${T} join ${EVIDENCE} on ${EVIDENCE}.${C.eventId} = ${T}.${C.id} where ${EVIDENCE}.${C.callId} = ${callId} order by ${T}.${C.ts} desc`,
      );
      return hydrateAll(rows);
    },

    async setState(id: string, state: AnomalyEventState): Promise<AnomalyEvent | undefined> {
      const checked = checkedState(state);
      await connection.run(sql`update ${T} set ${C.state} = ${checked} where ${C.id} = ${id}`);
      const row = await findById(id);
      return row === undefined ? undefined : hydrate(row);
    },
  };
}
