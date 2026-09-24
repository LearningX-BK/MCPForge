// MCPForge — the `approval_request` repository. W0-C3, 02 §3.1.1.
//
// The `awaiting_human_approval` state machine's persistence, and nothing more.
// 02 §3.1.1 draws the line: *"Phase 3 owns that queue's UX; the gateway owns
// the state machine."* No confirm token is minted until a human approves
// (W0-F2 owns the minting); no policy about WHO may approve lives here.
//
// 02 §10.3 draws the other line: the approval **record** — the governance
// artefact in `approvals/` — is git, and the approval **queue's runtime state**
// is the store. This table is the second of those, which is why deleting
// `.mcpforge/` loses in-flight approvals and loses no governance evidence
// (`W0-C6`).

import { sql } from 'drizzle-orm';
import type { DialectConnection } from '../dialect.js';
import { uuidv7 } from '../id.js';
import { APPROVAL_REQUEST } from '../schema/spec.js';
import {
  ApprovalNotPendingError,
  type ApprovalRepository,
  type ApprovalRequest,
  type ApprovalStatus,
  type CreateApprovalInput,
  type DecideApprovalInput,
} from './types.js';

/**
 * 02 §3.1.1 shows the agent-facing id as `apr_…`, and the id IS agent-facing:
 * it is returned in the plan response and polled back with it. UUIDv7
 * underneath (02 §10.4 item 4), so ids stay time-ordered and the prefix costs
 * nothing but legibility in a log.
 */
export const APPROVAL_ID_PREFIX = 'apr_' as const;

export function approvalId(): string {
  return `${APPROVAL_ID_PREFIX}${uuidv7()}`;
}

const T = sql.identifier(APPROVAL_REQUEST.name);
const C = {
  id: sql.identifier('id'),
  planHash: sql.identifier('plan_hash'),
  argsCanonicalHash: sql.identifier('args_canonical_hash'),
  planSummary: sql.identifier('plan_summary'),
  callerSubject: sql.identifier('caller_subject'),
  consumerId: sql.identifier('consumer_id'),
  toolId: sql.identifier('tool_id'),
  toolVersion: sql.identifier('tool_version'),
  status: sql.identifier('status'),
  approverSubject: sql.identifier('approver_subject'),
  decisionReason: sql.identifier('decision_reason'),
  decidedAt: sql.identifier('decided_at'),
  createdAt: sql.identifier('created_at'),
  expiresAt: sql.identifier('expires_at'),
} as const;

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function required(row: Row, column: string): string {
  const value = text(row[column]);
  if (value === null) {
    throw new Error(`${APPROVAL_REQUEST.name}.${column} is NOT NULL but came back null.`);
  }
  return value;
}

function toRequest(row: Row): ApprovalRequest {
  return {
    id: required(row, 'id'),
    planHash: required(row, 'plan_hash'),
    argsCanonicalHash: required(row, 'args_canonical_hash'),
    planSummary: text(row['plan_summary']),
    callerSubject: required(row, 'caller_subject'),
    consumerId: text(row['consumer_id']),
    toolId: required(row, 'tool_id'),
    toolVersion: text(row['tool_version']),
    status: required(row, 'status') as ApprovalStatus,
    approverSubject: text(row['approver_subject']),
    decisionReason: text(row['decision_reason']),
    decidedAt: text(row['decided_at']),
    createdAt: required(row, 'created_at'),
    expiresAt: required(row, 'expires_at'),
  };
}

