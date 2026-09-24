// MCPForge — append-only enforcement for the audit trail. W0-C2.
//
// 02 §4.6 states the Postgres mechanism: "The application role holds `INSERT`
// and `SELECT` only; `UPDATE`/`DELETE` are revoked at the database."
//
// 02 §10.4 item 1 names this the one genuine loss under SQLite: **SQLite has
// no users, no roles and no `GRANT` at all. There is nothing to revoke.** So
// the two dialects are deliberately asymmetric here, and that asymmetry is the
// point of this file:
//
//   * SQLite  -> `BEFORE UPDATE` and `BEFORE DELETE` triggers that
//                `RAISE(ABORT, …)`, applied below on every store open.
//   * Postgres -> a role-based `REVOKE`, which is a deployment act against a
//                real cluster with a real application role. It is documented
//                as `POSTGRES_IMMUTABILITY_RECOMMENDATION` and carried into
//                the deployment runbook; it is NOT executed from here,
//                because there is no live Postgres instance at Wave 0 and
//                because a store that could grant and revoke its own
//                privileges would defeat the control it is applying.
//
// **State it honestly and do not dress it up: on SQLite this makes tampering
// detectable, not preventable.** A trigger is enforced by the SQLite library,
// not by a privilege boundary — anyone with the file can open a `sqlite3`
// shell, `DROP TRIGGER`, and rewrite a row. What they cannot do is make the
// hash chain in `./hash.ts` still verify afterwards. That is why
// `forge audit verify` (W0-C4) is load-bearing at Wave 0 rather than a nicety,
// and why the Wave 0 checkpoint records this as a known, accepted, waived
// limitation whose named closure trigger is the Postgres migration.

import { sql } from 'drizzle-orm';
import type { DialectConnection } from '../dialect.js';
import {
  AUDIT_CALL,
  AUDIT_CALL_ROLE,
  AUDIT_CREDENTIAL_REF,
  AUDIT_RESULT_KEY,
  AUDIT_RETENTION_GATE,
} from '../schema/spec.js';

/**
 * Every table the append-only rule covers.
 *
 * `audit_call` is explicit in the W0-C2 done criterion. The three satellites
 * are included because a satellite row is part of the audited fact, not
 * commentary on it: `audit_result_key` holds the business keys that make a
 * write reversible (02 §4.6, "THE reversal handle"), `audit_call_role` holds
 * the grant in force, and `audit_credential_ref` holds which credential
 * version was used. Leaving any of them mutable would leave the answer to
 * "who created document 12345" editable while `audit_call` looked untouched —
 * and satellite content is not covered by `row_hash`, so unlike a rewrite of
 * `audit_call` it would not even be detectable. They need the trigger more
 * than the parent does, not less.
 */
export const APPEND_ONLY_TABLES: readonly string[] = [
  AUDIT_CALL.name,
  AUDIT_RESULT_KEY.name,
  AUDIT_CALL_ROLE.name,
  AUDIT_CREDENTIAL_REF.name,
];

const UPDATE_ABORT_MESSAGE = (table: string): string =>
  `${table} is append-only: UPDATE is refused. Audit rows are never rewritten.`;

const DELETE_ABORT_MESSAGE = (table: string): string =>
  `${table} is append-only: DELETE is refused outside the retention job. Open ${AUDIT_RETENTION_GATE.name} first.`;

