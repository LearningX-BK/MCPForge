// MCPForge — the chain walk behind `forge audit verify`. W0-C4.
//
// 02 §4.6: "`forge audit verify` re-walks the chain and reports the first
// break." 02 §10.4 item 1 says why that is load-bearing rather than a nicety
// at Wave 0: SQLite has no grant model, so the trail is protected by
// detection, not by prevention, and this walk IS the detection. It runs in CI,
// on every probe run, and on portal load of the Activity → Integrity panel.
//
// It lives in the store rather than in the CLI for one reason: the recomputed
// hash must be taken over the **raw stored columns**, and the raw columns are
// exactly what `RuntimeStore` exists to keep behind this boundary. The CLI
// asks the store a question and formats the answer; it never holds a row.
//
// Every hash here comes from `./hash.ts`. There is no second canonical form in
// this file, and there must never be one — a re-derivation would make a
// genuine break look like a false alarm, or, worse, the reverse.

import { sql } from 'drizzle-orm';
import type { DialectConnection } from '../dialect.js';
import { AUDIT_CALL } from '../schema/spec.js';
import { AUDIT_CHAIN_GENESIS, auditRowHash, type AuditHashValue } from './hash.js';
import { parseRetentionAttestation, type AuditRetentionAttestation } from './attestation.js';

const CALL = sql.identifier(AUDIT_CALL.name);

/**
 * `intact` — the chain runs unbroken from genesis.
 * `intact_from_retention_boundary` — unbroken, but it does NOT start at
 *   genesis: an earlier prefix was removed by retention, and an attestation
 *   row in this same chain accounts for exactly that boundary. Reported as its
 *   own status rather than folded into `intact`, because "nothing was ever
 *   removed" and "something was removed and here is the receipt" are different
 *   facts and a human reading an integrity panel is entitled to both.
 * `broken` — the first anomaly is in `firstBreak`.
 * `empty` — no rows for this deployment. On SQLite that is the expected state
 *   of a fresh checkout (02 §10.3) and is not a finding.
 */
export type AuditChainStatus = 'intact' | 'intact_from_retention_boundary' | 'broken' | 'empty';

export type AuditChainBreakReason =
  /** The row's own content no longer hashes to its stored `row_hash`. */
  | 'row_hash_mismatch'
  /** The row does not link to its predecessor's `row_hash`. */
  | 'prev_hash_mismatch'
  /**
   * The chain begins somewhere other than genesis and no verified retention
   * attestation in this chain accounts for the missing prefix. This is the
   * deletion-as-tampering case.
   */
  | 'unexplained_chain_origin';

export interface AuditChainBreak {
  /** The row the chain fails AT — the `done:` criterion's "first broken row by id". */
  readonly rowId: string;
  /** 0-based position in the surviving chain, oldest first. */
  readonly position: number;
  readonly reason: AuditChainBreakReason;
  /** What the chain says should be true. */
  readonly expected: string;
  /** What is actually stored (or recomputed) instead. */
  readonly actual: string;
  readonly message: string;
  /** CLAUDE.md non-negotiable 5 — never "try again"; name the action. */
  readonly next: string;
}

export interface AuditChainOrigin {
  readonly kind: 'genesis' | 'retention_boundary';
  readonly firstRowId: string;
  readonly firstRowPrevHash: string;
  /** Present only for `retention_boundary`. */
  readonly attestation?: AuditRetentionAttestation & { readonly callId: string };
}

export interface AuditChainVerification {
  readonly deploymentId: string;
  readonly status: AuditChainStatus;
  readonly rowsChecked: number;
  /** Where the surviving chain begins, and why that is legitimate. Null when empty or broken at row 0. */
  readonly origin: AuditChainOrigin | null;
  readonly firstBreak: AuditChainBreak | null;
}

type RawRow = Record<string, AuditHashValue>;

function str(row: RawRow, column: string): string {
  const value = row[column];
  return value === null || value === undefined ? '' : String(value);
}

/** Every deployment that has ever written a row. */
export async function listAuditDeployments(connection: DialectConnection): Promise<string[]> {
  const rows = await connection.all<Record<string, unknown>>(
    sql`select distinct ${sql.identifier('deployment_id')} from ${CALL} order by ${sql.identifier('deployment_id')} asc`,
  );
  return rows.map((row) => String(row['deployment_id']));
}

/**
 * Walk one deployment's chain, oldest first, and report the FIRST anomaly.
 *
 * Order of business, and it matters:
 *  1. Recompute every row's `row_hash` over its raw stored columns. This is a
 *     full pass, not a short-circuit, because step 3 needs to know which rows
 *     are trustworthy before it will accept one as an explanation.
 *  2. Check each row's `prev_hash` against its predecessor's stored `row_hash`.
 *  3. Resolve the chain's origin: genesis, or a retention boundary explained
 *     by an attestation row that itself passed step 1.
 * The first anomaly **in chain order** is what gets reported, whichever of the
 * three found it, so a break is always named at the earliest row it affects.
 */
