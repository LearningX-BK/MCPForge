// MCPForge — THE single schema definition. 02 §10.2: "the SQLite and
// PostgreSQL dialects generated from **one schema definition**". Writing the
// DDL twice is the drift 02 §1.2 rejected for the manifest type model, and the
// argument is the same argument — so the tables are described once, here, as
// dialect-neutral data, and `./sqlite.ts` and `./pg.ts` are mechanical
// projections of this file. Neither of them declares a column of its own.
//
// Scope note (W0-C1, extended by W0-C2 and W0-C3): `store_heartbeat` is the
// foundation. W0-C2 adds `audit_call` and the three satellites 02 §10.4 items 2
// and 3 require. W0-C3 adds the write path's runtime state — `idempotency_record`
// (02 §3.1.2), `confirm_nonce` (02 §3.1.1) and `approval_request` (02 §3.1.1's
// `awaiting_human_approval` queue). W0-D2 adds `local_user` and
// `local_user_group` — the Wave 0 `LocalUserStore` (02 §4.4). The remaining
// satellites 02 §4.6 names — `audit_probe`,
// `audit_approval`, `audit_listing` and `consumption_edge` — belong to the
// probe, approval-gate and consumer tasks and are deliberately absent here.
//
// 02 §10.3: definitions live in git, events live in the runtime store. Nothing
// definitional — no manifest, role, package, overlay, eval or approval — may
// ever gain a table in this file. That property is what `W0-C6` tests by
// deleting `.mcpforge/` and expecting a working system.

/**
 * The dialect-neutral column kinds. Deliberately small: every kind must have an
 * unambiguous, value-identical projection into both dialects, so that a row
 * written on SQLite and a row written on Postgres deserialise to the same
 * TypeScript value without a per-dialect mapper.
 *
 * `timestamp` is an ISO-8601 UTC string in both dialects rather than a native
 * date type. That is a deliberate parity choice: SQLite has no date type at
 * all, so a native Postgres `timestamptz` would have to be mapped back to
 * SQLite's text or integer anyway, and the mapping is where dialect drift
 * hides. Ordering is preserved because ISO-8601 UTC sorts lexicographically.
 *
 * `json` is a text column holding a JSON document. 02 §10.4 item 5 fixes the
 * rule that governs it: SQLite's JSON1 `json_extract` covers every read path
 * 02 §4.6 designs, and **any future query that would need a `jsonb`
 * containment or path operator adds a normalised side table instead** — which
 * keeps the two dialects at parity by construction rather than by luck.
 */
export type ColumnKind = 'text' | 'integer' | 'boolean' | 'timestamp' | 'json';

/**
 * A foreign key onto another table in this same definition. Both projections
 * render it, and `dialect.ts` turns on `PRAGMA foreign_keys = ON` so SQLite
 * does not silently ignore the clause — without that the two dialects would
 * disagree about referential integrity the moment the audit satellites arrive.
 */
export interface ReferenceSpec {
  /** The physical name of the referenced table. */
  readonly table: string;
  /** The referenced column on that table. */
  readonly column: string;
}

export interface ColumnSpec {
  readonly kind: ColumnKind;
  readonly notNull?: boolean;
  readonly primaryKey?: boolean;
  readonly unique?: boolean;
  readonly references?: ReferenceSpec;
}

export interface IndexSpec {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique?: boolean;
}

export interface TableSpec {
  /** The physical table name, snake_case, identical in both dialects. */
  readonly name: string;
  readonly columns: Readonly<Record<string, ColumnSpec>>;
  readonly indexes?: readonly IndexSpec[];
}

/**
 * `store_heartbeat` — the one table W0-C1 owns.
 *
 * It is an operational event, not business data: one row per gateway instance
 * start-up and liveness ping, recording which dialect that instance is talking
 * to. It exists so the repository interface is concrete and contract-testable
 * against both dialects from day one, and it is genuinely useful — it is the
 * cheapest proof that the store is reachable and writable, and it is the
 * record that shows the Wave 0 gateway ran as **one instance** (02 §10.4
 * item 6; multi-replica is a Postgres-era property and is not claimed here).
 *
 * Ids are UUIDv7, generated in the application (02 §10.4 item 4) — never a
 * database function on either engine.
 */
export const STORE_HEARTBEAT: TableSpec = {
  name: 'store_heartbeat',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    instance_id: { kind: 'text', notNull: true },
    store_kind: { kind: 'text', notNull: true },
    observed_at: { kind: 'timestamp', notNull: true },
    note: { kind: 'text' },
  },
  indexes: [{ name: 'store_heartbeat_observed_at_idx', columns: ['observed_at'] }],
};

/**
 * `audit_call` — the append-only audit trail. W0-C2. Shape is 02 §4.6's column
 * list, EXTENDED by 02 §11.3 (Phase 5): the `who` block carries
 * `consumer_id`, `consumer_record_sha`, `consumer_auth_method`,
 * `consumer_session_id` and `human_in_the_loop`. Those five land here, now,
 * **before the first audit row exists** — a hard sequencing requirement, not
 * advice, because `row_hash` covers row content and a schema change mid-chain
 * is a discontinuity in the only integrity mechanism SQLite has.
 *
 * **Immutability, stated honestly (02 §10.4 item 1): on SQLite this makes
 * tampering detectable, not preventable.** Postgres revokes `UPDATE`/`DELETE`
 * from the application role; SQLite has no users, no roles and no `GRANT`, so
 * there is nothing to revoke. What Wave 0 has instead is three layers — the
 * `BEFORE UPDATE` / `BEFORE DELETE` triggers in `../audit/immutability.ts`,
 * the `prev_hash`/`row_hash` chain below, and OS file permissions on
 * `.mcpforge/runtime.db`. Anyone holding the file can open a `sqlite3` shell,
 * drop the triggers and rewrite a row; the chain will then fail
 * `forge audit verify`, which is the point — but the write is not prevented.
 * It becomes preventable again the moment the store is Postgres.
 *
 * Types elided in 02 §4.6 are resolved here to the dialect-neutral kinds
 * above. `caller_roles`, `args_redacted` and `result_keys` are `json` (02
 * §10.4 item 3 and item 5); the two whose membership is actually queried —
 * roles and result keys — are *additionally* normalised into side tables, so
 * neither dialect ever needs an array type or a `jsonb` operator.
 */
