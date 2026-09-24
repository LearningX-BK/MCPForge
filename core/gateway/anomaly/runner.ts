// MCPForge — the anomaly runner. W0-N8, 02 §11.6.
//
// The runner is the ONLY thing in the product that turns a detector's finding
// into an effect. Detectors compute; this file decides, records and (in the
// single sanctioned case) acts. Keeping the decision here rather than in the
// detectors is the whole security argument of the substrate:
//
//   * The event's `severity`, `threshold`, `window`, `consumer_id` and `state`
//     are stamped from the RESOLVED CONFIG and the observation, never from
//     anything the detector returned. Even if a detector returns an object
//     carrying `severity: 'critical'`, `threshold: 0` or a consumer id, those
//     properties are never read — `finding.observed` and
//     `finding.auditCallIds` are the only two values taken, by name.
//   * `auditCallIds` are INTERSECTED with the observation's own candidate set,
//     so a detector cannot attach an alert to evidence it was not shown, and
//     cannot violate `anomaly_event_audit_call`'s foreign key into
//     `audit_call`.
//   * The kill switch is tripped only when the CONFIGURED severity is
//     `critical`, only at `consumer` granularity, only against the consumer
//     the observation was about, and always through `applyKill` — 02 §11.6's
//     "using §4.7's existing mechanism", the same function `forge kill` and
//     `forge secrets revoke` (W0-N6) call. There is no parallel mechanism here.
//
// HUMAN-REVERSIBLE, precisely. `applyKill` writes a `runtime_flags` row.
// `RuntimeFlagsRepository.clear(flagId)` soft-flips `active` to `false` and
// never deletes, so lifting a detector's kill is the same single act that
// lifts a human's, and the reason, the actor and the lift all remain readable
// afterwards. `AnomalyKillResult.flagId` is returned for exactly that purpose.

import { applyKill } from '../flags/kill.js';
import type { AuditRepository, RuntimeFlagsRepository } from '../store/index.js';
import type { AnomalyEvent, AnomalyEventRepository } from '../store/anomaly/types.js';
import type { EffectiveDetectorConfig } from './config.js';
import { freezeObservation, type AnomalyDetector, type DetectorObservation } from './types.js';

/** The actor-subject prefix for an automated kill. Never a human's subject. */
export const DETECTOR_ACTOR_PREFIX = 'anomaly-detector:';

/** The `consumer_id` written as the ACTOR on an automated kill's audit row. */
export const DETECTOR_ACTOR_CONSUMER_ID = 'forge-anomaly-runner';

export interface AnomalyRunnerDeps {
  readonly anomalies: AnomalyEventRepository;
  readonly flags: RuntimeFlagsRepository;
  readonly audit: AuditRepository;
}

export interface AnomalyKillResult {
  /** The `runtime_flags` row. Pass it to `RuntimeFlagsRepository.clear` to lift the kill. */
  readonly flagId: string;
  /** The kill's own audit row — same chain, same shape as a human's. */
  readonly auditCallId: string;
  readonly reason: string;
}

export interface RunDetectorResult {
  /** `null` when the detector was silent — the normal case. */
  readonly event: AnomalyEvent | null;
  /** Present only for a `critical` detector that fired. */
  readonly kill: AnomalyKillResult | null;
}

