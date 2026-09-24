// MCPForge — W0-N13: the default `/activity/consumers` data source.
//
// Same seam as `../fixtures.ts` (W0-J16): no live gateway
// `UsageRepository`/`AnomalyEventRepository` query and no wired API client
// exist in the portal yet, so these are injectable functions returning
// realistic fixtures, not a hardcoded render. Swapping them for real
// `usageRepository(...).getBucket()` / `anomalyEventRepository(...).list()`
// calls behind an HTTP or server-action boundary touches no component in
// this directory.
//
// The seven detector rows mirror `core/gateway/anomaly/config.ts`'s
// `DETECTOR_DEFAULTS` **by value, not by import** — see `types.ts`'s header:
// that module's runtime chain reaches `node:fs`, so this client-rendered
// fixture restates the seven compiled defaults as plain data instead of
// importing the module for its values. `detector-defaults.test.ts` pins
// these seven rows against the real `DETECTOR_DEFAULTS` object (a
// Node-side, non-client test file, so it MAY import the real module) so the
// two cannot silently drift.
//
// Consumer ids and audit-call ids below deliberately reuse `../fixtures.ts`'s
// own ids (`con_portal_agent`, `con_agent_client`, `call_a1f9e0`, …) so an
// anomaly event's evidence link genuinely resolves to a real Activity call
// detail row in this portal today.
import type {
  AnomalyEventRowView,
  ConsumerOption,
  ConsumerUsageOverview,
  ConsumerUsagePointView,
  DetectorRowView,
  QuotaMeterView,
} from './types';

// A FIXED anchor, not `Date.now()` — this page is `'use client'`, so this
// module evaluates once during SSR and again on hydration; a wall-clock
// value differs between those two moments and produces a real hydration
// mismatch on any timestamp rendered from it (same fix as `activity/
// fixtures.ts` and `requests/fixtures.ts`).
const NOW = new Date('2026-09-15T12:00:00.000Z').getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function iso(msAgo: number, from: number = NOW): string {
  return new Date(from - msAgo).toISOString();
}

/** `core/gateway/caps/consumer-limits.ts`'s `CONSUMER_LIMIT_NAMES`, restated (see header). */
interface DeclaredLimits {
  readonly callsPerMinute: number;
  readonly writesPerDay: number;
}

export const CONSUMER_OPTIONS: readonly ConsumerOption[] = [
  { consumerId: 'con_portal_agent', label: 'Portal — interactive agent session' },
  { consumerId: 'con_agent_client', label: 'Claude Desktop — finance workspace' },
];

const DECLARED_LIMITS: Readonly<Record<string, DeclaredLimits>> = {
  con_portal_agent: { callsPerMinute: 60, writesPerDay: 200 },
  con_agent_client: { callsPerMinute: 30, writesPerDay: 40 },
};

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
    describes: 'The first-ever write by this consumer to a write-capable tool — notable, not an alarm.',
    window: '24h',
    threshold: 1,
    severity: 'low',
    implemented: false,
  },
];

function usagePoints(consumerId: string, now: number = NOW): readonly ConsumerUsagePointView[] {
  // 24 hourly buckets — `ConsumerUsageGranularity: 'hour'`, matching the
  // `burst-write`/`identity-echo-mismatch` detectors' own `1h` window.
  const base = consumerId === 'con_portal_agent' ? 8 : 2;
  return Array.from({ length: 24 }, (_, i) => {
    const hoursAgo = 23 - i;
    const spike = consumerId === 'con_portal_agent' && hoursAgo === 2 ? 22 : 0;
    const calls = base + spike + (i % 5);
    const writes = Math.max(0, Math.floor(calls * 0.4));
    return {
      bucketStart: new Date(now - hoursAgo * HOUR).toISOString(),
      calls,
      writes,
      plansMinted: writes + (hoursAgo === 5 ? 1 : 0),
      plansNeverConfirmed: hoursAgo === 5 ? 1 : 0,
      p95LatencyMs: 220 + (i % 4) * 60,
      identityMismatches: consumerId === 'con_agent_client' && hoursAgo === 1 ? 3 : 0,
    };
  });
}

function meterState(percentUsed: number): QuotaMeterView['state'] {
  if (percentUsed >= 100) return 'exceeded';
  if (percentUsed >= 80) return 'warning';
  return 'ok';
}