export const AUDIT_CALL: TableSpec = {
  name: 'audit_call',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    ts: { kind: 'timestamp', notNull: true },
    correlation_id: { kind: 'text' },
    session_id: { kind: 'text' },
    parent_call_id: { kind: 'text' },

    // -- who
    // `Principal.subject` is the only identity value written to audit
    // (CLAUDE.md §3). There is no anonymous call and no service-account
    // fallback (non-negotiable 1), so this is NOT NULL by design: a row that
    // could not name its human would be the fallback path made real.
    caller_subject: { kind: 'text', notNull: true },
    caller_display: { kind: 'text' },
    caller_idp: { kind: 'text' },
    caller_amr: { kind: 'text' },
    caller_roles: { kind: 'json' },
    on_behalf_of: { kind: 'text' },

    // -- who, Phase 5 (02 §11.3). Every call needs BOTH a registered consumer
    // and a resolved human identity (non-negotiable 6), so `consumer_id` is
    // NOT NULL for the same reason `caller_subject` is.
    // `consumer_record_sha` pins WHICH VERSION of the consumer's
    // authorizations was in force for that call.
    consumer_id: { kind: 'text', notNull: true },
    consumer_record_sha: { kind: 'text' },
    consumer_auth_method: { kind: 'text' },
    consumer_session_id: { kind: 'text' },
    human_in_the_loop: { kind: 'boolean', notNull: true },

    // -- what
    tool_id: { kind: 'text', notNull: true },
    tool_version: { kind: 'text' },
    manifest_sha: { kind: 'text' },
    server_id: { kind: 'text' },
    package_id: { kind: 'text' },
    binding_type: { kind: 'text' },
    archetype: { kind: 'text' },
    verb: { kind: 'text' },
    entity: { kind: 'text' },
    sensitivity_class: { kind: 'text' },
    is_write: { kind: 'boolean', notNull: true },

    // -- where (target_object is binding.ref)
    target_system: { kind: 'text' },
    target_env: { kind: 'text' },
    target_object: { kind: 'text' },
    // The hash chain is per-deployment (02 §4.6), so this column is what
    // partitions it and it may never be null.
    deployment_id: { kind: 'text', notNull: true },
    gateway_version: { kind: 'text' },
    bundle_version: { kind: 'text' },

    // -- phase: plan | execute | reject | reverse
    phase: { kind: 'text', notNull: true },
    confirm_token_hash: { kind: 'text' },
    plan_hash: { kind: 'text' },
    args_hash: { kind: 'text' },
    idempotency_key: { kind: 'text' },
    replayed: { kind: 'boolean' },

    // -- inputs and outputs
    // Redaction is per-field, driven by sensitivity_class plus per-input
    // `redact: true`; a redacted value is replaced by sha256(value)[:12]
    // rather than removed, so equality can still be reasoned about without
    // exposing the value (02 §4.6). No secret value ever lands here
    // (non-negotiable 8) — a credential appears only as a `secretRef://` in
    // the `audit_credential_ref` satellite.
    args_redacted: { kind: 'json' },
    // THE reversal handle: business keys created or changed. Also normalised
    // into `audit_result_key` (02 §10.4 item 2).
    result_keys: { kind: 'json' },
    row_count: { kind: 'integer' },
    bytes_out: { kind: 'integer' },

    // -- outcome: ok | business_error | policy_denied | binding_error | timeout
    outcome: { kind: 'text', notNull: true },
    error_code: { kind: 'text' },
    // The exact text returned to the agent, verbatim.
    error_message_agent: { kind: 'text' },
    // Which policy rule refused, when outcome = policy_denied.
    denied_by_rule: { kind: 'text' },

    // -- identity honesty
    identity_carrying: { kind: 'boolean' },
    target_identity_observed: { kind: 'text' },
    identity_match: { kind: 'boolean' },
    // 'client_identifier' | 'wrapper_schema' | 'none'
    compensating_control: { kind: 'text' },

    // -- reversal (02 §3.1.4 — "the registry is live, not documentation")
    reversal_class: { kind: 'text' },
    // W0-F5. The tool id that reverses THIS call, resolved from the manifest's
    // `writeSafety.reversal` at execute time and frozen here. It is stored
    // rather than re-derived because a manifest can change after the fact:
    // `forge audit reverse` must construct the call the tool declared WHEN THE
    // WRITE HAPPENED, not the one it declares today. Null for a read, for an
    // `irreversible` write, and for a `transactional`/`native-reverse` class
    // that names no separate tool.
    reversal_tool_id: { kind: 'text' },
    reverses_call_id: { kind: 'text' },
    // 02 §4.6 declares this column and 03 §7.5 requires the backward link, but
    // `audit_call` is APPEND-ONLY (./audit/immutability.ts) — there is no
    // legitimate UPDATE of an audit row anywhere in the product, so the
    // original call's row can never be rewritten once its reversal exists.
    // The backward link is therefore RESOLVED, not written: the repository's
    // `reversalLinks`/`get` read it off `reverses_call_id` through the index
    // below. The column stays because a future non-append-only projection (a
    // read model, the portal's Activity cache) is where it would be materialised.
    reversed_by_call_id: { kind: 'text' },

    // -- performance
    latency_ms_total: { kind: 'integer' },
    latency_ms_gateway: { kind: 'integer' },
    latency_ms_target: { kind: 'integer' },

    // -- integrity
    prev_hash: { kind: 'text', notNull: true },
    row_hash: { kind: 'text', notNull: true },
  },
  indexes: [
    // 02 §4.6 query 1 — "everything this person did in this system this week".
    {
      name: 'audit_call_subject_target_ts_idx',
      columns: ['caller_subject', 'target_system', 'ts'],
    },
    // 02 §4.6 query 3 — the abandoned-intent view: phase='plan' with no
    // matching execute on the same plan_hash.
    { name: 'audit_call_plan_hash_phase_idx', columns: ['plan_hash', 'phase'] },
    // The chain walk `forge audit verify` (W0-C4) performs, per deployment.
    // UUIDv7 ids sort by creation time, so this is the chain order.
    { name: 'audit_call_deployment_id_idx', columns: ['deployment_id', 'id'] },
    // 02 §11.3 — consumer_id is the authenticated "consuming agent" that
    // finally feeds consumption_edge.
    { name: 'audit_call_consumer_ts_idx', columns: ['consumer_id', 'ts'] },
    { name: 'audit_call_idempotency_key_idx', columns: ['idempotency_key'] },
    // W0-F5 — the backward link, resolved rather than stored (see
    // `reversed_by_call_id` above). "Which call reversed this one" must be one
    // indexed hop, because 03 §7.5 renders it on every completed write.
    { name: 'audit_call_reverses_call_id_idx', columns: ['reverses_call_id'] },
    // The one part of chain integrity the database itself CAN enforce on
    // SQLite: two rows in one deployment may not claim the same predecessor,
    // so a silent fork is prevented rather than merely detected. It does not
    // rescue the honest statement above — an attacker with the file can drop
    // this index too — but it does make an in-process race impossible.
    { name: 'audit_call_chain_link_uq', columns: ['deployment_id', 'prev_hash'], unique: true },
    { name: 'audit_call_row_hash_uq', columns: ['row_hash'], unique: true },
  ],
};

/**
 * `audit_result_key` — 02 §10.4 item 2. SQLite has neither `jsonb` nor GIN, so
 * `result_keys` is *additionally* normalised here, written **in the same
 * transaction** as its `audit_call` row, with a composite index on
 * `(key_value, key_name)`. That answers §4.6 query 2 — "who created document
 * 12345" — in one indexed hop on both engines. 02 §10.4 item 2 is explicit
 * that this is kept after the Postgres migration rather than reverted to GIN,
 * because it makes the business-key search a plain indexed lookup on both.
 */
