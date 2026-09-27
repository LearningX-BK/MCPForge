// MCPForge — W0-N13 / W0-P3b: the pure reducers behind `/activity/consumers`.
//
// Shared by the fixtures (component tests) and the live page (`live.ts`), so
// the detector table, the event list and the quota meters are computed the
// same way whatever feeds them, and no page imports a fixture.
//
// The seven detector rows mirror `core/gateway/anomaly/config.ts`'s
// `DETECTOR_DEFAULTS` BY VALUE, not by import: that module's runtime chain
// reaches `node:fs`, and this tree is client-rendered. `detector-defaults.test.ts`
// pins these rows to the real object so the two cannot drift.

import type {
  AnomalyEventRowView,
  AnomalyEventState,
  DetectorRowView,
  QuotaMeterView,
} from './types';

/**
 * `DETECTOR_DEFAULTS`, restated as data — see the file header. Exported so
 * `detector-defaults.test.ts` (a Node-environment, non-client test file) can
 * pin these seven rows against the real `DETECTOR_DEFAULTS` object and catch
 * drift.
 */
export const DETECTOR_ROW_DEFAULTS: readonly Omit<DetectorRowView, 'state' | 'lastFireTs'>[] = [
  {
    detectorId: 'burst-write',
    describes:
      'Writes per consumer per window above N× its trailing baseline, or above its declared writesPerDay ceiling.',
    window: '1h',
    threshold: 5,
    severity: 'high',
    implemented: true,
  },
  {
    detectorId: 'off-hours-elevated-binding',
    describes: 'A plsql/function write outside the consumer’s declared operatingWindow.',
    window: '1h',
    threshold: 1,
    severity: 'high',
    implemented: false,
  },
  {
    detectorId: 'scope-probing',
    describes:
      'A rising rate of TOOL_NOT_IN_SCOPE / CONSUMER_NOT_AUTHORIZED / ELEVATED_GRANT_REQUIRED refusals from one consumer.',
    window: '1h',
    threshold: 10,
    severity: 'high',
    implemented: true,
  },
  {
    detectorId: 'subject-fan-out',
    describes: 'An unusual distinct caller_subject count acting under one consumer.',
    window: '24h',
    threshold: 25,
    severity: 'medium',
    implemented: false,
  },
  {
    detectorId: 'identity-echo-mismatch',
    describes: 'A rising rate of identity_match = false occurrences from one consumer.',
    window: '1h',
    threshold: 3,
    severity: 'high',
    implemented: true,
  },
  {
    detectorId: 'plan-abandonment',
    describes: 'An elevated plan:execute ratio per consumer.',
    window: '24h',
    threshold: 5,
    severity: 'medium',
    implemented: false,
  },
  {
    detectorId: 'first-write-to-tool',
    describes:
      'The first-ever write by this consumer to a write-capable tool — notable, not an alarm.',
    window: '24h',
    threshold: 1,
    severity: 'low',
    implemented: false,
  },
];

export function meterState(percentUsed: number): QuotaMeterView['state'] {
  if (percentUsed >= 100) return 'exceeded';
  if (percentUsed >= 80) return 'warning';
  return 'ok';
}

/** One anomaly event, as either source supplies it. */
export interface OverviewEvent {
  readonly id: string;
  readonly ts: string;
  readonly detectorId: string;
  readonly severity: string;
  readonly window: string;
  readonly observed: number;
  readonly threshold: number;
  readonly state: string;
  readonly auditCallIds: readonly string[];
}

/** Each detector with its latest event's state, or "no findings yet". */
export function detectorRowsFor(events: readonly OverviewEvent[]): readonly DetectorRowView[] {
  return DETECTOR_ROW_DEFAULTS.map((base) => {
    const last = [...events]
      .filter((e) => e.detectorId === base.detectorId)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1))[0];
    return {
      ...base,
      state: last ? (last.state as AnomalyEventState) : 'no findings yet',
      lastFireTs: last ? last.ts : null,
    };
  });
}

/** Newest first, each evidence id linked to its call detail. */
export function eventRowsFor(events: readonly OverviewEvent[]): readonly AnomalyEventRowView[] {
  return [...events]
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .map((e) => ({
      id: e.id,
      ts: e.ts,
      detectorId: e.detectorId as AnomalyEventRowView['detectorId'],
      severity: e.severity as AnomalyEventRowView['severity'],
      window: e.window as AnomalyEventRowView['window'],
      observed: e.observed,
      threshold: e.threshold,
      state: e.state as AnomalyEventState,
      auditCallLinks: e.auditCallIds.map((callId) => ({
        callId,
        href: `/activity/calls/${encodeURIComponent(callId)}`,
      })),
    }));
}

export function quotaMeter(
  name: QuotaMeterView['name'],
  label: string,
  windowLabel: string,
  current: number,
  limit: number,
): QuotaMeterView {
  const percentUsed = limit > 0 ? Math.round((current / limit) * 100) : current > 0 ? 100 : 0;
  return { name, label, windowLabel, current, limit, percentUsed, state: meterState(percentUsed) };
}
