// MCPForge — the declarative detector interface. W0-N8, 02 §11.6.
//
// THE POINT OF THIS FILE, stated before anything else:
//
//   "A detector may observe and alert. It may **never** silently change an
//    authorization, a threshold or a scope. The single exception is that a
//    detector configured `severity: critical` may trip the **consumer kill
//    switch** — a visible, audited, human-reversible act carrying a reason
//    string, using §4.7's existing mechanism." — 02 §11.6
//
// That is enforced BY CONSTRUCTION here, not by convention downstream. A
// detector is a pure function of frozen data:
//
//   * Its only input is `DetectorObservation` — plain, deep-frozen values. It
//     holds no `RuntimeStore`, no repository, no connection, no `SecretStore`,
//     no consumer record, no scope set, no policy chain, no config object it
//     could write to. There is nothing in its hand to escalate WITH.
//   * Its only output is `DetectorFinding` — `observed` and the audit call ids
//     that evidence it. It carries **no severity, no threshold, no consumer
//     id, no action and no state**, so a detector cannot declare itself
//     critical, cannot restate the threshold it was measured against, and
//     cannot name a target to kill. Severity, threshold, window and consumer
//     are all stamped by `./runner.ts` from the RESOLVED CONFIG (`./config.ts`),
//     which the detector never sees in a mutable form.
//   * `evaluate` is synchronous and returns a value, not a promise: there is no
//     awaited seam for a detector to interleave work into, and no channel back
//     to the runner other than the finding itself.
//
// Adding a capability to a detector therefore requires editing THIS file, in a
// diff a reviewer reads — which is the property `anomaly.no-escalation.test.ts`
// exists to pin.

import type { ConsumerUsageBucket, ConsumerUsageGranularity } from '../store/usage/types.js';

/**
 * The seven anomaly patterns 02 §11.6 names, in its order. Closed: a detector
 * whose id is not in this list cannot be configured, which is what stops an
 * overlay from introducing a detector nobody reviewed.
 *
 * Wave 0 implements three of them (`W0-N9`): `burst-write`, `scope-probing`
 * and `identity-echo-mismatch`. The other four are DECLARED here and left
 * unimplemented on purpose — 02 §11.6's Wave 0 / Wave 3 split — so they are
 * named as outstanding work rather than silently absent.
 */
export const DETECTOR_IDS = [
  'burst-write',
  'off-hours-elevated-binding',
  'scope-probing',
  'subject-fan-out',
  'identity-echo-mismatch',
  'plan-abandonment',
  'first-write-to-tool',
] as const;
export type DetectorId = (typeof DETECTOR_IDS)[number];

/**
 * The closed observation-window set. A window token is what lands in
 * `anomaly_event.window`, and each maps to exactly one usage-rollup
 * granularity (`../store/usage/**`) so a detector's window and the bucket it
 * reads can never disagree.
 */
export const ANOMALY_WINDOWS = ['1h', '24h'] as const;
export type AnomalyWindow = (typeof ANOMALY_WINDOWS)[number];

export const WINDOW_GRANULARITY: Readonly<Record<AnomalyWindow, ConsumerUsageGranularity>> =
  Object.freeze({ '1h': 'hour', '24h': 'day' });

/**
 * The evidence a detector is given. Every field is data the gateway already
 * wrote — usage rollups (02 §11.6's own signal source) and the ids of the
 * audit rows in the window. Nothing here is a handle to anything.
 *
 * `threshold` is present so a detector can express "how far over" as its
 * `observed` value where that is the meaningful number (a ratio detector, say)
 * — it is a READ of the already-resolved effective threshold. Changing it is
 * impossible twice over: the object is deep-frozen, and the runner ignores
 * everything a detector returns except `observed` and `auditCallIds`.
 */
export interface DetectorObservation {
  readonly consumerId: string;
  readonly window: AnomalyWindow;
  /** ISO-8601 UTC start of the window being judged. */
  readonly windowStart: string;
  /** The rollup for the window under judgement, or `null` if the consumer was idle. */
  readonly usage: ConsumerUsageBucket | null;
  /** Earlier rollups of the same granularity, oldest first — the trailing baseline. */
  readonly baseline: readonly ConsumerUsageBucket[];
  /** The audit rows in this window, most recent last — the candidate evidence set. */
  readonly auditCallIds: readonly string[];
  /** The effective threshold, already resolved tighten-only by `./config.ts`. */
  readonly threshold: number;
  /**
   * W0-N9 — the consumer's effective `writesPerDay` ceiling
   * (`../caps/consumer-limits.ts`'s `resolveEffectiveConsumerLimits`), already
   * resolved tighten-only from the consumer's declared limit and any overlay,
   * exactly as `threshold` is already resolved from detector config before a
   * detector ever sees it. `burst-write`'s OR-clause ("above N× baseline OR
   * above `writesPerDay`") reads this rather than reaching for
   * `../caps/consumer-limits.ts` itself — a detector holds no capability, only
   * data (see the file header).
   */
  readonly writesPerDayCeiling: number;
}

/**
 * What a detector may say. Deliberately two fields.
 *
 * A detector that returns `null` is silent, which is the normal case and the
 * one `W0-N9`'s "stays silent on the legitimate near-miss" clause tests.
 */
export interface DetectorFinding {
  /** The measured value that crossed the threshold. Must be a finite number. */
  readonly observed: number;
  /**
   * The audit rows that triggered it — a subset of `observation.auditCallIds`.
   * The runner intersects rather than trusts: an id a detector invented is
   * dropped, because a foreign key into `audit_call` must reference a real row
   * and an alert pointing at fabricated evidence is worse than no alert.
   */
  readonly auditCallIds: readonly string[];
}

/**
 * A detector. Declarative: it declares its id and its window, and it computes.
 * It does not declare its own severity or threshold — those are configuration
 * (`./config.ts`), which is exactly why a detector cannot promote itself to
 * `critical` and reach the one sanctioned action.
 */
export interface AnomalyDetector {
  readonly id: DetectorId;
  readonly window: AnomalyWindow;
  /** One-line, human-readable, for the portal and the config docs. */
  readonly describes: string;
  evaluate(observation: DetectorObservation): DetectorFinding | null;
}

/**
 * Deep-freeze an observation before a detector sees it. In an ESM module
 * (always strict mode) an assignment to a frozen property THROWS rather than
 * failing silently, so a detector that tries to rewrite its own threshold
 * takes itself out rather than quietly succeeding.
 */
export function freezeObservation(observation: DetectorObservation): DetectorObservation {
  const seen = new WeakSet<object>();
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value as object)) return;
    seen.add(value as object);
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      walk((value as Record<string, unknown>)[key]);
    }
  };
  walk(observation);
  return observation;
}
