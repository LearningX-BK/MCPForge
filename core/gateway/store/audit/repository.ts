// MCPForge — the `audit_call` repository. W0-C2.
//
// One implementation, not one per dialect: the statements are built from the
// single schema definition's column names and compiled by drizzle for
// whichever dialect is connected, matching `../heartbeat.ts`. The audit path
// is a governance surface, so the SQL is kept legible in review (02 §10.2,
// "SQL-shaped, not SQL-hiding") rather than hidden behind a query builder.
//
// **On SQLite this makes tampering detectable, not preventable** (02 §10.4
// item 1) — see `./hash.ts` and `./immutability.ts` for the full statement of
// what that does and does not buy.

import { sql, type SQL } from 'drizzle-orm';
import type { DialectConnection } from '../dialect.js';
import { uuidv7 } from '../id.js';
import {
  AUDIT_CALL,
  AUDIT_CALL_ROLE,
  AUDIT_CREDENTIAL_REF,
  AUDIT_RESULT_KEY,
} from '../schema/spec.js';
import type { UsageRepository } from '../usage/types.js';
import type { ConsumptionRepository } from '../consumption/types.js';
import { AUDIT_CHAIN_GENESIS, auditRowHash, type AuditHashValue } from './hash.js';
import { listAuditDeployments, verifyAuditChain } from './verify.js';
import type {
  AppendAuditCallInput,
  AuditCallRecord,
  AuditCredentialRef,
  AuditOutcome,
  AuditPhase,
  AuditRepository,
  AuditResultKey,
  CompensatingControl,
} from './types.js';

const CALL = sql.identifier(AUDIT_CALL.name);
const RESULT_KEY = sql.identifier(AUDIT_RESULT_KEY.name);
const CALL_ROLE = sql.identifier(AUDIT_CALL_ROLE.name);
const CREDENTIAL_REF = sql.identifier(AUDIT_CREDENTIAL_REF.name);

const CALL_COLUMNS: readonly string[] = Object.keys(AUDIT_CALL.columns);

/** `id, ts, correlation_id, …` — every column, in the single definition's order. */
const CALL_COLUMN_LIST: SQL = sql.join(
  CALL_COLUMNS.map((name) => sql.identifier(name)),
  sql`, `,
);

type CallRow = Record<string, unknown>;

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function required(row: CallRow, column: string): string {
  const value = text(row[column]);
  if (value === null) {
    throw new Error(`audit_call.${column} is NOT NULL but came back null.`);
  }
  return value;
}

/**
 * Booleans cross the dialect boundary differently — SQLite stores 0/1 integers,
 * Postgres a real boolean — so both shapes are coerced here rather than left to
 * a per-dialect mapper, which is where drift hides (schema/spec.ts).
 */
function bool(value: unknown): boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return value === '1' || value === 't' || value === 'true';
}