export const AUDIT_RESULT_KEY: TableSpec = {
  name: 'audit_result_key',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    call_id: {
      kind: 'text',
      notNull: true,
      references: { table: 'audit_call', column: 'id' },
    },
    key_name: { kind: 'text', notNull: true },
    key_value: { kind: 'text', notNull: true },
  },
  indexes: [
    { name: 'audit_result_key_value_name_idx', columns: ['key_value', 'key_name'] },
    { name: 'audit_result_key_call_id_idx', columns: ['call_id'] },
  ],
};

/**
 * `audit_call_role` — 02 §10.4 item 3. SQLite has no array type, so §4.6's
 * `caller_roles[]` becomes a JSON text column on `audit_call` **for display
 * and round-trip** plus this side table **where membership queries are
 * actually needed**. Both exist; neither replaces the other.
 */
export const AUDIT_CALL_ROLE: TableSpec = {
  name: 'audit_call_role',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    call_id: {
      kind: 'text',
      notNull: true,
      references: { table: 'audit_call', column: 'id' },
    },
    role_id: { kind: 'text', notNull: true },
  },
  indexes: [
    { name: 'audit_call_role_role_id_idx', columns: ['role_id', 'call_id'] },
    { name: 'audit_call_role_call_id_idx', columns: ['call_id'] },
  ],
};

/**
 * `audit_credential_ref` — 02 §11.3, Phase 5. Which stored credential, at
 * which version, was used for a call. Indexed on `secret_ref` so "which calls
 * used this credential version" answers in one hop — the query that runs the
 * moment `forge secrets revoke` is considered, and the query a rotation's
 * blast-radius review depends on.
 *
 * `secret_ref` is a `secretRef://<scope>/<subject>/<purpose>` string and
 * nothing else. A secret VALUE never appears in an audit row (non-negotiable
 * 8) — only the reference.
 */
export const AUDIT_CREDENTIAL_REF: TableSpec = {
  name: 'audit_credential_ref',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    call_id: {
      kind: 'text',
      notNull: true,
      references: { table: 'audit_call', column: 'id' },
    },
    secret_ref: { kind: 'text', notNull: true },
    version: { kind: 'text' },
  },
  indexes: [
    { name: 'audit_credential_ref_secret_ref_idx', columns: ['secret_ref', 'version'] },
    { name: 'audit_credential_ref_call_id_idx', columns: ['call_id'] },
  ],
};

/**
 * `audit_retention_gate` — the single, separately-audited exception path that
 * 02 §10.4 item 1 requires alongside the append-only triggers.
 *
 * Retention (02 §4.6: 7 years for `financial`, 2 years otherwise, configured
 * per deployment in the overlay) is "the one exception to append-only". With
 * an unconditional `BEFORE DELETE` trigger it would be impossible, so the
 * delete trigger consults this table: a delete is permitted only while an
 * **open** gate row exists (`closed_at IS NULL`). The gate is opened, used and
 * closed by the retention job (W0-C4), which logs its own deletion.
 * **`BEFORE UPDATE` has no gate at all** — retention deletes, it never
 * rewrites, so nothing in the product may ever update an audit row.
 *
 * W0-C4 extends the three columns W0-C2 reserved, because three could not
 * carry what the job has to record. `closed_at` is load-bearing rather than
 * cosmetic: without it a finished sweep's row would sit in this table forever
 * and the delete trigger — which counts rows — would be permanently open,
 * i.e. the gate would disable the very control it exists to punctuate. The
 * remainder (`deployment_id`, `cutoff_ts`, `deleted_count`,
 * `boundary_row_hash`, `attestation_call_id`, `actor_subject`, `consumer_id`)
 * is this table's other half of its stated purpose — it *logs its own
 * deletion*, and a log that cannot say what was removed, from where, by whom,
 * or which chain position the removal stops at is not a log.
 *
 * This table is the operational record. It is **not** the security artefact:
 * it is an ordinary mutable table, so anyone who can rewrite the audit file
 * can rewrite this too. The tamper-evident half is `attestation_call_id` — an
 * ordinary, hash-chained `audit_call` row appended by the job itself, whose
 * content `forge audit verify` checks (see `../audit/retention.ts`).
 */
export const AUDIT_RETENTION_GATE: TableSpec = {
  name: 'audit_retention_gate',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    opened_at: { kind: 'timestamp', notNull: true },
    reason: { kind: 'text', notNull: true },
    /** Which deployment's chain this sweep touched. */
    deployment_id: { kind: 'text', notNull: true },
    /** Rows strictly older than this ISO-8601 instant were in scope. */
    cutoff_ts: { kind: 'timestamp', notNull: true },
    /** Null while the gate is OPEN — the delete trigger's whole condition. */
    closed_at: { kind: 'timestamp' },
    deleted_count: { kind: 'integer' },
    /** `row_hash` of the newest deleted row = `prev_hash` of the survivor. */
    boundary_row_hash: { kind: 'text' },
    /** The hash-chained `audit_call` row this job appended about itself. */
    attestation_call_id: { kind: 'text' },
    /** The privileged operator the job ran as. 02 §4.6: separately audited. */
    actor_subject: { kind: 'text', notNull: true },
    consumer_id: { kind: 'text', notNull: true },
  },
  indexes: [
    { name: 'audit_retention_gate_open_idx', columns: ['closed_at'] },
    { name: 'audit_retention_gate_deployment_idx', columns: ['deployment_id', 'opened_at'] },
  ],
};

/**
 * `idempotency_record` — 02 §3.1.2. W0-C3.
 *
 * `idempotencyKey = sha256(callerSubject | toolId | toolVersion |
 * argsCanonicalHash | confirmToken)`, **written before the binding is invoked**
 * with the outcome written back after. A repeat within
 * `writeSafety.idempotency.scopeHours` (default 24) returns the *original*
 * result with `"replayed": true` instead of executing again.
 *
 * Why the before/after split is the whole design: an agent that times out
 * cannot tell a failure from a success, and the honest agent behaviour — retry
 * — produces a duplicate payable. The row must therefore exist *before* the
 * side effect can happen, so that the retry of an ambiguous call finds it. A
 * record written only on success would leave exactly the window that matters
 * uncovered. This is Wave 0 exit criterion 7(d).
 *
 * The key is `UNIQUE`, which is what makes "did this already run" a question
 * the database answers rather than a race the application loses: the second
 * caller's `INSERT` is refused, and refusal is the replay signal. **That holds
 * on one node.** SQLite is a single-writer, single-host store and the Wave 0
 * gateway runs as one instance (02 §10.4 item 6); multi-replica is a
 * Postgres-era property and is not claimed here.
 *
 * The confirm token is stored **hashed, never raw** — `audit_call` already sets
 * that precedent with `confirm_token_hash`, and a token is a bearer value: a
 * row that carried it verbatim would let anyone with read access to the runtime
 * file execute a plan a human approved.
 */