export interface RunDetectorInput {
  readonly detector: AnomalyDetector;
  /** Already resolved tighten-only — `./config.ts`'s `resolveEffectiveDetectorConfig`. */
  readonly config: EffectiveDetectorConfig;
  /**
   * The evidence, WITHOUT `threshold`, `window` or `writesPerDayCeiling` — the
   * runner supplies all three itself, from already-resolved inputs, so a
   * caller cannot hand a detector a value that bypassed a tighten-only merge.
   */
  readonly signal: Omit<DetectorObservation, 'threshold' | 'window' | 'writesPerDayCeiling'>;
  /**
   * W0-N9 — the consumer's EFFECTIVE `writesPerDay` ceiling, already resolved
   * by the caller via `../caps/consumer-limits.ts`'s
   * `resolveEffectiveConsumerLimits` (consumer's declared limit, tightened by
   * any overlay, tightened by the compiled hard ceiling) — the same shape
   * `config` already arrives in for `threshold`. The runner does not resolve
   * consumer limits itself (it holds no consumer record), but it is the only
   * thing that stamps the resolved value onto the observation, so a detector
   * can never be handed one a caller invented.
   */
  readonly writesPerDayCeiling: number;
  readonly deploymentId: string;
  readonly now?: Date;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Run one detector against one window and apply the sanctioned consequence.
 *
 * Throws only if the store does. A detector that throws is NOT caught here on
 * purpose: an exception from a detector is a bug the operator must see, and
 * swallowing it would turn a broken detector into a silently disabled one —
 * the exact "silent degradation" 02 §11.6 forbids. Callers scheduling several
 * detectors decide their own isolation policy explicitly.
 */
export async function runDetector(
  deps: AnomalyRunnerDeps,
  input: RunDetectorInput,
): Promise<RunDetectorResult> {
  const { detector, config } = input;
  if (detector.id !== config.detectorId) {
    throw new Error(
      `Detector "${detector.id}" was handed the configuration for "${config.detectorId}".`,
    );
  }
  if (detector.window !== config.window) {
    throw new Error(
      `Detector "${detector.id}" declares window ${detector.window} but its configuration says ${config.window}.`,
    );
  }

  const observation = freezeObservation({
    ...input.signal,
    window: config.window,
    threshold: config.threshold,
    writesPerDayCeiling: input.writesPerDayCeiling,
  });

  const finding = detector.evaluate(observation);
  if (finding === null || finding === undefined) {
    return { event: null, kill: null };
  }

  // Only these two values are read off the finding, by name. Anything else a
  // detector attached to the object — a severity, a threshold, a target — is
  // never looked at, which is what makes self-escalation structurally
  // unreachable rather than merely unattempted.
  const observed = finiteOrNull(finding.observed);
  if (observed === null) {
    throw new Error(
      `Detector "${detector.id}" returned a finding whose observed value is not a finite number.`,
    );
  }
  const candidates = new Set(observation.auditCallIds);
  const auditCallIds = [...new Set(finding.auditCallIds ?? [])].filter((id) => candidates.has(id));

  const now = input.now ?? new Date();
  const event = await deps.anomalies.record({
    consumerId: observation.consumerId,
    detectorId: config.detectorId,
    severity: config.severity,
    window: config.window,
    observed,
    threshold: config.threshold,
    auditCallIds,
    ts: now.toISOString(),
    state: 'open',
  });

  if (config.severity !== 'critical') {
    return { event, kill: null };
  }

  // THE single permitted action (02 §11.6). Loud, audited, reversible.
  const reason =
    `Automatic consumer kill switch: detector "${config.detectorId}" (severity critical) observed ` +
    `${observed} against threshold ${config.threshold} over window ${config.window} starting ` +
    `${observation.windowStart}. anomaly_event ${event.id} carries the ${auditCallIds.length} ` +
    `audit call(s) that evidence it. Lift with the kill switch's ordinary clear once reviewed.`;

  const killed = await applyKill(deps.flags, deps.audit, {
    raw: `consumer:${observation.consumerId}`,
    reason,
    actorSubject: `${DETECTOR_ACTOR_PREFIX}${config.detectorId}`,
    actorConsumerId: DETECTOR_ACTOR_CONSUMER_ID,
    humanInTheLoop: false,
    deploymentId: input.deploymentId,
    now,
    extraResultKeys: [
      { keyName: 'anomaly_event_id', keyValue: event.id },
      { keyName: 'anomaly_detector_id', keyValue: config.detectorId },
    ],
  });

  return {
    event,
    kill: { flagId: killed.flagId, auditCallId: killed.auditCallId, reason },
  };
}
