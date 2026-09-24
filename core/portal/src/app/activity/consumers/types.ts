// MCPForge — W0-N13: `/activity/consumers` view types (03 §16.3, 02 §11.6).
//
// Same discipline as `../types.ts`: where a field is rendered it mirrors a
// REAL type from the package that owns it, so a later live-wiring task
// changes a loader, never a component. Every gateway type below is imported
// with `import type` ONLY — never a runtime import — because `../anomaly`'s
// runtime module chain reaches `node:fs` (`config.ts`'s overlay loader) and a
// value import would pull that into this client-rendered tree exactly the
// way this session's own fixed bug class did (see CLAUDE.md-adjacent task
// note "Import discipline"). `import type` is erased at build, so the
// module is never resolved at runtime here.
import type {
  AnomalyEvent,
  AnomalyEventState,
  AnomalySeverity,
  ConsumerUsageBucket,
  ConsumerUsageGranularity,
} from '@mcpforge/gateway/store';
import type { AnomalyWindow, DetectorId } from '@mcpforge/gateway/anomaly';

export type { AnomalyEventState, AnomalySeverity, ConsumerUsageGranularity, AnomalyWindow, DetectorId };

/** One usage-rollup bucket as the "usage over time" panel renders it — mirrors `ConsumerUsageBucket`. */
export interface ConsumerUsagePointView {
  readonly bucketStart: string;
  readonly calls: number;
  readonly writes: number;
  readonly plansMinted: number;
  readonly plansNeverConfirmed: number;
  readonly p95LatencyMs: number | null;
  readonly identityMismatches: number;
}

export type QuotaMeterState = 'ok' | 'warning' | 'exceeded';

/**
 * Quota headroom against a declared consumer limit — 02 §11.6's two
 * actually-enforced limits, `callsPerMinute` and `writesPerDay`
 * (`../../../../gateway/caps/consumer-limits.ts`'s `CONSUMER_LIMIT_NAMES`;
 * `concurrentSessions` and `operatingWindow` are declared on the record but
 * not rollup-enforced, per that file's own header, so they are not meters
 * here).
 */
export interface QuotaMeterView {
  readonly name: 'callsPerMinute' | 'writesPerDay';
  readonly label: string;
  readonly windowLabel: string;
  readonly current: number;
  readonly limit: number;
  readonly percentUsed: number;
  readonly state: QuotaMeterState;
}

/** One row of the detector table — state, threshold and last fire, per the `done:` criterion. */
export interface DetectorRowView {
  readonly detectorId: DetectorId;
  readonly describes: string;
  readonly window: AnomalyWindow;
  readonly threshold: number;
  readonly severity: AnomalySeverity;
  /** `false` for the four Wave-3 patterns declared but not yet implemented (W0-N9's own scope line). */
  readonly implemented: boolean;
  /** `'no findings yet'` when nothing has ever fired for this consumer+detector. */
  readonly state: AnomalyEventState | 'no findings yet';
  readonly lastFireTs: string | null;
}

/** One `anomaly_event` row, evidence links resolved to their audit-call hrefs. */
export interface AnomalyEventRowView {
  readonly id: string;
  readonly ts: string;
  readonly detectorId: DetectorId;
  readonly severity: AnomalySeverity;
  readonly window: AnomalyWindow;
  readonly observed: number;
  readonly threshold: number;
  readonly state: AnomalyEventState;
  readonly auditCallLinks: readonly { readonly callId: string; readonly href: string }[];
}

/** The full per-consumer overview this page renders — one polled snapshot. */
export interface ConsumerUsageOverview {
  readonly consumerId: string;
  readonly label: string;
  /** When this snapshot was produced — the staleness marker's basis (03 §11.4). */
  readonly generatedAt: string;
  readonly granularity: ConsumerUsageGranularity;
  readonly points: readonly ConsumerUsagePointView[];
  readonly quotas: readonly QuotaMeterView[];
  readonly detectors: readonly DetectorRowView[];
  readonly events: readonly AnomalyEventRowView[];
}

export interface ConsumerOption {
  readonly consumerId: string;
  readonly label: string;
}

/** Re-exported so components can render an `AnomalyEvent`-shaped fixture directly if needed. */
export type { AnomalyEvent, ConsumerUsageBucket };