export const IDEMPOTENCY_RECORD: TableSpec = {
  name: 'idempotency_record',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    // The sha256 of 02 §3.1.2's five-part composition, lower-case hex.
    idempotency_key: { kind: 'text', notNull: true },

    // The five parts, stored alongside the key they compose. Not redundancy:
    // without them a replay could be observed but never explained, and the
    // portal's "this call was replayed, here is the original" view would have
    // nothing to render.
    caller_subject: { kind: 'text', notNull: true },
    tool_id: { kind: 'text', notNull: true },
    tool_version: { kind: 'text', notNull: true },
    args_canonical_hash: { kind: 'text', notNull: true },
    confirm_token_hash: { kind: 'text', notNull: true },

    // 'pending' before the binding is invoked; 'completed' or 'failed' after.
    status: { kind: 'text', notNull: true },
    // The original result, replayed verbatim. Null until the outcome is known.
    result: { kind: 'json' },
    // Set when status = 'failed', from the closed error taxonomy (02 §3.1.5).
    error_code: { kind: 'text' },

    // The call that wrote this record, for the audit join. Not a foreign key:
    // the audit row is appended at the END of the write unit and this row at
    // the start, so a FK would impose an ordering the sequence cannot honour.
    call_id: { kind: 'text' },

    created_at: { kind: 'timestamp', notNull: true },
    completed_at: { kind: 'timestamp' },
    // `writeSafety.idempotency.scopeHours` as declared by the tool, recorded so
    // a window is auditable after the fact and a manifest change cannot
    // retroactively lengthen or shorten a window already offered to a caller.
    scope_hours: { kind: 'integer', notNull: true },
    expires_at: { kind: 'timestamp', notNull: true },
  },
  indexes: [
    // THE control. Single-use of the key is enforced by the database, not by a
    // read-then-write in the application.
    { name: 'idempotency_record_key_uq', columns: ['idempotency_key'], unique: true },
    // The retention sweep, and the "is this still in window" scan.
    { name: 'idempotency_record_expires_at_idx', columns: ['expires_at'] },
    { name: 'idempotency_record_subject_tool_idx', columns: ['caller_subject', 'tool_id'] },
  ],
};

/**
 * `confirm_nonce` — 02 §3.1.1's nonce table. W0-C3.
 *
 * A confirm token is single-use, and this table is how. **A row exists if and
 * only if that nonce has been spent**, so consuming a token is an `INSERT`
 * against a `UNIQUE` column: the first attempt inserts, every later attempt is
 * refused by the database. There is deliberately no "issued but unused" row —
 * the token itself is HMAC-signed and TTL-bounded (02 §3.1.1, and the signing
 * is W0-F2's, not this table's), so the only fact the store needs to hold is
 * the fact of spending. Fewer rows, and no state machine that could disagree
 * with the signature.
 *
 * **The atomicity claim, stated exactly and no more strongly (02 §10.4 item
 * 6).** Single-use is enforced by the `UNIQUE` constraint on the nonce column
 * with the consuming `INSERT` **inside the same transaction as the execute** —
 * which is atomic **on one node**. The Wave 0 gateway runs as ONE instance;
 * SQLite is a single-writer, single-host store, so horizontal scale-out with
 * shared nonce state is a **Postgres-era property** and no Wave 0 claim, exit
 * criterion or evidence may be written as if multi-replica works. Note the
 * security property survives even though the scaling property does not: the
 * nonce stays single-use because the constraint is in the database, and it is
 * the *same* constraint that will keep it single-use across replicas once the
 * store is Postgres.
 */
export const CONFIRM_NONCE: TableSpec = {
  name: 'confirm_nonce',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    // The `nonce` field of the confirm-token payload. Unique — see above.
    nonce: { kind: 'text', notNull: true },

    // The binding the token asserted, recorded at consumption so a replay
    // attempt can be explained rather than merely refused. Tokens are never
    // valid across callers or tool versions (02 §3.1.1); that check is the
    // token verifier's (W0-F2), and these columns are the audit of it.
    caller_subject: { kind: 'text', notNull: true },
    tool_id: { kind: 'text', notNull: true },
    tool_version: { kind: 'text' },
    plan_hash: { kind: 'text' },

    consumed_at: { kind: 'timestamp', notNull: true },
    // The token's own `exp`, so spent nonces can be swept once no live token
    // could bear them. Sweeping earlier would make a token reusable.
    expires_at: { kind: 'timestamp', notNull: true },
    // The execute call this nonce paid for. Not a foreign key, for the same
    // ordering reason as `idempotency_record.call_id`.
    call_id: { kind: 'text' },
  },
  indexes: [
    { name: 'confirm_nonce_nonce_uq', columns: ['nonce'], unique: true },
    { name: 'confirm_nonce_expires_at_idx', columns: ['expires_at'] },
    { name: 'confirm_nonce_subject_tool_idx', columns: ['caller_subject', 'tool_id'] },
  ],
};

/**
 * `approval_request` — the runtime state of 02 §3.1.1's `awaiting_human_approval`
 * flow. W0-C3.
 *
 * When a tool declares `humanApprovalRequired: true`, the plan response carries
 * `{ status: "awaiting_human_approval", approvalId: "apr_…", approvalUrl }` and
 * **no `confirmToken` is minted until a human approves in the portal**. 02
 * §3.1.1 divides that cleanly: *"Phase 3 owns that queue's UX; the gateway owns
 * the state machine."* This table is the state machine's persistence and
 * nothing else — no UI, no notification, no policy.
 *
 * 02 §10.3 draws the other line this table sits on: the approval **record** —
 * the governance artefact in `approvals/` — is git, and the approval **queue's
 * runtime state** is the store. This is the second of those. Deleting
 * `.mcpforge/` loses in-flight approvals and loses no governance evidence,
 * which is `W0-C6`'s whole point.
 *
 * The row binds `plan_hash` AND `args_canonical_hash` for the same reason the
 * confirm token binds both (02 §3.1.1): an approval that named only a plan id
 * would let an agent obtain a human's approval for a 100 GBP voucher and mint a
 * token for a 100,000 GBP one. The approver approves *these arguments*.
 */