/**
 * The DDL, as text, so W0-C4's verifier and any future runbook can quote the
 * exact statements rather than paraphrase them.
 *
 * The delete trigger carries a `WHEN` clause consulting
 * `audit_retention_gate`; the update trigger deliberately carries none.
 * 02 §4.6: "Retention deletion is the one exception to append-only and runs as
 * a privileged, separately-audited job" — retention *deletes*, it never
 * rewrites, so there is no legitimate `UPDATE` of an audit row anywhere in the
 * product and the update trigger is unconditional.
 *
 * W0-C4 narrows the gate condition from "a gate row exists" to "an **open**
 * gate row exists". W0-C2 could not: the gate had no `closed_at` yet. The
 * unqualified form would have meant the first retention sweep in a
 * deployment's life left a row behind that held the gate open forever, so
 * every later `DELETE` — including one typed into a `sqlite3` shell — would
 * pass. The narrowed form closes the window to the inside of one transaction
 * in `./retention.ts`.
 *
 * The DROP before each CREATE is deliberate and is not a hedge: `CREATE
 * TRIGGER IF NOT EXISTS` silently keeps an *older definition* of a trigger
 * that already exists, which for a security control means a store opened by a
 * new build could keep enforcing the previous build's condition — exactly the
 * failure this change would otherwise have shipped. Recreating is idempotent
 * and the guard is absent only inside `applyAuditImmutability`'s own
 * transaction, before the store is handed to any caller.
 */
export function sqliteAppendOnlyDdl(table: string): readonly string[] {
  return [
    `DROP TRIGGER IF EXISTS ${table}_no_update`,
    `CREATE TRIGGER ${table}_no_update
     BEFORE UPDATE ON ${table}
     BEGIN SELECT RAISE(ABORT, '${UPDATE_ABORT_MESSAGE(table)}'); END`,
    `DROP TRIGGER IF EXISTS ${table}_no_delete`,
    `CREATE TRIGGER ${table}_no_delete
     BEFORE DELETE ON ${table}
     WHEN (SELECT COUNT(*) FROM ${AUDIT_RETENTION_GATE.name} WHERE closed_at IS NULL) = 0
     BEGIN SELECT RAISE(ABORT, '${DELETE_ABORT_MESSAGE(table)}'); END`,
  ];
}

/**
 * The Postgres half of the asymmetry, as a documented recommendation rather
 * than an executed statement — 02 §4.6's actual mechanism, for the deployment
 * runbook that creates the application role. Applying it needs a real cluster
 * and a real role name, neither of which exists at Wave 0 (W0-C1 established
 * that there is no live Postgres instance to test against; the Postgres leg of
 * the contract suite is opt-in via MCPFORGE_TEST_POSTGRES_URL).
 *
 * `{role}` is the placeholder for the application role the deployment creates.
 */
export const POSTGRES_IMMUTABILITY_RECOMMENDATION: string = [
  '-- 02 §4.6: the application role holds INSERT and SELECT only.',
  '-- Run as the schema owner, NOT as the application role, when provisioning.',
  ...APPEND_ONLY_TABLES.flatMap((table) => [
    `GRANT INSERT, SELECT ON ${table} TO {role};`,
    `REVOKE UPDATE, DELETE ON ${table} FROM {role};`,
  ]),
  '-- Retention runs as a separate, privileged, separately-audited role.',
].join('\n');

/**
 * Apply this dialect's append-only enforcement. Idempotent, so it is safe on
 * every store open — which is what it gets, because a trigger dropped by
 * someone editing the file directly is then quietly restored on the next
 * gateway start. (That restores the guard; it does not undo the tampering, and
 * it does not repair the hash chain. Only `forge audit verify` reports that.)
 *
 * Returns the statements it ran, so a caller can log or assert on them.
 */
export async function applyAuditImmutability(
  connection: DialectConnection,
): Promise<readonly string[]> {
  if (connection.kind !== 'sqlite') {
    // Postgres immutability is a privilege act performed at provisioning time
    // by the schema owner — see POSTGRES_IMMUTABILITY_RECOMMENDATION above.
    return [];
  }
  const applied: string[] = [];
  // One transaction: `sqliteAppendOnlyDdl` drops each trigger before
  // recreating it, and the interval between the two is the only moment the
  // guard is not in force. Inside a transaction that interval is not
  // observable by any other reader or writer.
  await connection.transaction(async () => {
    for (const table of APPEND_ONLY_TABLES) {
      for (const statement of sqliteAppendOnlyDdl(table)) {
        await connection.run(sql.raw(statement));
        applied.push(statement);
      }
    }
  });
  return applied;
}
