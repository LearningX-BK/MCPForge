// MCPForge — detector 1 of 7: burst write activity. W0-N9, 02 §11.6 / 05 §2.3.2.
//
// "Writes per consumer per window above N× its trailing baseline, or above
// its declared `writesPerDay`." (02 §11.6 item 1 / 05 §2.3.2 item 1.)
//
// Both halves of that sentence are implemented, as an OR: the detector fires
// on whichever condition is met first.
//
//   1. BASELINE-RATIO half — `usage.writes` for the window under judgement
//      against the mean of `baseline[].writes`, using the resolved
//      `threshold` as the multiplier N.
//   2. WRITES-PER-DAY half — `usage.writes` against
//      `observation.writesPerDayCeiling` (W0-N9, `../types.ts`), the
//      consumer's EFFECTIVE `writesPerDay` ceiling
//      (`../../caps/consumer-limits.ts`), already resolved tighten-only by
//      the caller and stamped onto the observation by `../runner.ts` the same
//      way `threshold` is — never read from a live capability by the
//      detector itself (a detector holds no capability, only data; see
//      `../types.ts`'s file header).
//
// `observed` is reported as the RATIO for whichever clause fired — the
// baseline ratio for clause 1, or `usage.writes / writesPerDayCeiling` for
// clause 2 — so the event always carries "how far over" in the same units
// clause 1 already used, rather than switching to a raw count depending on
// which half tripped.
//
// A cold-start consumer (no trailing baseline) cannot be judged by clause 1
// (there is nothing to be a multiple OF), but clause 2 needs no history at
// all — a first-day consumer blowing through its declared ceiling is exactly
// what 02 §11.6's "or above `writesPerDay`" exists to catch on day one.

import type { AnomalyDetector, DetectorFinding, DetectorObservation } from '../types.js';

/** Mean `writes` across the trailing baseline buckets, or `null` with none. */
function baselineMeanWrites(baseline: DetectorObservation['baseline']): number | null {
  if (baseline.length === 0) return null;
  const total = baseline.reduce((sum, bucket) => sum + bucket.writes, 0);
  return total / baseline.length;
}

export const burstWriteDetector: AnomalyDetector = {
  id: 'burst-write',
  window: '1h',
  describes:
    'Writes per consumer per window above N× its trailing baseline, or above its declared writesPerDay ceiling.',
  evaluate(observation: DetectorObservation): DetectorFinding | null {
    const { usage, baseline, threshold, auditCallIds, writesPerDayCeiling } = observation;
    if (usage === null || usage.writes === 0) return null;

    const baselineMean = baselineMeanWrites(baseline);
    // No trailing history yet: clause 1 cannot judge a cold-start consumer,
    // but clause 2 still can (below) — this is not a reason to go silent.
    const ratio = baselineMean !== null && baselineMean > 0 ? usage.writes / baselineMean : null;
    const overBaseline = ratio !== null && ratio > threshold;

    // Clause 2: writesPerDayCeiling of 0 means "no ceiling configured" —
    // treated as never-tripping, the same as a threshold of 0 would make
    // every division degenerate rather than meaningful.
    const overCeiling = writesPerDayCeiling > 0 && usage.writes > writesPerDayCeiling;

    if (!overBaseline && !overCeiling) return null;

    // Whichever clause fired, `observed` is reported as a ratio. When both
    // fire, the baseline ratio is reported (it is what `threshold` — the
    // number this event's `threshold` column carries — was actually measured
    // against).
    const observed = overBaseline ? (ratio as number) : usage.writes / writesPerDayCeiling;

    return { observed, auditCallIds };
  },
};
