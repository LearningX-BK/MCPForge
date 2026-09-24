// MCPForge — the retention attestation. W0-C4.
//
// **The problem this file exists to solve, stated before the solution.**
//
// 02 §4.6 makes retention "the one exception to append-only". But deleting the
// oldest rows of a hash chain breaks it: the surviving first row's `prev_hash`
// commits to the `row_hash` of a row that no longer exists, so it can neither
// be recomputed nor compared. A verifier that shrugged at that would be unable
// to tell "retention legitimately removed the head of the chain" from "someone
// deleted the rows that recorded what they did" — and indistinguishability
// from tampering is precisely the failure the chain exists to prevent.
//
// The answer: retention deletes only a **contiguous prefix** (retention is by
// age, and age-ordered deletion of a time-ordered chain is naturally a
// prefix), and it then appends an ordinary `audit_call` row about itself whose
// `args_redacted` carries this attestation. Because that row is an ordinary
// audit row, its content is covered by `row_hash` and linked into the same
// chain — it cannot be edited, back-dated, or inserted after the fact without
// the chain failing at it. `forge audit verify` accepts a non-genesis chain
// origin **only** when an attestation row in the same chain names exactly that
// `prev_hash` as its deletion boundary.
//
// What this does NOT claim, and must never be written as though it did: an
// attacker with the SQLite file can delete rows AND append a matching
// attestation of their own, because on SQLite they can drop the triggers and
// write anything (02 §10.4 item 1 — detectable, not preventable). What the
// design buys is that they must then *say so*, in a durable, hash-committed
// record naming a count, a cutoff, an actor and a boundary. Silent erasure
// becomes loud erasure. The gap closes when the store is Postgres and the
// application role genuinely cannot DELETE.

/**
 * Versioned, like `AUDIT_CHAIN_ALGORITHM` and for the same reason: a change to
 * the fields below changes what a verifier will accept as an explained chain
 * origin, and that discontinuity must be explicit rather than silent.
 */
export const AUDIT_RETENTION_ATTESTATION_KIND = 'mcpforge/audit-retention/v1' as const;

/**
 * The `tool_id` the attestation row is written under.
 *
 * It follows CLAUDE.md §5's `{app}.{module}.{entity}.{verb}` grammar with
 * `run_process` from the closed 19-verb list, so the audit trail has one id
 * vocabulary rather than two. It is deliberately NOT a manifest tool: no agent
 * can call it, it is not in any role, and it never appears in `tools/list` —
 * it names an internal privileged job, which is what 02 §4.6 calls retention.
 */
export const AUDIT_RETENTION_TOOL_ID = 'forge.audit.retention.run_process' as const;

/**
 * What the job removed, as recorded inside the hash-covered
 * `audit_call.args_redacted` column of its own attestation row.
 *
 * `boundaryRowHash` is the load-bearing field: it is the `row_hash` of the
 * newest deleted row, which is by construction the `prev_hash` of the row that
 * now begins the chain. That equality is the whole check.
 */
export interface AuditRetentionAttestation {
  readonly kind: typeof AUDIT_RETENTION_ATTESTATION_KIND;
  /** The `audit_retention_gate` row that authorised the deletion. */
  readonly gateId: string;
  readonly deploymentId: string;
  /** Rows strictly older than this ISO-8601 instant were in scope. */
  readonly cutoffTs: string;
  readonly reason: string;
  readonly deletedCount: number;
  readonly boundaryRowHash: string;
  /** The row that now begins the chain, or null if the chain was emptied. */
  readonly survivingFirstCallId: string | null;
}

/**
 * Parse an `args_redacted` value back into an attestation, or return
 * `undefined` if it is not one. Strict on every field: a partially-shaped
 * attestation must NOT be treated as an explanation for a missing prefix,
 * because "explains the gap" is an authorisation decision, not a display one.
 */
export function parseRetentionAttestation(value: unknown): AuditRetentionAttestation | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate['kind'] !== AUDIT_RETENTION_ATTESTATION_KIND) {
    return undefined;
  }
  const str = (key: string): string | undefined =>
    typeof candidate[key] === 'string' && (candidate[key] as string).length > 0
      ? (candidate[key] as string)
      : undefined;

  const gateId = str('gateId');
  const deploymentId = str('deploymentId');
  const cutoffTs = str('cutoffTs');
  const reason = str('reason');
  const boundaryRowHash = str('boundaryRowHash');
  const deletedCount = candidate['deletedCount'];
  const surviving = candidate['survivingFirstCallId'];
  if (
    gateId === undefined ||
    deploymentId === undefined ||
    cutoffTs === undefined ||
    reason === undefined ||
    boundaryRowHash === undefined ||
    typeof deletedCount !== 'number' ||
    !Number.isInteger(deletedCount) ||
    deletedCount < 0 ||
    !(surviving === null || typeof surviving === 'string')
  ) {
    return undefined;
  }
  return {
    kind: AUDIT_RETENTION_ATTESTATION_KIND,
    gateId,
    deploymentId,
    cutoffTs,
    reason,
    deletedCount,
    boundaryRowHash,
    survivingFirstCallId: surviving,
  };
}