function requiredBool(row: CallRow, column: string): boolean {
  const value = bool(row[column]);
  if (value === null) {
    throw new Error(`audit_call.${column} is NOT NULL but came back null.`);
  }
  return value;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJson(value: unknown): unknown {
  const raw = text(value);
  if (raw === null) {
    return null;
  }
  return JSON.parse(raw) as unknown;
}

/**
 * Deterministic JSON for the `json` columns. Keys are NOT reordered: the
 * canonical form in `./hash.ts` hashes exactly the bytes stored, so the row
 * must be serialised once, hashed, and stored — never serialised twice.
 */
function toJsonText(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/**
 * The snake_case row, ready both to hash and to insert. Built once per append:
 * hashing one serialisation and storing another would produce a chain that
 * never verifies.
 */
function buildRow(
  input: AppendAuditCallInput,
  id: string,
  prevHash: string,
): Record<string, AuditHashValue> {
  const resultKeys = input.resultKeys ?? [];
  return {
    id,
    ts: input.ts ?? new Date().toISOString(),
    correlation_id: input.correlationId ?? null,
    session_id: input.sessionId ?? null,
    parent_call_id: input.parentCallId ?? null,

    caller_subject: input.callerSubject,
    caller_display: input.callerDisplay ?? null,
    caller_idp: input.callerIdp ?? null,
    caller_amr: input.callerAmr ?? null,
    caller_roles: toJsonText(input.callerRoles ?? []),
    on_behalf_of: input.onBehalfOf ?? null,

    consumer_id: input.consumerId,
    consumer_record_sha: input.consumerRecordSha ?? null,
    consumer_auth_method: input.consumerAuthMethod ?? null,
    consumer_session_id: input.consumerSessionId ?? null,
    human_in_the_loop: input.humanInTheLoop,

    tool_id: input.toolId,
    tool_version: input.toolVersion ?? null,
    manifest_sha: input.manifestSha ?? null,
    server_id: input.serverId ?? null,
    package_id: input.packageId ?? null,
    binding_type: input.bindingType ?? null,
    archetype: input.archetype ?? null,
    verb: input.verb ?? null,
    entity: input.entity ?? null,
    sensitivity_class: input.sensitivityClass ?? null,
    is_write: input.isWrite,

    target_system: input.targetSystem ?? null,
    target_env: input.targetEnv ?? null,
    target_object: input.targetObject ?? null,
    deployment_id: input.deploymentId,
    gateway_version: input.gatewayVersion ?? null,
    bundle_version: input.bundleVersion ?? null,

    phase: input.phase,
    confirm_token_hash: input.confirmTokenHash ?? null,
    plan_hash: input.planHash ?? null,
    args_hash: input.argsHash ?? null,
    idempotency_key: input.idempotencyKey ?? null,
    replayed: input.replayed ?? null,

    args_redacted: toJsonText(input.argsRedacted),
    result_keys: toJsonText(resultKeys),
    row_count: input.rowCount ?? null,
    bytes_out: input.bytesOut ?? null,

    outcome: input.outcome,
    error_code: input.errorCode ?? null,
    error_message_agent: input.errorMessageAgent ?? null,
    denied_by_rule: input.deniedByRule ?? null,

    identity_carrying: input.identityCarrying ?? null,
    target_identity_observed: input.targetIdentityObserved ?? null,
    identity_match: input.identityMatch ?? null,
    compensating_control: input.compensatingControl ?? null,

    reversal_class: input.reversalClass ?? null,
    reversal_tool_id: input.reversalToolId ?? null,
    reverses_call_id: input.reversesCallId ?? null,
    reversed_by_call_id: input.reversedByCallId ?? null,

    latency_ms_total: input.latencyMsTotal ?? null,
    latency_ms_gateway: input.latencyMsGateway ?? null,
    latency_ms_target: input.latencyMsTarget ?? null,

    prev_hash: prevHash,
    row_hash: '', // replaced below, and excluded from the hash by construction.
  };
}

function toRecord(
  row: CallRow,
  roles: readonly string[],
  resultKeys: readonly AuditResultKey[],
  credentialRefs: readonly AuditCredentialRef[],
  /**
   * The RESOLVED backward link (W0-F5). Supplied only by the read paths that
   * answer "show me this one call" — `get` and `reversalLinks`. `listChain` and
   * the hash walk pass nothing, because they must present the stored row
   * verbatim: a resolved value in a row a verifier is reading would be a second
   * version of that row.
   */
  reversedByCallId: string | null = null,
): AuditCallRecord {
  return {
    id: required(row, 'id'),
    ts: required(row, 'ts'),
    correlationId: text(row['correlation_id']),
    sessionId: text(row['session_id']),
    parentCallId: text(row['parent_call_id']),

    callerSubject: required(row, 'caller_subject'),
    callerDisplay: text(row['caller_display']),
    callerIdp: text(row['caller_idp']),
    callerAmr: text(row['caller_amr']),
    callerRoles: roles,
    onBehalfOf: text(row['on_behalf_of']),

    consumerId: required(row, 'consumer_id'),
    consumerRecordSha: text(row['consumer_record_sha']),
    consumerAuthMethod: text(row['consumer_auth_method']),
    consumerSessionId: text(row['consumer_session_id']),
    humanInTheLoop: requiredBool(row, 'human_in_the_loop'),

    toolId: required(row, 'tool_id'),
    toolVersion: text(row['tool_version']),
    manifestSha: text(row['manifest_sha']),
    serverId: text(row['server_id']),
    packageId: text(row['package_id']),
    bindingType: text(row['binding_type']),
    archetype: text(row['archetype']),
    verb: text(row['verb']),
    entity: text(row['entity']),
    sensitivityClass: text(row['sensitivity_class']),
    isWrite: requiredBool(row, 'is_write'),

    targetSystem: text(row['target_system']),
    targetEnv: text(row['target_env']),
    targetObject: text(row['target_object']),
    deploymentId: required(row, 'deployment_id'),
    gatewayVersion: text(row['gateway_version']),
    bundleVersion: text(row['bundle_version']),

    phase: required(row, 'phase') as AuditPhase,
    confirmTokenHash: text(row['confirm_token_hash']),
    planHash: text(row['plan_hash']),
    argsHash: text(row['args_hash']),
    idempotencyKey: text(row['idempotency_key']),
    replayed: bool(row['replayed']),

    argsRedacted: parseJson(row['args_redacted']),
    resultKeys,
    rowCount: num(row['row_count']),
    bytesOut: num(row['bytes_out']),

    outcome: required(row, 'outcome') as AuditOutcome,
    errorCode: text(row['error_code']),
    errorMessageAgent: text(row['error_message_agent']),
    deniedByRule: text(row['denied_by_rule']),

    identityCarrying: bool(row['identity_carrying']),
    targetIdentityObserved: text(row['target_identity_observed']),
    identityMatch: bool(row['identity_match']),
    compensatingControl: text(row['compensating_control']) as CompensatingControl | null,

    reversalClass: text(row['reversal_class']),
    reversalToolId: text(row['reversal_tool_id']),
    reversesCallId: text(row['reverses_call_id']),
    reversedByCallId: text(row['reversed_by_call_id']) ?? reversedByCallId,

    latencyMsTotal: num(row['latency_ms_total']),
    latencyMsGateway: num(row['latency_ms_gateway']),
    latencyMsTarget: num(row['latency_ms_target']),

    prevHash: required(row, 'prev_hash'),
    rowHash: required(row, 'row_hash'),

    credentialRefs,
  };
}

export interface AuditRepositoryOptions {
  /**
   * W0-N7, 02 §11.6 — "written from the same outbox transaction as the audit
   * row". Optional so every existing caller (and every test not exercising
   * usage) is unaffected; when supplied, `append` calls
   * `usage.recordCall(...)` INSIDE the same `connection.transaction` as the
   * row and satellite inserts above, never as a second, separately-committed
   * write. A failure in the usage write therefore rolls the audit row back
   * with it, and vice versa — see `../usage/usage-atomicity.test.ts`.
   */
  readonly usage?: UsageRepository;
  /**
   * W0-N10, 02 §4.6/§11.3 — the `consumption_edge` feed. Wired exactly like
   * `usage` above and for the same reason: the edge is written INSIDE this
   * append's own transaction, so a rolled-back call takes its consumption
   * record with it.
   *
   * Every value the feed receives is read back out of `row` — the snake_case
   * record this append just built and hashed — rather than from `input`. The
   * distinction is the whole point of the wiring: `row` is what the audit trail
   * will show, so an edge sourced from it cannot disagree with the trail, and
   * there is no second argument path by which a caller could feed the edge
   * something it did not also write into `audit_call`.
   */
  readonly consumption?: ConsumptionRepository;
}

export function auditRepository(
  connection: DialectConnection,
  options: AuditRepositoryOptions = {},
): AuditRepository {
  const selectCall = sql`select ${CALL_COLUMN_LIST} from ${CALL}`;

  /**
   * Booleans are bound per dialect: `better-sqlite3` refuses to bind a
   * JavaScript boolean at all, and Postgres refuses an integer for a `boolean`
   * column. One place, both shapes — the alternative is a runtime error on
   * whichever engine the author did not have open.
   */
  const bindable = (value: AuditHashValue): AuditHashValue =>
    typeof value === 'boolean' && connection.kind === 'sqlite' ? (value ? 1 : 0) : value;

  /**
   * **The concurrency assumption, stated rather than assumed.** Computing
   * `prev_hash` means reading the deployment's chain head and inserting the
   * successor; if two appends interleaved between that read and that insert,
   * both would claim the same predecessor and the chain would fork.
   *
   * Three things close that, in order of strength:
   *  1. The unique index `audit_call_chain_link_uq (deployment_id, prev_hash)`
   *     — the database refuses the second row outright. This is the real
   *     guarantee and it holds on both dialects.
   *  2. This in-process queue, which serialises appends so the read/insert
   *     pair is never interleaved and (1) never has to fire. Since W0-C3,
   *     `DialectConnection.transaction` also serialises unrelated concurrent
   *     transactions on the single shared connection rather than folding them
   *     into one scope, so this queue is now the narrower guarantee — appends
   *     specifically — layered on that broader one, rather than the only thing
   *     standing between two appends.
   *  3. 02 §10.4 item 6 — **the Wave 0 gateway runs as ONE instance.** SQLite
   *     is a single-writer, single-host store; multi-replica is a Postgres-era
   *     property and may not be claimed as a Wave 0 property anywhere. When
   *     Postgres and multiple replicas arrive, (2) stops being sufficient on
   *     its own and the head read must become `SELECT … FOR UPDATE` (or the
   *     transaction serialisable) — (1) is what keeps the failure mode a
   *     refused insert rather than a silent fork in the meantime.
   */
  let queue: Promise<unknown> = Promise.resolve();
  const serialised = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  async function satellitesFor(callIds: readonly string[]): Promise<{
    roles: Map<string, string[]>;
    keys: Map<string, AuditResultKey[]>;
    creds: Map<string, AuditCredentialRef[]>;
  }> {
    const roles = new Map<string, string[]>();
    const keys = new Map<string, AuditResultKey[]>();
    const creds = new Map<string, AuditCredentialRef[]>();
    if (callIds.length === 0) {
      return { roles, keys, creds };
    }
    const ids = sql.join(
      callIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const push = <V>(map: Map<string, V[]>, callId: string, value: V): void => {
      const existing = map.get(callId);
      if (existing === undefined) {
        map.set(callId, [value]);
      } else {
        existing.push(value);
      }
    };

    for (const row of await connection.all<CallRow>(
      sql`select ${sql.identifier('call_id')}, ${sql.identifier('role_id')} from ${CALL_ROLE} where ${sql.identifier('call_id')} in (${ids}) order by ${sql.identifier('id')}`,
    )) {
      push(roles, required(row, 'call_id'), required(row, 'role_id'));
    }
    for (const row of await connection.all<CallRow>(
      sql`select ${sql.identifier('call_id')}, ${sql.identifier('key_name')}, ${sql.identifier('key_value')} from ${RESULT_KEY} where ${sql.identifier('call_id')} in (${ids}) order by ${sql.identifier('id')}`,
    )) {
      push(keys, required(row, 'call_id'), {
        keyName: required(row, 'key_name'),
        keyValue: required(row, 'key_value'),
      });
    }
    for (const row of await connection.all<CallRow>(
      sql`select ${sql.identifier('call_id')}, ${sql.identifier('secret_ref')}, ${sql.identifier('version')} from ${CREDENTIAL_REF} where ${sql.identifier('call_id')} in (${ids}) order by ${sql.identifier('id')}`,
    )) {
      push(creds, required(row, 'call_id'), {
        secretRef: required(row, 'secret_ref'),
        version: text(row['version']),
      });
    }
    return { roles, keys, creds };
  }

  async function hydrate(rows: readonly CallRow[]): Promise<AuditCallRecord[]> {
    const ids = rows.map((row) => required(row, 'id'));
    const { roles, keys, creds } = await satellitesFor(ids);
    return rows.map((row) => {
      const id = required(row, 'id');
      return toRecord(row, roles.get(id) ?? [], keys.get(id) ?? [], creds.get(id) ?? []);
    });
  }

  /** Rows joined through a satellite, newest first, in one indexed hop. */
  async function callsWhereExists(where: SQL): Promise<AuditCallRecord[]> {
    const rows = await connection.all<CallRow>(
      sql`${selectCall} where ${where} order by ${sql.identifier('id')} desc`,
    );
    return hydrate(rows);
  }

  /**
   * W0-F5 — "which call reversed this one", in one indexed hop on
   * `audit_call_reverses_call_id_idx`.
   *
   * Ordered by id (UUIDv7, so creation order) and capped at one: a second row
   * claiming to reverse the same call would mean a write was reversed twice,
   * which the idempotency record and the reversing tool's own preconditions
   * both refuse upstream. If one ever appears, the FIRST is the reversal and the
   * later row is the anomaly `forge audit verify` and the reviewer should see —
   * so this returns the first rather than silently picking the newest.
   */
  async function reversedBy(callId: string): Promise<string | null> {
    const rows = await connection.all<CallRow>(
      sql`select ${sql.identifier('id')} from ${CALL} where ${sql.identifier('reverses_call_id')} = ${callId} order by ${sql.identifier('id')} asc limit 1`,
    );
    const row = rows[0];
    return row === undefined ? null : required(row, 'id');
  }

  async function headRow(deploymentId: string): Promise<CallRow | undefined> {
    // UUIDv7 ids are time-ordered, so the greatest id in a deployment IS the
    // chain head — no ORDER BY ts, which two rows could tie on.
    const rows = await connection.all<CallRow>(
      sql`${selectCall} where ${sql.identifier('deployment_id')} = ${deploymentId} order by ${sql.identifier('id')} desc limit 1`,
    );
    return rows[0];
  }

  return {
    append(input: AppendAuditCallInput): Promise<AuditCallRecord> {
      return serialised(() =>
        connection.transaction(async () => {
          const head = await headRow(input.deploymentId);
          const prevHash = head === undefined ? AUDIT_CHAIN_GENESIS : required(head, 'row_hash');

          const id = uuidv7();
          const row = buildRow(input, id, prevHash);
          // `row_hash` is excluded from the canonical form by construction
          // (AUDIT_HASHED_COLUMNS), so the placeholder above never reaches it.
          row['row_hash'] = auditRowHash(row);

          const values = sql.join(
            CALL_COLUMNS.map((name) => sql`${bindable(row[name] ?? null)}`),
            sql`, `,
          );
          await connection.run(sql`insert into ${CALL} (${CALL_COLUMN_LIST}) values (${values})`);

          // The satellites go in **the same transaction** as the row — 02
          // §10.4 item 2 is explicit about that, and a satellite written
          // outside it could survive a rolled-back call.
          const roles = input.callerRoles ?? [];
          for (const roleId of roles) {
            await connection.run(
              sql`insert into ${CALL_ROLE} (${sql.identifier('id')}, ${sql.identifier('call_id')}, ${sql.identifier('role_id')}) values (${uuidv7()}, ${id}, ${roleId})`,
            );
          }
          const resultKeys = input.resultKeys ?? [];
          for (const key of resultKeys) {
            await connection.run(
              sql`insert into ${RESULT_KEY} (${sql.identifier('id')}, ${sql.identifier('call_id')}, ${sql.identifier('key_name')}, ${sql.identifier('key_value')}) values (${uuidv7()}, ${id}, ${key.keyName}, ${key.keyValue})`,
            );
          }
          const credentialRefs = input.credentialRefs ?? [];
          for (const ref of credentialRefs) {
            await connection.run(
              sql`insert into ${CREDENTIAL_REF} (${sql.identifier('id')}, ${sql.identifier('call_id')}, ${sql.identifier('secret_ref')}, ${sql.identifier('version')}) values (${uuidv7()}, ${id}, ${ref.secretRef}, ${ref.version})`,
            );
          }

          // The usage rollup — W0-N7, 02 §11.6. INSIDE this same transaction,
          // after the row and its satellites, so a rollback of any of the
          // above (or of this) takes the whole call with it. `options.usage`
          // is undefined for every caller that has not wired it in yet (the
          // composition root, and every test that does not exercise usage),
          // in which case this is a no-op — never a fallback write path.
          if (options.usage !== undefined) {
            await options.usage.recordCall({
              consumerId: input.consumerId,
              callerSubject: input.callerSubject,
              toolId: input.toolId,
              bindingType: input.bindingType ?? null,
              isWrite: input.isWrite,
              phase: input.phase,
              outcome: input.outcome,
              errorCode: input.errorCode ?? null,
              bytesOut: input.bytesOut ?? null,
              latencyMsTotal: input.latencyMsTotal ?? null,
              identityMatch: input.identityMatch ?? null,
              ts: row['ts'] as string,
            });
          }

          // The consumption edge — W0-N10, 02 §4.6/§11.3. Same transaction,
          // same rule as the usage rollup above. READ THE ARGUMENT SOURCES:
          // every one is `row[...]`, the row that was just hashed and
          // inserted, never `input`. `consumer_id` is `audit_call`'s own
          // authenticated consuming agent — 02 §11.3, "authenticated rather
          // than self-declared" — and there is no argument here, optional or
          // otherwise, that could carry a name the caller chose for itself.
          if (options.consumption !== undefined) {
            await options.consumption.recordEdge({
              deploymentId: row['deployment_id'] as string,
              consumerId: row['consumer_id'] as string,
              toolId: row['tool_id'] as string,
              bindingType: (row['binding_type'] as string | null) ?? null,
              isWrite: Boolean(row['is_write']),
              callId: id,
              ts: row['ts'] as string,
            });
          }

          return toRecord(row as CallRow, roles, resultKeys, credentialRefs);
        }),
      );
    },

    async get(id: string): Promise<AuditCallRecord | undefined> {
      const rows = await connection.all<CallRow>(
        sql`${selectCall} where ${sql.identifier('id')} = ${id}`,
      );
      const row = rows[0];
      if (row === undefined) {
        return undefined;
      }
      const { roles, keys, creds } = await satellitesFor([id]);
      // The one read path that resolves the backward link, because it is the
      // one that answers "show me this call" — 03 §7.5 renders the reversal
      // from exactly here.
      return toRecord(
        row,
        roles.get(id) ?? [],
        keys.get(id) ?? [],
        creds.get(id) ?? [],
        await reversedBy(id),
      );
    },

    async reversalLinks(callId: string) {
      const rows = await connection.all<CallRow>(
        sql`select ${sql.identifier('id')}, ${sql.identifier('reverses_call_id')} from ${CALL} where ${sql.identifier('id')} = ${callId}`,
      );
      const row = rows[0];
      if (row === undefined) {
        return undefined;
      }
      return {
        callId,
        reversesCallId: text(row['reverses_call_id']),
        reversedByCallId: await reversedBy(callId),
      };
    },

    async chainHead(deploymentId: string): Promise<AuditCallRecord | undefined> {
      const row = await headRow(deploymentId);
      if (row === undefined) {
        return undefined;
      }
      const hydrated = await hydrate([row]);
      return hydrated[0];
    },

    async listChain(deploymentId: string, limit?: number): Promise<AuditCallRecord[]> {
      const capped = limit === undefined ? undefined : Math.max(0, Math.trunc(limit));
      const bounded = capped === undefined ? sql`` : sql` limit ${capped}`;
      const rows = await connection.all<CallRow>(
        sql`${selectCall} where ${sql.identifier('deployment_id')} = ${deploymentId} order by ${sql.identifier('id')} asc${bounded}`,
      );
      return hydrate(rows);
    },

    // One hop: the `(key_value, key_name)` index answers the EXISTS directly.
    listByResultKey(keyName: string, keyValue: string): Promise<AuditCallRecord[]> {
      return callsWhereExists(
        sql`exists (select 1 from ${RESULT_KEY} where ${RESULT_KEY}.${sql.identifier('call_id')} = ${CALL}.${sql.identifier('id')} and ${sql.identifier('key_value')} = ${keyValue} and ${sql.identifier('key_name')} = ${keyName})`,
      );
    },

    // One hop on `(secret_ref, version)`. Omitting the version matches every
    // version of the reference — the blast-radius question `forge secrets
    // revoke` asks before it kill-switches the dependents.
    listByCredentialRef(secretRef: string, version?: string): Promise<AuditCallRecord[]> {
      const versionClause =
        version === undefined ? sql`` : sql` and ${sql.identifier('version')} = ${version}`;
      return callsWhereExists(
        sql`exists (select 1 from ${CREDENTIAL_REF} where ${CREDENTIAL_REF}.${sql.identifier('call_id')} = ${CALL}.${sql.identifier('id')} and ${sql.identifier('secret_ref')} = ${secretRef}${versionClause})`,
      );
    },

    listByRole(roleId: string): Promise<AuditCallRecord[]> {
      return callsWhereExists(
        sql`exists (select 1 from ${CALL_ROLE} where ${CALL_ROLE}.${sql.identifier('call_id')} = ${CALL}.${sql.identifier('id')} and ${sql.identifier('role_id')} = ${roleId})`,
      );
    },

    // W0-C4. Delegated to `./verify.ts` rather than written here: the walk
    // recomputes over RAW stored columns, which `toRecord` above has already
    // parsed and renamed, and hashing a re-serialisation of a parsed row would
    // be the second canonical form `./hash.ts` forbids.
    listDeployments: () => listAuditDeployments(connection),
    verifyChain: (deploymentId: string) => verifyAuditChain(connection, deploymentId),
  };
}
