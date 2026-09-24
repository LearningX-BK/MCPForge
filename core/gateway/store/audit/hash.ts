// MCPForge — the audit hash chain. W0-C2, 02 §4.6:
//
//   "Each row carries `prev_hash` and `row_hash`, forming a per-deployment
//    hash chain; `forge audit verify` re-walks the chain and reports the first
//    break."
//
// **On SQLite this makes tampering detectable, not preventable** (02 §10.4
// item 1). SQLite has no users, no roles and no `GRANT`, so the privilege-
// revoked immutability §4.6 assumes does not exist: anyone holding
// `.mcpforge/runtime.db` can drop the triggers in `./immutability.ts` and
// rewrite a row. What this file guarantees is that doing so is *visible* —
// the rewritten row's `row_hash` no longer matches its content, and every
// later row's `prev_hash` no longer matches its predecessor. That is the
// entire security claim, and it must not be stated more strongly than this.
// It becomes preventable the moment the store is Postgres with a real grant
// model.

import { createHash } from 'node:crypto';
import { AUDIT_CALL } from '../schema/spec.js';

/**
 * Domain separator. Versioned because a change to the canonical form below is
 * a change to every hash the product will ever compute; bumping this makes the
 * discontinuity explicit rather than silent. It is why 02 §11.3 requires the
 * Phase 5 columns to land in W0-C2 **before the first audit row exists**.
 */
export const AUDIT_CHAIN_ALGORITHM = 'mcpforge/audit-chain/v1' as const;

/**
 * The `prev_hash` of the first row in a deployment's chain.
 *
 * Sixty-four zeros rather than a null, for three reasons: `prev_hash` stays
 * `NOT NULL`, so a row can never be written with no link at all; the chain
 * walk in `forge audit verify` (W0-C4) has one code path instead of two; and
 * the `(deployment_id, prev_hash)` unique index then also guarantees **one**
 * genesis row per deployment, so a second chain cannot be started alongside
 * the first.
 */
export const AUDIT_CHAIN_GENESIS =
  '0000000000000000000000000000000000000000000000000000000000000000';

/** Values a canonicalised audit column may hold. */
export type AuditHashValue = string | number | boolean | null;

/**
 * The columns covered by `row_hash`, in a fixed order taken from the single
 * schema definition — every column of `audit_call` except `row_hash` itself.
 *
 * Derived rather than hand-listed on purpose: a column added to `spec.ts` and
 * forgotten here would be a column an attacker could rewrite without breaking
 * the chain. Ordering is `spec.ts`'s declaration order, which is 02 §4.6's own
 * block order (who / what / where / phase / io / outcome / identity / reversal
 * / performance / integrity).
 */
export const AUDIT_HASHED_COLUMNS: readonly string[] = Object.keys(AUDIT_CALL.columns).filter(
  (name) => name !== 'row_hash',
);

// ASCII unit and record separators. Chosen because they cannot occur in an
// ISO-8601 timestamp, a UUIDv7, a sha256 hex string or a JSON document as
// serialised by JSON.stringify, so no value can forge a field boundary.
const FIELD = '\u001f';
const RECORD = '\u001e';
// A null must not canonicalise to the same bytes as the empty string, or
// "null" as text — otherwise two materially different rows would hash alike.
const NULL_MARKER = '\u0000null';

function canonicalValue(value: AuditHashValue | undefined): string {
  if (value === undefined || value === null) {
    return NULL_MARKER;
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('An audit column may not hold a non-finite number.');
    }
    return String(value);
  }
  return value;
}

/**
 * The exact bytes `row_hash` is taken over. Exported so `forge audit verify`
 * (W0-C4) recomputes with this function rather than a second implementation —
 * a re-derivation of the canonical form would be the drift that makes a
 * genuine break look like a false alarm, or worse, the reverse.
 *
 * `prev_hash` is one of the hashed columns, so each `row_hash` commits to its
 * predecessor: that is what makes the sequence a chain rather than a set of
 * independent checksums.
 */
export function canonicalAuditRow(row: Readonly<Record<string, AuditHashValue>>): string {
  return (
    AUDIT_CHAIN_ALGORITHM +
    RECORD +
    AUDIT_HASHED_COLUMNS.map((name) => `${name}${FIELD}${canonicalValue(row[name])}`).join(RECORD)
  );
}

/**
 * sha256 of the canonical form, lower-case hex — the same primitive and
 * encoding `manifestSha256` uses in `core/codegen`, so there is one hash
 * vocabulary across the product.
 */
export function auditRowHash(row: Readonly<Record<string, AuditHashValue>>): string {
  return createHash('sha256').update(canonicalAuditRow(row), 'utf8').digest('hex');
}
