// MCPForge — W0-P3b: `/api/v1/consumers/usage` -> the Consumers view shapes.

import type { ConsumerUsage } from '@mcpforge/shared/api/v1';

import { detectorRowsFor, eventRowsFor, quotaMeter } from './overview';
import type { ConsumerUsageOverview } from './types';

export function toUsageOverview(
  usage: ConsumerUsage,
  label: string,
  generatedAt: string,
): ConsumerUsageOverview {
  const points = usage.buckets.map((b) => ({
    bucketStart: b.bucketStart,
    calls: b.calls,
    writes: b.writes,
    plansMinted: b.plansMinted,
    plansNeverConfirmed: b.plansNeverConfirmed,
    p95LatencyMs: b.p95LatencyMs,
    identityMismatches: b.identityMismatches,
  }));
  const lastHour = points[points.length - 1];
  const writesLast24h =
    usage.granularity === 'hour'
      ? points.reduce((sum, p) => sum + p.writes, 0)
      : (points[points.length - 1]?.writes ?? 0);
  return {
    consumerId: usage.consumerId,
    label,
    generatedAt,
    granularity: usage.granularity,
    points,
    quotas: [
      // The gateway exports hourly rollups, not its enforced sliding minute,
      // so this meter says what it actually measures: the last hour's mean.
      quotaMeter(
        'callsPerMinute',
        'Calls per minute',
        'mean over the last hour (the enforced 1-minute window is not exported)',
        usage.granularity === 'hour' && lastHour !== undefined
          ? Math.round(lastHour.calls / 60)
          : 0,
        usage.limits.callsPerMinute,
      ),
      quotaMeter(
        'writesPerDay',
        'Writes per day',
        usage.granularity === 'hour' ? 'rolling 24h' : 'today',
        writesLast24h,
        usage.limits.writesPerDay,
      ),
    ],
    detectors: detectorRowsFor(usage.events),
    events: eventRowsFor(usage.events),
  };
}