export function approvalRepository(connection: DialectConnection): ApprovalRepository {
  const select = sql`select * from ${T}`;

  async function read(id: string): Promise<ApprovalRequest | undefined> {
    const rows = await connection.all<Row>(sql`${select} where ${C.id} = ${id}`);
    const first = rows[0];
    return first === undefined ? undefined : toRequest(first);
  }

  return {
    async create(input: CreateApprovalInput): Promise<ApprovalRequest> {
      const request: ApprovalRequest = {
        id: approvalId(),
        planHash: input.planHash,
        argsCanonicalHash: input.argsCanonicalHash,
        planSummary: input.planSummary ?? null,
        callerSubject: input.callerSubject,
        consumerId: input.consumerId ?? null,
        toolId: input.toolId,
        toolVersion: input.toolVersion ?? null,
        status: 'pending',
        approverSubject: null,
        decisionReason: null,
        decidedAt: null,
        createdAt: input.now ?? new Date().toISOString(),
        expiresAt: input.expiresAt,
      };
      await connection.run(
        sql`insert into ${T} (${C.id}, ${C.planHash}, ${C.argsCanonicalHash}, ${C.planSummary}, ${C.callerSubject}, ${C.consumerId}, ${C.toolId}, ${C.toolVersion}, ${C.status}, ${C.approverSubject}, ${C.decisionReason}, ${C.decidedAt}, ${C.createdAt}, ${C.expiresAt}) values (${request.id}, ${request.planHash}, ${request.argsCanonicalHash}, ${request.planSummary}, ${request.callerSubject}, ${request.consumerId}, ${request.toolId}, ${request.toolVersion}, ${request.status}, ${null}, ${null}, ${null}, ${request.createdAt}, ${request.expiresAt})`,
      );
      return request;
    },

    get(id: string): Promise<ApprovalRequest | undefined> {
      return read(id);
    },

    async listPending(limit?: number): Promise<ApprovalRequest[]> {
      const bounded = limit === undefined ? sql`` : sql` limit ${Math.max(0, Math.trunc(limit))}`;
      const rows = await connection.all<Row>(
        sql`${select} where ${C.status} = ${'pending'} order by ${C.createdAt} asc, ${C.id} asc${bounded}`,
      );
      return rows.map(toRequest);
    },

    /**
     * **The transition is guarded in SQL** — `… where status = 'pending'` — and
     * the whole read-decide-read runs in one transaction. Two approvers acting
     * at the same instant therefore produce one decision and one
     * `ApprovalNotPendingError`, not a lost update in which the second silently
     * overwrites the first's name on the record.
     *
     * An expired request is decided by nobody: expiry is applied first, so
     * approving something whose window has closed refuses rather than quietly
     * reviving it.
     */
    decide(input: DecideApprovalInput): Promise<ApprovalRequest> {
      const now = input.now ?? new Date().toISOString();
      return connection.transaction(async () => {
        await connection.run(
          sql`update ${T} set ${C.status} = ${'expired'} where ${C.status} = ${'pending'} and ${C.expiresAt} < ${now} and ${C.id} = ${input.id}`,
        );
        const before = await read(input.id);
        if (before === undefined) {
          throw new Error(`No approval request ${input.id}.`);
        }
        // Checked here so the refusal can NAME the state that blocked it, and
        // guarded again in the `update` below so the check is not what the
        // atomicity rests on. Two approvers acting at once are separated by the
        // `where status = 'pending'` clause, not by this read.
        if (before.status !== 'pending') {
          throw new ApprovalNotPendingError(input.id, before.status);
        }
        await connection.run(
          sql`update ${T} set ${C.status} = ${input.status}, ${C.approverSubject} = ${input.approverSubject}, ${C.decisionReason} = ${input.reason ?? null}, ${C.decidedAt} = ${now} where ${C.id} = ${input.id} and ${C.status} = ${'pending'}`,
        );
        const decided = await read(input.id);
        if (decided === undefined) {
          throw new Error(`No approval request ${input.id}.`);
        }
        if (decided.status !== input.status) {
          throw new ApprovalNotPendingError(input.id, decided.status);
        }
        return decided;
      });
    },

    expireDue(nowIso?: string): Promise<number> {
      const now = nowIso ?? new Date().toISOString();
      // Counted then updated inside one transaction — `changes` and `rowCount`
      // are driver-specific and would not survive the dialect swap.
      return connection.transaction(async () => {
        const counted = await connection.all<{ n: number }>(
          sql`select count(*) as ${sql.identifier('n')} from ${T} where ${C.status} = ${'pending'} and ${C.expiresAt} < ${now}`,
        );
        const n = Number(counted[0]?.n ?? 0);
        await connection.run(
          sql`update ${T} set ${C.status} = ${'expired'} where ${C.status} = ${'pending'} and ${C.expiresAt} < ${now}`,
        );
        return n;
      });
    },
  };
}