export const APPROVAL_REQUEST: TableSpec = {
  name: 'approval_request',
  columns: {
    // `apr_` + UUIDv7 — 02 §3.1.1 shows the agent-facing shape as `apr_…`, and
    // the id is agent-facing (it is returned in the plan response and polled
    // with it). UUIDv7 underneath, generated in the application (02 §10.4
    // item 4), so ids stay time-ordered for index locality.
    id: { kind: 'text', primaryKey: true, notNull: true },

    // -- what is being approved
    plan_hash: { kind: 'text', notNull: true },
    args_canonical_hash: { kind: 'text', notNull: true },
    // The exact `plan` string shown to the approver. In a chat client the plan
    // string is the entire UI (CLAUDE.md §5); here it is the entire record of
    // what a human actually agreed to, so it is stored verbatim rather than
    // re-rendered later from a manifest that may since have changed.
    plan_summary: { kind: 'text' },

    // -- who asked
    caller_subject: { kind: 'text', notNull: true },
    consumer_id: { kind: 'text' },
    tool_id: { kind: 'text', notNull: true },
    tool_version: { kind: 'text' },

    // 'pending' | 'approved' | 'rejected' | 'expired'
    status: { kind: 'text', notNull: true },
    // -- who decided. `Principal.subject`, the only identity value written
    // (CLAUDE.md §3). Null while pending, and a decided row always has one:
    // an approval nobody's name is on is not an approval.
    approver_subject: { kind: 'text' },
    decision_reason: { kind: 'text' },
    decided_at: { kind: 'timestamp' },

    created_at: { kind: 'timestamp', notNull: true },
    expires_at: { kind: 'timestamp', notNull: true },
  },
  indexes: [
    // The queue itself: pending, oldest first.
    { name: 'approval_request_status_created_idx', columns: ['status', 'created_at'] },
    { name: 'approval_request_subject_created_idx', columns: ['caller_subject', 'created_at'] },
    { name: 'approval_request_plan_hash_idx', columns: ['plan_hash'] },
  ],
};

/**
 * `local_user` — the Wave 0 `LocalUserStore`'s accounts. W0-D2, 02 §4.4.
 *
 * 02 §4.4 says "Users in Postgres". That is SUPERSEDED by 02 §10's Wave 0
 * datastore correction — SQLite now, Postgres later, from this one definition —
 * and the sentence's actual content survives intact: local accounts are
 * **runtime state, not git**. They are people, not definitions; they are
 * created, disabled and re-grouped by an operator between releases; and a
 * password hash in a reviewed git artefact would be a password hash in every
 * clone of the repository forever. `W0-C6` still holds: deleting `.mcpforge/`
 * loses the local accounts and loses no governance evidence, because the
 * group→role **grant** — the part that carries authority — is the git mapping
 * file (W0-D4), and this table only says who is in a group.
 *
 * **What is stored here, and why it is not a `secretRef://`.** Non-negotiable 8
 * governs credentials MCPForge presents to a *target system*; those are
 * references and only references. `password_hash` and `totp_secret` are
 * first-party authentication material for MCPForge's own front door — the thing
 * a credential is checked *against*, not a credential the gateway ever sends
 * anywhere. A password hash is not the password. The TOTP secret genuinely is a
 * shared secret and is the most sensitive column in the runtime store: it is
 * never returned by any repository read that a caller above
 * `identity/local/**` can reach, never rendered, never logged, and never
 * written to an audit row (`local-user-audit.test.ts` scans for exactly that).
 *
 * **Deactivate, never delete.** There is no hard-delete path for an account.
 * `active = false` retires it — `findBySubject` then returns `undefined` and the
 * provider refuses with `IDENTITY_UNRESOLVED` — while `subject` stays resolvable
 * for the audit rows that reference it. A subject deleted out from under seven
 * years of audit history would leave a trail that cannot name its own actors,
 * and nothing in this system silently vanishes.
 */
export const LOCAL_USER: TableSpec = {
  name: 'local_user',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    /**
     * `Principal.subject` — stable, opaque, immutable, the audit key (02 §4.4).
     * Opaque on purpose: it is NOT the username, so renaming a person does not
     * rewrite their audit history, and `forge identity remap` (W0-D4) has one
     * value to migrate at the AD swap rather than a naming convention.
     */
    subject: { kind: 'text', notNull: true },
    /** The login handle. Mutable, unlike `subject`. Compared case-folded. */
    username: { kind: 'text', notNull: true },
    display_name: { kind: 'text', notNull: true },
    email: { kind: 'text' },
    active: { kind: 'boolean', notNull: true },

    // -- credential material. Never leaves `identity/local/**`.
    /**
     * The PHC-encoded Argon2id digest — `$argon2id$v=19$m=…,t=…,p=…$salt$hash`.
     * The **per-user salt is inside this string**, generated from
     * `crypto.getRandomValues` at every set, which is what makes two people who
     * chose the same password store two unrelated digests.
     */
    password_hash: { kind: 'text', notNull: true },
    /** `argon2id`, recorded so a future KDF change is detectable per row. */
    password_algorithm: { kind: 'text', notNull: true },
    password_updated_at: { kind: 'timestamp', notNull: true },

    /** Base32 TOTP secret, or null. Null means this account is `['pwd']` only. */
    totp_secret: { kind: 'text' },
    /** Null until a code from the secret has actually been verified once. */
    totp_confirmed_at: { kind: 'timestamp' },
    /**
     * The last TOTP counter this account successfully spent. A code is valid
     * for a whole 30-second step and the acceptance window spans three, so
     * without this a code shoulder-surfed or replayed from a proxy log works
     * again for up to 90 seconds. Monotonic: a counter at or below this is
     * refused even though it verifies.
     */
    totp_last_counter: { kind: 'integer' },

    // -- lockout. Throttles online guessing; Argon2id handles the offline case.
    failed_attempts: { kind: 'integer', notNull: true },
    locked_until: { kind: 'timestamp' },
    last_authenticated_at: { kind: 'timestamp' },

    created_at: { kind: 'timestamp', notNull: true },
    updated_at: { kind: 'timestamp', notNull: true },
  },
  indexes: [
    { name: 'local_user_subject_uq', columns: ['subject'], unique: true },
    // Uniqueness is on the case-folded form, which the repository writes into
    // this column; see `../identity/local-user.ts`. A UNIQUE index over an
    // expression would not project identically into both dialects.
    { name: 'local_user_username_uq', columns: ['username'], unique: true },
    { name: 'local_user_active_idx', columns: ['active', 'username'] },
  ],
};

/**
 * `local_user_group` — group membership, one row per (user, group). W0-D2.
 *
 * A side table rather than a JSON column on `local_user` for the reason 02
 * §10.4 item 3 gives about `caller_roles`: membership is *queried* ("who is in
 * ap-clerks", the question a group→role grant review asks), SQLite has no array
 * type, and a JSON containment operator would break dialect parity.
 *
 * **A group is not a grant.** This table records that a person is in a named
 * group; `overlays/<deployment>/mappings/groups-to-roles.yaml` (W0-D4) decides
 * what that group may do, in git, where the widening shows up as a diff. Adding
 * a row here can never widen a grant on its own.
 */
export const LOCAL_USER_GROUP: TableSpec = {
  name: 'local_user_group',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    user_id: {
      kind: 'text',
      notNull: true,
      references: { table: 'local_user', column: 'id' },
    },
    group_name: { kind: 'text', notNull: true },
    granted_at: { kind: 'timestamp', notNull: true },
  },
  indexes: [
    { name: 'local_user_group_uq', columns: ['user_id', 'group_name'], unique: true },
    { name: 'local_user_group_name_idx', columns: ['group_name', 'user_id'] },
  ],
};

