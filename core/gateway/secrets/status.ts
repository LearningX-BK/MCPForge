// MCPForge — rotation status for every ref. W0-N6, 02 §11.5 rule 5.
//
// "A credential past its interval is an amber finding in Governance →
// Consumers and Environments; past **2×** its interval it raises an anomaly
// event. `forge secrets status --json` reports age and next-due for every ref,
// and rotation may not be silently skipped."
//
// The arithmetic lives here rather than in the CLI command for one reason: the
// portal's Governance screen has to reach the same three-state verdict from the
// same numbers, and a second implementation there would be a second definition
// of "overdue". The CLI formats what this returns; it does not compute it.
//
// **Age is measured from the last rotation, falling back to creation.** A
// credential that has never been rotated is as old as it is, which is the
// honest reading of "age" for a rotation schedule — `createdAt` is when the
// clock started and `rotatedAt` is when it was last reset.
//
// **The interval comes from the ref's SCOPE, not from the stored metadata.**
// `ROTATION_INTERVAL_DAYS` is 02 §11.5 rule 5's schedule (consumer 90, binding
// 180, gateway 90) and it is policy, not data: a stored `expiresAt` that
// disagreed with the policy would let a credential seeded with a generous
// expiry quietly opt out of its own rotation schedule.

import { ROTATION_INTERVAL_DAYS, type SecretMetadata, type SecretRef } from './types.js';

const MS_PER_DAY = 86_400_000;

/**
 * Three states, matching 02 §11.5 rule 5's own three:
 *  - `ok`      — inside its interval.
 *  - `overdue` — past its interval, under 2×. Rule 5's "amber finding".
 *  - `critical`— past 2× its interval. Rule 5's anomaly-raising state, and the
 *                one that makes `forge secrets status` exit non-zero.
 */
export type SecretRotationState = 'ok' | 'overdue' | 'critical';

export interface SecretRotationStatus {
  readonly ref: string;
  readonly scope: SecretRef['scope'];
  readonly version: number;
  readonly createdAt: string;
  readonly rotatedAt: string | null;
  /** Whole days since the last rotation, or since creation if never rotated. */
  readonly ageDays: number;
  readonly intervalDays: number;
  /** ISO instant the next rotation is due: age anchor + interval. */
  readonly nextDueAt: string;
  /** Negative once due. Whole days. */
  readonly daysUntilDue: number;
  readonly state: SecretRotationState;
}

/** The instant the age clock last reset: the rotation, else the creation. */
function ageAnchor(metadata: SecretMetadata): number {
  const anchor = metadata.rotatedAt ?? metadata.createdAt;
  const parsed = Date.parse(anchor);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `Secret ${metadata.ref} carries an unparseable timestamp "${anchor}"; its rotation age cannot be computed. Do not hand-edit a sealed vault.`,
    );
  }
  return parsed;
}

/** Floor, so "0 days" means "less than a day old" rather than "rounded down from nearly two". */
function wholeDays(ms: number): number {
  return Math.floor(ms / MS_PER_DAY);
}

export function rotationStatusFor(
  ref: SecretRef,
  metadata: SecretMetadata,
  now: Date = new Date(),
): SecretRotationStatus {
  const anchor = ageAnchor(metadata);
  const intervalDays = ROTATION_INTERVAL_DAYS[ref.scope];
  const ageMs = now.getTime() - anchor;
  const dueMs = anchor + intervalDays * MS_PER_DAY;
  const ageDays = wholeDays(ageMs);
  // Strictly greater-than on both thresholds: a credential rotated exactly
  // `intervalDays` ago is due today, not yet overdue. The 2x boundary is the
  // one that changes an exit code, so it is stated once and read twice.
  const state: SecretRotationState =
    ageDays > intervalDays * 2 ? 'critical' : ageDays > intervalDays ? 'overdue' : 'ok';
  return {
    ref: metadata.ref,
    scope: ref.scope,
    version: metadata.version,
    createdAt: metadata.createdAt,
    rotatedAt: metadata.rotatedAt ?? null,
    ageDays,
    intervalDays,
    nextDueAt: new Date(dueMs).toISOString(),
    daysUntilDue: wholeDays(dueMs - now.getTime()),
    state,
  };
}

export interface SecretsRotationReport {
  readonly generatedAt: string;
  readonly storeKind: string;
  readonly secrets: readonly SecretRotationStatus[];
  readonly counts: Readonly<Record<SecretRotationState, number>>;
  /** True when at least one ref is past 2x its interval — the non-zero exit. */
  readonly anyCritical: boolean;
}

/**
 * Walk `list()` and `metadata()` for every ref. Both are the SAFE-TO-LOG half
 * of the seam (02 §11.5); `get()` is never called here and must never be — a
 * status report that resolved values would put every credential in the store
 * into one process's memory to print a date.
 */
export async function buildRotationReport(
  store: {
    readonly kind: string;
    list(): Promise<SecretRef[]>;
    metadata(ref: SecretRef): Promise<SecretMetadata>;
  },
  now: Date = new Date(),
): Promise<SecretsRotationReport> {
  const refs = await store.list();
  const secrets: SecretRotationStatus[] = [];
  for (const ref of refs) {
    secrets.push(rotationStatusFor(ref, await store.metadata(ref), now));
  }
  secrets.sort((a, b) => a.ref.localeCompare(b.ref));
  const counts: Record<SecretRotationState, number> = { ok: 0, overdue: 0, critical: 0 };
  for (const s of secrets) counts[s.state] += 1;
  return {
    generatedAt: now.toISOString(),
    storeKind: store.kind,
    secrets,
    counts,
    anyCritical: counts.critical > 0,
  };
}