function quotaMeters(consumerId: string, points: readonly ConsumerUsagePointView[]): readonly QuotaMeterView[] {
  const declared = DECLARED_LIMITS[consumerId] ?? { callsPerMinute: 60, writesPerDay: 200 };
  const lastHour = points[points.length - 1];
  const callsThisMinuteEstimate = lastHour ? Math.round(lastHour.calls / 6) : 0; // illustrative, not a real sliding window
  const writesToday = points.slice(-24).reduce((sum, p) => sum + p.writes, 0);

  const callsPct = Math.round((callsThisMinuteEstimate / declared.callsPerMinute) * 100);
  const writesPct = Math.round((writesToday / declared.writesPerDay) * 100);

  return [
    {
      name: 'callsPerMinute',
      label: 'Calls per minute',
      windowLabel: 'sliding 1-minute window',
      current: callsThisMinuteEstimate,
      limit: declared.callsPerMinute,
      percentUsed: callsPct,
      state: meterState(callsPct),
    },
    {
      name: 'writesPerDay',
      label: 'Writes per day',
      windowLabel: 'rolling 24h',
      current: writesToday,
      limit: declared.writesPerDay,
      percentUsed: writesPct,
      state: meterState(writesPct),
    },
  ];
}

/**
 * Raw anomaly-event fixtures, before being reduced into detector last-fire
 * state. `auditCallIds` reuse real `../fixtures.ts` call ids.
 */
interface RawEvent {
  readonly id: string;
  readonly ts: string;
  readonly consumerId: string;
  readonly detectorId: DetectorRowView['detectorId'];
  readonly severity: DetectorRowView['severity'];
  readonly window: DetectorRowView['window'];
  readonly observed: number;
  readonly threshold: number;
  readonly state: 'open' | 'acknowledged' | 'resolved';
  readonly auditCallIds: readonly string[];
}

function rawEvents(now: number = NOW): readonly RawEvent[] {
  return [
    {
      id: 'anom_burst_9f21',
      ts: iso(2 * HOUR, now),
      consumerId: 'con_portal_agent',
      detectorId: 'burst-write',
      severity: 'high',
      window: '1h',
      observed: 22,
      threshold: 5,
      state: 'open',
      auditCallIds: ['call_a1f9e0', 'call_ex4402'],
    },
    {
      id: 'anom_idmis_7a02',
      ts: iso(1 * HOUR, now),
      consumerId: 'con_agent_client',
      detectorId: 'identity-echo-mismatch',
      severity: 'high',
      window: '1h',
      observed: 3,
      threshold: 3,
      state: 'acknowledged',
      auditCallIds: ['call_dn5c17'],
    },
    {
      id: 'anom_scope_5c17',
      ts: iso(3 * DAY, now),
      consumerId: 'con_agent_client',
      detectorId: 'scope-probing',
      severity: 'high',
      window: '1h',
      observed: 12,
      threshold: 10,
      state: 'resolved',
      auditCallIds: ['call_dn5c17'],
    },
  ];
}

function detectorRows(consumerId: string, events: readonly RawEvent[]): readonly DetectorRowView[] {
  return DETECTOR_ROW_DEFAULTS.map((base) => {
    const matches = events
      .filter((e) => e.consumerId === consumerId && e.detectorId === base.detectorId)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));
    const last = matches[0];
    return {
      ...base,
      state: last ? last.state : 'no findings yet',
      lastFireTs: last ? last.ts : null,
    };
  });
}

function eventRows(consumerId: string, events: readonly RawEvent[]): readonly AnomalyEventRowView[] {
  return events
    .filter((e) => e.consumerId === consumerId)
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .map((e) => ({
      id: e.id,
      ts: e.ts,
      detectorId: e.detectorId,
      severity: e.severity,
      window: e.window,
      observed: e.observed,
      threshold: e.threshold,
      state: e.state,
      auditCallLinks: e.auditCallIds.map((callId) => ({
        callId,
        href: `/activity/calls/${callId}`,
      })),
    }));
}

/** One polled snapshot for one consumer. `now` is injectable so tests do not depend on wall time. */
export function loadConsumerUsageOverview(
  consumerId: string,
  // Fixed default, not `Date.now()` — `page.tsx` calls this from a
  // `useState` lazy initializer, which runs once during SSR and once more
  // on the client's first hydration render; a wall-clock default disagrees
  // between the two. Matches this module's own fixed `NOW` anchor above.
  now: number = NOW,
): ConsumerUsageOverview {
  const option = CONSUMER_OPTIONS.find((c) => c.consumerId === consumerId) ?? CONSUMER_OPTIONS[0]!;
  const points = usagePoints(option.consumerId, now);
  const events = rawEvents(now);
  return {
    consumerId: option.consumerId,
    label: option.label,
    generatedAt: new Date(now).toISOString(),
    granularity: 'hour',
    points,
    quotas: quotaMeters(option.consumerId, points),
    detectors: detectorRows(option.consumerId, events),
    events: eventRows(option.consumerId, events),
  };
}