/**
 * `runtime_flags` — the kill switch's persistence. W0-E5, 02 §4.7 as extended
 * by 02 §11.2 (Phase 5's fifth granularity). `core/gateway/scope/sources.ts`
 * (W0-E2) already defines `RuntimeFlagSource` and its `RuntimeFlag` shape as
 * the READ contract the `¬KillSwitched` predicate depends on; this table is
 * the durable form of exactly that shape, so `core/gateway/flags/**` can
 * project a row straight onto a `RuntimeFlag` with no translation layer.
 *
 * One row per `forge kill` invocation. There is no update: `forge kill`
 * always appends, and clearing a switch is a separate row-level `active`
 * flip (`false`) recorded by whoever ran `forge kill --clear`-equivalent
 * tooling. Nothing here overwrites an existing row's `reason` or `until` —
 * the audit value of "who kill-switched this and why, and when it was
 * lifted" would be destroyed by an in-place update.
 */
export const RUNTIME_FLAG: TableSpec = {
  name: 'runtime_flags',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    // 'tool' | 'moduleServer' | 'bindingType' | 'consumer' | 'deployment'
    // (KILL_SCOPES, core/gateway/scope/types.ts). Kept as free text here,
    // not an enum column — SQLite has none, and the closed set is enforced
    // in TypeScript at the one place a flag is constructed (W0-E5's
    // `core/gateway/flags/kill.ts`).
    scope: { kind: 'text', notNull: true },
    // The tool id, server id, binding type, consumer id or deployment id
    // this flag targets.
    target: { kind: 'text', notNull: true },
    // The flag's own reason text, surfaced verbatim in TOOL_DISABLED /
    // CONSUMER_SUSPENDED (02 §4.7) — never paraphrased between here and the
    // caller-visible error.
    reason: { kind: 'text', notNull: true },
    // Null = indefinite. Past `until` is spent (`isFlagActive`, sources.ts).
    until: { kind: 'timestamp' },
    // Who ran `forge kill`. `Principal.subject` is the only identity value
    // written to audit and to this table (CLAUDE.md §3) — there is no
    // anonymous kill switch.
    created_by: { kind: 'text', notNull: true },
    created_at: { kind: 'timestamp', notNull: true },
    // The audit_call row this kill was also recorded as (non-negotiable —
    // consumer-scope kills MUST write an audit record naming author and
    // reason; every scope gets one for the same reason a write tool does).
    audit_call_id: { kind: 'text' },
    // Soft-clear: a row is only ever appended, never deleted, so the history
    // of who kill-switched what is never lost. `active = false` is how a
    // flag is lifted before its `until`.
    active: { kind: 'boolean', notNull: true },
  },
  indexes: [
    // The poll's own read: every currently-active row, cheaply.
    { name: 'runtime_flags_active_idx', columns: ['active', 'scope', 'target'] },
    { name: 'runtime_flags_scope_target_idx', columns: ['scope', 'target'] },
  ],
};

/**
 * `consumer_usage_bucket` — W0-N7, 02 §11.6. One row per (consumer, granularity,
 * bucket start), hourly and daily. Written from the SAME outbox transaction as
 * the `audit_call` row that fed it (`../audit/repository.ts`'s `append`,
 * extended to call `../usage/repository.ts` before the transaction commits) —
 * never a second, independently-committed write path, because a rollup that
 * could commit while its audit row rolled back (or vice versa) would let the
 * quota enforcement 02 §11.6 exists for disagree with the record it is
 * supposedly summarising.
 *
 * **Why an upsert-by-bucket table rather than one row per call.** The bucket
 * is the unit both a `RATE_LIMITED` check and the anomaly substrate (W0-N8)
 * actually read ("calls this hour", "writes today"), so aggregating at write
 * time is what 02 §11.6 means by "cheap, because it rolls up data already
 * being written" — the alternative, summing `audit_call` on every check, is
 * the query the rollup exists to avoid.
 *
 * `plans_never_confirmed` is deliberately NOT a stored column: it is derived
 * as `plans_minted - plans_confirmed` by the repository's read side. A plan
 * minted in one bucket can be confirmed in the next (an hour bucket that
 * closes mid-approval), so treating the difference as authoritative only at
 * read time — rather than trying to decrement a "still open" counter
 * mid-flight — keeps every column in this table a simple monotonic increment,
 * which is what makes the same-transaction increment safe to reason about.
 *
 * The three *distinct* counts (`distinct_tools`, `distinct_binding_types`,
 * `distinct_subjects` below) are maintained by first-write-wins side tables
 * (`consumer_usage_tool`, `consumer_usage_binding_type`,
 * `consumer_usage_subject`) rather than recomputed with `COUNT(DISTINCT …)`
 * over `audit_call` — the same reasoning 02 §10.4 item 3 gives for
 * `audit_call_role`: SQLite has no array/set type, and a side table with a
 * UNIQUE constraint turns "have we seen this tool in this bucket before" into
 * a single indexed insert-or-ignore rather than a per-check scan.
 *
 * `refusals` is not a column on this table — it is normalised into
 * `consumer_usage_refusal` below: a closed, small error-code taxonomy (02
 * §3.1.5) counted per code, one row per (bucket, error_code).
 * `consumer_usage_latency` backs the p95 figure: Wave-0 traffic (02 §10.4
 * item 6 — one instance) is nowhere near the volume where an exact
 * order-statistics scan over a bucket's own samples is expensive, so the
 * honest exact percentile is used rather than a streaming approximation.
 */
export const CONSUMER_USAGE_BUCKET: TableSpec = {
  name: 'consumer_usage_bucket',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    consumer_id: { kind: 'text', notNull: true },
    // 'hour' | 'day' (CONSUMER_USAGE_GRANULARITIES, ../usage/types.ts).
    granularity: { kind: 'text', notNull: true },
    // ISO-8601 UTC, floored to the start of the hour or day.
    bucket_start: { kind: 'timestamp', notNull: true },

    calls: { kind: 'integer', notNull: true },
    writes: { kind: 'integer', notNull: true },
    plans_minted: { kind: 'integer', notNull: true },
    plans_confirmed: { kind: 'integer', notNull: true },
    distinct_tools: { kind: 'integer', notNull: true },
    distinct_binding_types: { kind: 'integer', notNull: true },
    distinct_subjects: { kind: 'integer', notNull: true },
    bytes_out: { kind: 'integer', notNull: true },

    updated_at: { kind: 'timestamp', notNull: true },
  },
  indexes: [
    // THE control: one row per bucket. Also the lookup the quota check and
    // the rollup's own read-then-increment use.
    {
      name: 'consumer_usage_bucket_uq',
      columns: ['consumer_id', 'granularity', 'bucket_start'],
      unique: true,
    },
    { name: 'consumer_usage_bucket_granularity_idx', columns: ['granularity', 'bucket_start'] },
  ],
};

/** `consumer_usage_refusal` — refusals by error code, one row per (bucket, code). */
export const CONSUMER_USAGE_REFUSAL: TableSpec = {
  name: 'consumer_usage_refusal',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    bucket_id: {
      kind: 'text',
      notNull: true,
      references: { table: 'consumer_usage_bucket', column: 'id' },
    },
    error_code: { kind: 'text', notNull: true },
    count: { kind: 'integer', notNull: true },
  },
  indexes: [
    { name: 'consumer_usage_refusal_uq', columns: ['bucket_id', 'error_code'], unique: true },
  ],
};

