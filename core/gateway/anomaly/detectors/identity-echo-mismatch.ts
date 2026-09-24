// MCPForge — detector 5 of 7: identity-echo mismatch. W0-N9, 02 §11.6 / 05 §2.3.2.
//
// "`identity_match = false` occurrences per consumer." (02 §11.6 item 5.)
//
// Previously blocked: `identityMatch` is tracked per audit call
// (`../../store/audit/types.ts`) but was never rolled up into
// `ConsumerUsageBucket` — detectors only ever see usage buckets and their
// baseline, never raw call rows (by design; see `../types.ts`'s file header).
// That gap is closed by W0-N9's schema widening: `usage.identityMismatches`
// (`../../store/usage/types.ts`) is now a rollup column, backed by the
// `consumer_usage_identity_mismatch` satellite
// (`../../store/schema/spec.ts`), maintained the same same-transaction way
// every other `consumer_usage_*` column is (`../../store/usage/repository.ts`).
// No widening of `DetectorObservation` itself was needed for this signal —
// unlike `writesPerDayCeiling` (a consumer-level cap with no home in a usage
// bucket), the mismatch count belongs on the bucket right beside `writes` and
// `calls`, and now lives there.
//
// "Per consumer" is read the same two-condition way `scope-probing` reads
// "rising rate", for the same reason: a genuine escalation, not steady
// background noise that happens to clear an absolute floor.
//   1. the current window's `identityMismatches` exceeds the resolved
//      `threshold` (the absolute floor), AND
//   2. that count is strictly greater than the trailing baseline's mean
//      `identityMismatches` (the "rising" itself).
// A consumer with no baseline history is judged against a baseline of zero,
// so any qualifying count above threshold correctly fires on a cold start.

import type { AnomalyDetector, DetectorFinding, DetectorObservation } from '../types.js';
import type { ConsumerUsageBucket } from '../../store/usage/types.js';

function mismatchCount(bucket: ConsumerUsageBucket | null | undefined): number {
  return bucket?.identityMismatches ?? 0;
}

function baselineMeanMismatches(baseline: DetectorObservation['baseline']): number {
  if (baseline.length === 0) return 0;
  const total = baseline.reduce((sum, bucket) => sum + mismatchCount(bucket), 0);
  return total / baseline.length;
}

export const identityEchoMismatchDetector: AnomalyDetector = {
  id: 'identity-echo-mismatch',
  window: '1h',
  describes: 'A rising rate of identity_match = false occurrences from one consumer.',
  evaluate(observation: DetectorObservation): DetectorFinding | null {
    const { usage, baseline, threshold, auditCallIds } = observation;
    const current = mismatchCount(usage);
    if (current <= threshold) return null;

    const baselineMean = baselineMeanMismatches(baseline);
    if (current <= baselineMean) return null;

    return { observed: current, auditCallIds };
  },
};
