// MCPForge — the `anomaly_event` repository's types. W0-N8, 02 §11.6.
//
// 02 §11.6's schema line is the whole contract:
// `anomaly_event(id, ts, consumer_id, detector_id, severity, window, observed,
// threshold, audit_call_ids[], state)`.
//
// `auditCallIds` is an array HERE, in TypeScript, and a side table in the
// database (`schema/spec.ts`'s `ANOMALY_EVENT_AUDIT_CALL`) — 02 §10.4 item 2.
// The repository is the only place that knows about the two-table shape.

/**
 * The closed severity set. Ordered least → most severe: the ORDER is
 * load-bearing, because the overlay may only ever RAISE a detector's severity
 * (`../../anomaly/config.ts`), and "raise" is defined by this index.
 *
 * `critical` is the only severity that carries an action (02 §11.6: a
 * `severity: critical` detector may trip the consumer kill switch). Every
 * other severity observes and alerts and does nothing else.
 */
export const ANOMALY_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type AnomalySeverity = (typeof ANOMALY_SEVERITIES)[number];

/**
 * The closed state set. Wave 0 writes `open` and nothing else; the transitions
 * are the Wave 3 triage workflow's, and are declared here rather than invented
 * there so the Wave 3 product conforms to this schema (02 §11.6's own reason
 * for putting the schema in Wave 0).
 */
export const ANOMALY_EVENT_STATES = ['open', 'acknowledged', 'resolved'] as const;
export type AnomalyEventState = (typeof ANOMALY_EVENT_STATES)[number];

/** One persisted `anomaly_event`, with its evidence already joined. */
export interface AnomalyEvent {
  readonly id: string;
  /** ISO-8601 UTC. */
  readonly ts: string;
  readonly consumerId: string;
  readonly detectorId: string;
  readonly severity: AnomalySeverity;
  /** The detector's declared observation window token, e.g. `1h`. */
  readonly window: string;
  readonly observed: number;
  readonly threshold: number;
  /** The audit rows that triggered this event — 02 §11.6's "one click from its evidence". */
  readonly auditCallIds: readonly string[];
  readonly state: AnomalyEventState;
}

export interface RecordAnomalyEventInput {
  readonly consumerId: string;
  readonly detectorId: string;
  readonly severity: AnomalySeverity;
  readonly window: string;
  readonly observed: number;
  readonly threshold: number;
  readonly auditCallIds: readonly string[];
  /** Injectable clock, so tests do not depend on wall time. */
  readonly ts?: string;
  /** Defaults to `open`. Wave 0 never passes anything else. */
  readonly state?: AnomalyEventState;
}

export interface ListAnomalyEventsFilter {
  readonly consumerId?: string;
  readonly detectorId?: string;
  readonly state?: AnomalyEventState;
  readonly limit?: number;
}

/**
 * The `anomaly_event` repository.
 *
 * Note what is NOT here: no update to `severity`, `threshold`, `observed` or
 * `detector_id`, and no delete. The only mutation is `setState`, the triage
 * transition — an operator acknowledging or resolving an alert can never
 * rewrite what was observed. A detector reaches none of this at all: it is
 * handed data, never this interface (`../../anomaly/types.ts`).
 */
export interface AnomalyEventRepository {
  record(input: RecordAnomalyEventInput): Promise<AnomalyEvent>;
  get(id: string): Promise<AnomalyEvent | undefined>;
  /** Most recent first. */
  list(filter?: ListAnomalyEventsFilter): Promise<AnomalyEvent[]>;
  /** The events referencing one audit row — the evidence link, read backwards. */
  listByAuditCall(callId: string): Promise<AnomalyEvent[]>;
  /** The one sanctioned mutation: the Wave 3 triage transition. */
  setState(id: string, state: AnomalyEventState): Promise<AnomalyEvent | undefined>;
}