/** `consumer_usage_tool` — first-write-wins membership, backs `distinct_tools`. */
export const CONSUMER_USAGE_TOOL: TableSpec = {
  name: 'consumer_usage_tool',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    bucket_id: {
      kind: 'text',
      notNull: true,
      references: { table: 'consumer_usage_bucket', column: 'id' },
    },
    tool_id: { kind: 'text', notNull: true },
  },
  indexes: [{ name: 'consumer_usage_tool_uq', columns: ['bucket_id', 'tool_id'], unique: true }],
};

/** `consumer_usage_binding_type` — first-write-wins membership, backs `distinct_binding_types`. */
export const CONSUMER_USAGE_BINDING_TYPE: TableSpec = {
  name: 'consumer_usage_binding_type',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    bucket_id: {
      kind: 'text',
      notNull: true,
      references: { table: 'consumer_usage_bucket', column: 'id' },
    },
    binding_type: { kind: 'text', notNull: true },
  },
  indexes: [
    {
      name: 'consumer_usage_binding_type_uq',
      columns: ['bucket_id', 'binding_type'],
      unique: true,
    },
  ],
};

/**
 * `consumer_usage_subject` — first-write-wins membership, backs
 * `distinct_subjects` ("distinct human subjects acted for", 02 §11.6 — the
 * subject-fan-out anomaly's own raw material, W0-N8).
 */
export const CONSUMER_USAGE_SUBJECT: TableSpec = {
  name: 'consumer_usage_subject',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    bucket_id: {
      kind: 'text',
      notNull: true,
      references: { table: 'consumer_usage_bucket', column: 'id' },
    },
    // `Principal.subject` — the only identity value written (CLAUDE.md §3).
    caller_subject: { kind: 'text', notNull: true },
  },
  indexes: [
    { name: 'consumer_usage_subject_uq', columns: ['bucket_id', 'caller_subject'], unique: true },
  ],
};

/**
 * `consumer_usage_latency` — one row per call's `latency_ms_total`, backing an
 * exact p95 over the bucket at read time. Bounded by the bucket's own call
 * volume, which at Wave 0 (one gateway instance) is never large enough to make
 * an exact order-statistics read expensive; see `CONSUMER_USAGE_BUCKET` above.
 */
export const CONSUMER_USAGE_LATENCY: TableSpec = {
  name: 'consumer_usage_latency',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    bucket_id: {
      kind: 'text',
      notNull: true,
      references: { table: 'consumer_usage_bucket', column: 'id' },
    },
    latency_ms: { kind: 'integer', notNull: true },
  },
  indexes: [{ name: 'consumer_usage_latency_bucket_idx', columns: ['bucket_id', 'latency_ms'] }],
};

/**
 * `consumer_usage_identity_mismatch` — W0-N9. "Count of calls where
 * `identity_match = false`" per bucket — the `identity-echo-mismatch`
 * detector's raw material.
 *
 * Shaped as a one-row-per-bucket COUNTER satellite, the same family as
 * `consumer_usage_refusal` above, rather than a column on
 * `CONSUMER_USAGE_BUCKET` itself: `identity_match` is a fact recorded on
 * `audit_call` (`../audit/types.ts`) that this rollup did not previously
 * carry at all, and giving it its own satellite — instead of widening the
 * bucket's own row — keeps the bucket table's write path (a single `update …
 * set x = x + 1` per column) unchanged and keeps this new signal an
 * independently-reviewable addition, exactly as `consumer_usage_refusal` is
 * for "refusals by error code". Unlike `consumer_usage_refusal` there is no
 * second key dimension (there is no "which error code" equivalent for a
 * mismatch — a call either echoed the resolved identity or it did not), so
 * this table carries exactly one row per bucket, upserted the same
 * read-then-increment way as the bucket row itself.
 */
export const CONSUMER_USAGE_IDENTITY_MISMATCH: TableSpec = {
  name: 'consumer_usage_identity_mismatch',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    bucket_id: {
      kind: 'text',
      notNull: true,
      references: { table: 'consumer_usage_bucket', column: 'id' },
    },
    count: { kind: 'integer', notNull: true },
  },
  indexes: [
    { name: 'consumer_usage_identity_mismatch_uq', columns: ['bucket_id'], unique: true },
  ],
};

/**
 * `anomaly_event` — 02 §11.6's event schema, verbatim:
 * `anomaly_event(id, ts, consumer_id, detector_id, severity, window, observed,
 * threshold, audit_call_ids[], state)`. W0-N8.
 *
 * The Wave 3 monitoring product conforms to THIS schema, which is why it is
 * defined in Wave 0: the table is blast-radius work (04 §1.1 Test 1), the
 * triage workflow over it is not.
 *
 * Two shape decisions worth stating:
 *
 * 1. `audit_call_ids[]` is **not** a column. SQLite has no array type, and 02
 *    §10.4 item 2's rule — a membership query gets a normalised side table, not
 *    a JSON array — already governs `audit_call_role`, `audit_result_key` and
 *    the four `consumer_usage_*` satellites. `anomaly_event_audit_call` below
 *    is the same construction, and it is what makes 02 §11.6's "every alert is
 *    one click from its evidence" a foreign key rather than a string parse.
 *
 * 2. `observed` and `threshold` are `text`, holding the decimal representation
 *    of a number. Several of 02 §11.6's seven patterns are RATIOS (plan
 *    abandonment, N× trailing baseline), which are not integers, and this
 *    file's `ColumnKind` set deliberately has no floating-point kind — adding
 *    one would change every projection and every existing table's parity story
 *    for one column pair. Canonical decimal text round-trips a JS number
 *    losslessly and sorts by value only within a fixed scale, which is why the
 *    column is never ordered on; ordering is by `ts`, which is what a triage
 *    queue actually reads.
 *
 * `severity` and `state` are closed sets held in `../anomaly/types.ts`, not
 * enums in the DDL: neither dialect's enum support projects identically, and
 * the closed set is enforced at the repository boundary where the error
 * message can be useful.
 */
export const ANOMALY_EVENT: TableSpec = {
  name: 'anomaly_event',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    ts: { kind: 'timestamp', notNull: true },
    consumer_id: { kind: 'text', notNull: true },
    detector_id: { kind: 'text', notNull: true },
    // ANOMALY_SEVERITIES — 'low' | 'medium' | 'high' | 'critical'.
    severity: { kind: 'text', notNull: true },
    // The detector's declared observation window token, e.g. '1h' | '24h'.
    window: { kind: 'text', notNull: true },
    // Canonical decimal text — see the header note above.
    observed: { kind: 'text', notNull: true },
    threshold: { kind: 'text', notNull: true },
    // ANOMALY_EVENT_STATES — 'open' | 'acknowledged' | 'resolved'.
    state: { kind: 'text', notNull: true },
  },
  indexes: [
    { name: 'anomaly_event_consumer_ts_idx', columns: ['consumer_id', 'ts'] },
    { name: 'anomaly_event_detector_ts_idx', columns: ['detector_id', 'ts'] },
    { name: 'anomaly_event_state_ts_idx', columns: ['state', 'ts'] },
  ],
};