export async function verifyAuditChain(
  connection: DialectConnection,
  deploymentId: string,
): Promise<AuditChainVerification> {
  const rows = await connection.all<RawRow>(
    sql`select * from ${CALL} where ${sql.identifier('deployment_id')} = ${deploymentId} order by ${sql.identifier('id')} asc`,
  );

  if (rows.length === 0) {
    return {
      deploymentId,
      status: 'empty',
      rowsChecked: 0,
      origin: null,
      firstBreak: null,
    };
  }

  // -- 1. per-row integrity.
  const contentOk: boolean[] = [];
  let firstBreak: AuditChainBreak | null = null;
  const noteBreak = (candidate: AuditChainBreak): void => {
    if (firstBreak === null || candidate.position < firstBreak.position) {
      firstBreak = candidate;
    }
  };

  for (const [position, row] of rows.entries()) {
    const stored = str(row, 'row_hash');
    const recomputed = auditRowHash(row);
    const ok = stored === recomputed;
    contentOk.push(ok);
    if (!ok) {
      noteBreak({
        rowId: str(row, 'id'),
        position,
        reason: 'row_hash_mismatch',
        expected: stored,
        actual: recomputed,
        message: `audit_call row ${str(row, 'id')} no longer hashes to its stored row_hash: its content was rewritten after it was written.`,
        next: `Treat every row from this one onward as unverified. Inspect this call id in Activity, compare it against the SIEM copy or the last backup of .mcpforge/runtime.db, and record the finding — the row cannot be repaired, only accounted for. On SQLite the trail is tamper-EVIDENT, not tamper-proof (02 §10.4 item 1).`,
      });
    }
  }

  // -- 2. linkage.
  for (let position = 1; position < rows.length; position += 1) {
    const row = rows[position]!;
    const predecessor = rows[position - 1]!;
    const expected = str(predecessor, 'row_hash');
    const actual = str(row, 'prev_hash');
    if (expected !== actual) {
      noteBreak({
        rowId: str(row, 'id'),
        position,
        reason: 'prev_hash_mismatch',
        expected,
        actual,
        message: `audit_call row ${str(row, 'id')} does not link to its predecessor ${str(predecessor, 'id')}: a row between them was removed, or one of the two was rewritten.`,
        next: `Compare this call id and ${str(predecessor, 'id')} against the SIEM copy or the last backup of .mcpforge/runtime.db, and check audit_retention_gate for a sweep that claims this boundary. A legitimate retention sweep removes a PREFIX of the chain and never leaves a hole in the middle, so a gap here is not retention.`,
      });
    }
  }

  // -- 3. origin.
  const first = rows[0]!;
  const firstPrevHash = str(first, 'prev_hash');
  let origin: AuditChainOrigin | null = null;

  if (firstPrevHash === AUDIT_CHAIN_GENESIS) {
    origin = {
      kind: 'genesis',
      firstRowId: str(first, 'id'),
      firstRowPrevHash: firstPrevHash,
    };
  } else {
    // The chain starts mid-air. Only a retention attestation that (a) is in
    // this same chain, (b) passed its own content check, and (c) names exactly
    // this prev_hash as the boundary it deleted up to, makes that legitimate.
    let explained: (AuditRetentionAttestation & { readonly callId: string }) | undefined;
    for (const [position, row] of rows.entries()) {
      if (!contentOk[position]) {
        continue;
      }
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(str(row, 'args_redacted')) as unknown;
      } catch {
        continue;
      }
      const attestation = parseRetentionAttestation(parsedArgs);
      if (
        attestation !== undefined &&
        attestation.deploymentId === deploymentId &&
        attestation.boundaryRowHash === firstPrevHash
      ) {
        explained = { ...attestation, callId: str(row, 'id') };
        break;
      }
    }

    if (explained === undefined) {
      noteBreak({
        rowId: str(first, 'id'),
        position: 0,
        reason: 'unexplained_chain_origin',
        expected: AUDIT_CHAIN_GENESIS,
        actual: firstPrevHash,
        message: `The chain for deployment "${deploymentId}" begins at ${str(first, 'id')}, whose prev_hash is neither genesis nor accounted for by a retention attestation: rows before it were deleted without a receipt.`,
        next: `Check audit_retention_gate for a sweep on this deployment and confirm whether one ran. If none did, this is a deletion of audit history — escalate it, preserve the file, and compare against the SIEM copy or the last backup. Retention is the only sanctioned deletion path (02 §4.6) and it always writes an attestation row.`,
      });
    } else {
      origin = {
        kind: 'retention_boundary',
        firstRowId: str(first, 'id'),
        firstRowPrevHash: firstPrevHash,
        attestation: explained,
      };
    }
  }

  const broken: AuditChainBreak | null = firstBreak;
  return {
    deploymentId,
    status:
      broken !== null
        ? 'broken'
        : origin?.kind === 'retention_boundary'
          ? 'intact_from_retention_boundary'
          : 'intact',
    rowsChecked: rows.length,
    // Reported even alongside a break: knowing where the surviving chain
    // starts is part of reading the break, not a reward for passing.
    origin,
    firstBreak: broken,
  };
}
