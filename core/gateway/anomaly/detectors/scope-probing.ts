// MCPForge — detector 3 of 7: scope probing. W0-N9, 02 §11.6 / 05 §2.3.2.
//
// "A rising rate of `TOOL_NOT_IN_SCOPE` / `CONSUMER_NOT_AUTHORIZED` /
// `ELEVATED_GRANT_REQUIRED` refusals from one consumer. A well-behaved client
// only calls what `tools/list` handed it, so this rate should sit at
// approximately zero; a rise means either a broken client or an agent trying
// doors." (05 §2.3.2 item 3.)
//
// Fully answerable from `DetectorObservation` as it stands: `usage.refusals`
// (`../../store/usage/types.ts`, W0-N7) is "refusals by error code" per the
// bucket, present for exactly this purpose — no gap here.
//
// "Rising rate" is read as two conditions together, both needed so the
// detector reports genuine escalation rather than steady background noise
// that happens to clear an absolute count:
//   1. the current window's count of the three scope-refusal codes exceeds
//      the resolved `threshold` (the absolute floor below which a handful of
//      refusals is not worth an event at all), AND
//   2. that count is strictly greater than the trailing baseline's mean count
//      of the same three codes (the "rising" itself — a consumer that always
//      refuses at this rate is not currently escalating).
// A consumer with no baseline history (cold start) is judged against a
// baseline of zero, so any qualifying count above threshold correctly fires —
// there is no history for it to have "always looked like this" against.

import type { AnomalyDetector, DetectorFinding, DetectorObservation } from '../types.js';
import type { ConsumerUsageBucket } from '../../store/usage/types.js';

/** The three refusal codes 02 §11.6 / 05 §2.3.2 name for this pattern. */
export const SCOPE_PROBING_ERROR_CODES = [
  'TOOL_NOT_IN_SCOPE',
  'CONSUMER_NOT_AUTHORIZED',
  'ELEVATED_GRANT_REQUIRED',
] as const;

function scopeRefusalCount(bucket: ConsumerUsageBucket | null | undefined): number {
  if (bucket === null || bucket === undefined) return 0;
  return bucket.refusals
    .filter((r) => (SCOPE_PROBING_ERROR_CODES as readonly string[]).includes(r.errorCode))
    .reduce((sum, r) => sum + r.count, 0);
}

function baselineMeanScopeRefusals(baseline: DetectorObservation['baseline']): number {
  if (baseline.length === 0) return 0;
  const total = baseline.reduce((sum, bucket) => sum + scopeRefusalCount(bucket), 0);
  return total / baseline.length;
}

export const scopeProbingDetector: AnomalyDetector = {
  id: 'scope-probing',
  window: '1h',
  describes:
    'A rising rate of TOOL_NOT_IN_SCOPE / CONSUMER_NOT_AUTHORIZED / ELEVATED_GRANT_REQUIRED refusals from one consumer.',
  evaluate(observation: DetectorObservation): DetectorFinding | null {
    const { usage, baseline, threshold, auditCallIds } = observation;
    const current = scopeRefusalCount(usage);
    if (current <= threshold) return null;

    const baselineMean = baselineMeanScopeRefusals(baseline);
    if (current <= baselineMean) return null;

    return { observed: current, auditCallIds };
  },
};