/**
 * `anomaly_event_audit_call` — the normalised `audit_call_ids[]`. One row per
 * (event, audit call), foreign-keyed BOTH ways so an event's evidence and a
 * call's alerts are each a single indexed lookup. 02 §10.4 item 2's precedent.
 */
export const ANOMALY_EVENT_AUDIT_CALL: TableSpec = {
  name: 'anomaly_event_audit_call',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    event_id: {
      kind: 'text',
      notNull: true,
      references: { table: 'anomaly_event', column: 'id' },
    },
    call_id: { kind: 'text', notNull: true, references: { table: 'audit_call', column: 'id' } },
  },
  indexes: [
    { name: 'anomaly_event_audit_call_uq', columns: ['event_id', 'call_id'], unique: true },
    { name: 'anomaly_event_audit_call_call_idx', columns: ['call_id'] },
  ],
};

/**
 * `consumption_edge` — 02 §4.6's last named satellite: *"tool → consuming
 * agent/platform/scope, rolled up for G9"*, with §11.3's decisive clause:
 *
 * > "This is what finally feeds `consumption_edge`: `consumer_id` **is** the
 * > 'consuming agent,' authenticated rather than self-declared, which is what
 * > makes G9 @ M1 evidenceable."
 *
 * **Why this table has no name column, and never will.** Before Phase 5 the
 * only candidate for "consuming agent" was the `clientInfo.name` an MCP client
 * declares about itself at `initialize` — a string the caller chooses, which
 * would make every consumption number a self-report. There is therefore no
 * `agent_name`, `client_name`, `display_name` or `label` column here: the edge
 * is keyed on `consumer_id`, which exists only because `[2a]`
 * (`../../transport/consumer-auth/**`) verified a registered credential, and a
 * label a reader wants is joined from the git-held `consumers/**` record at
 * read time. A column that could hold an unauthenticated name is a column that
 * eventually would, so the schema does not offer one — see
 * `../consumption/consumption-edge.test.ts`.
 *
 * **Shape.** One row per `(deployment_id, consumer_id, tool_id)`, upserted
 * from INSIDE `audit.append`'s own transaction and sourced from the audit row
 * that append just built — never from a second, separately-committed write and
 * never from a value the caller supplied alongside it. All three key columns
 * are `NOT NULL` on `audit_call`, so the edge needs no sentinel for a missing
 * key and cannot acquire one. `binding_type` and `last_call_id` are
 * descriptive last-observed facts, not part of the key: an edge is "this
 * consumer consumed this tool", and per-binding detail is a join back to
 * `audit_call`, which holds the full history the edge only summarises.
 */
export const CONSUMPTION_EDGE: TableSpec = {
  name: 'consumption_edge',
  columns: {
    id: { kind: 'text', primaryKey: true, notNull: true },
    deployment_id: { kind: 'text', notNull: true },
    // THE authenticated "consuming agent" (02 §11.3). Copied from
    // `audit_call.consumer_id`, which `[2a]` established. Never a claim.
    consumer_id: { kind: 'text', notNull: true },
    tool_id: { kind: 'text', notNull: true },

    // Last-observed descriptive facts — see the header note above.
    binding_type: { kind: 'text' },
    /** The most recent `audit_call.id` on this edge, so a row is traceable back to its evidence. */
    last_call_id: { kind: 'text', notNull: true, references: { table: 'audit_call', column: 'id' } },

    first_seen_at: { kind: 'timestamp', notNull: true },
    last_seen_at: { kind: 'timestamp', notNull: true },
    call_count: { kind: 'integer', notNull: true },
    write_count: { kind: 'integer', notNull: true },
  },
  indexes: [
    // THE control: one row per edge, and the lookup the upsert itself uses.
    {
      name: 'consumption_edge_uq',
      columns: ['deployment_id', 'consumer_id', 'tool_id'],
      unique: true,
    },
    // "Which agents consume this tool" — the G9 rollup's own direction.
    { name: 'consumption_edge_tool_idx', columns: ['tool_id', 'last_seen_at'] },
    { name: 'consumption_edge_consumer_idx', columns: ['consumer_id', 'last_seen_at'] },
  ],
};

/**
 * Every table in the runtime store, keyed by its TypeScript-facing name.
 *
 * Declaration order is dependency order: a table must appear after every table
 * it references, because the dialect projections resolve foreign keys against
 * the tables already built.
 */
export const RUNTIME_TABLES = {
  storeHeartbeat: STORE_HEARTBEAT,
  auditCall: AUDIT_CALL,
  auditResultKey: AUDIT_RESULT_KEY,
  auditCallRole: AUDIT_CALL_ROLE,
  auditCredentialRef: AUDIT_CREDENTIAL_REF,
  auditRetentionGate: AUDIT_RETENTION_GATE,
  // W0-C3 — the write path's runtime state. None of the three references
  // another, so their order among themselves is arbitrary.
  idempotencyRecord: IDEMPOTENCY_RECORD,
  confirmNonce: CONFIRM_NONCE,
  approvalRequest: APPROVAL_REQUEST,
  // W0-D2 — the local user store. `local_user` before the group side table
  // that references it.
  localUser: LOCAL_USER,
  localUserGroup: LOCAL_USER_GROUP,
  // W0-E5 — the kill switch's persistence.
  runtimeFlags: RUNTIME_FLAG,
  // W0-N7 — consumer usage rollups. `consumer_usage_bucket` before the four
  // side tables that reference it.
  consumerUsageBucket: CONSUMER_USAGE_BUCKET,
  consumerUsageRefusal: CONSUMER_USAGE_REFUSAL,
  consumerUsageTool: CONSUMER_USAGE_TOOL,
  consumerUsageBindingType: CONSUMER_USAGE_BINDING_TYPE,
  consumerUsageSubject: CONSUMER_USAGE_SUBJECT,
  consumerUsageLatency: CONSUMER_USAGE_LATENCY,
  // W0-N9 — the identity-echo-mismatch rollup, same family as the four
  // side tables just above.
  consumerUsageIdentityMismatch: CONSUMER_USAGE_IDENTITY_MISMATCH,
  // W0-N8 — the anomaly event schema. `anomaly_event` before the side table
  // that references it (and `audit_call`, which it also references, is above).
  anomalyEvent: ANOMALY_EVENT,
  anomalyEventAuditCall: ANOMALY_EVENT_AUDIT_CALL,
  // W0-N10 — 02 §4.6's `consumption_edge`, after `audit_call`, which it
  // references through `last_call_id`.
  consumptionEdge: CONSUMPTION_EDGE,
} as const satisfies Readonly<Record<string, TableSpec>>;

export type RuntimeTableName = keyof typeof RUNTIME_TABLES;
