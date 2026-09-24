// MCPForge — detector configuration, and the one-directional merge with the
// compiled-in floors. W0-N8, 02 §11.6 + 02 §4.7's tighten-never-loosen shape.
//
// 02 §11.6: "each a declarative detector configured in the overlay with a
// tunable threshold and a compiled-in hard ceiling (the same tighten-never-
// loosen shape §4.7 already uses for caps)."
//
// This file is `../caps/overlay.ts` and `../caps/consumer-limits.ts` applied to
// detectors, with one twist worth naming: for a CAP, tightening means a
// SMALLER number, and for a DETECTOR THRESHOLD it also means a smaller number
// (fire sooner, on less), so the merge is the same `min`. Severity moves the
// other way — tightening means a HIGHER severity — so severity merges with
// `max` over the closed `ANOMALY_SEVERITIES` rank. Both directions are stated
// once, here, and `anomaly.config.test.ts` is the proof they hold.
//
//   effectiveThreshold = min(overlay ?? compiledDefault, compiledDefault, LOOSEST_THRESHOLD)
//   effectiveSeverity  = max(overlay ?? compiledDefault, compiledDefault)
//
// so an overlay can only ever make a detector MORE sensitive and its finding
// MORE severe. It cannot disable a detector, cannot raise a threshold, cannot
// downgrade a severity, and cannot introduce a detector id that is not in the
// closed `DETECTOR_IDS` list. Every one of those is a "silent degradation",
// which is the failure mode 02 §11.6's own last sentence forbids.

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ANOMALY_SEVERITIES, type AnomalySeverity } from '../store/anomaly/types.js';
import { ANOMALY_WINDOWS, DETECTOR_IDS, type AnomalyWindow, type DetectorId } from './types.js';

/** One detector's fully-resolved configuration — what `./runner.ts` stamps onto the event. */
export interface EffectiveDetectorConfig {
  readonly detectorId: DetectorId;
  readonly window: AnomalyWindow;
  readonly threshold: number;
  readonly severity: AnomalySeverity;
}

interface CompiledDetectorDefault {
  readonly window: AnomalyWindow;
  /** The shipped threshold. An overlay may go below it; nothing may go above it. */
  readonly threshold: number;
  /** The shipped severity. An overlay may go above it; nothing may go below it. */
  readonly severity: AnomalySeverity;
  /**
   * The compiled-in floor on sensitivity: the LOOSEST threshold this detector
   * may ever run at. It exists so that a future edit to `threshold` cannot
   * quietly loosen a detector past what code review signed off — the same job
   * `HARD_CEILINGS` does in `../caps/ceilings.ts`. It is always >= `threshold`.
   */
  readonly loosestThreshold: number;
}

/**
 * The compiled-in defaults for all SEVEN of 02 §11.6's patterns.
 *
 * The four Wave 3 patterns are configured here with no implementation behind
 * them (`W0-N9` ships three of the seven). That is deliberate: a declared,
 * unimplemented detector is visible in the config schema and in the portal as
 * outstanding work, where a silently absent one is not.
 *
 * `severity` is `medium`/`high` throughout and `critical` NOWHERE by default.
 * `critical` is the only severity that carries an action (the consumer kill
 * switch), and shipping a detector that automatically cuts a consumer off with
 * an untuned Wave-0 threshold and no real traffic to tune it against would be
 * the loud-failure equivalent of guessing. Raising a detector to `critical` is
 * a deliberate, per-deployment overlay act — a tightening, allowed by the merge
 * below, and one an operator makes knowingly.
 */
export const DETECTOR_DEFAULTS: Readonly<Record<DetectorId, CompiledDetectorDefault>> =
  Object.freeze({
    // 1. Writes per window above N× trailing baseline (or above `writesPerDay`).
    'burst-write': { window: '1h', threshold: 5, severity: 'high', loosestThreshold: 20 },
    // 2. A plsql/function write outside the consumer's operatingWindow.
    'off-hours-elevated-binding': {
      window: '1h',
      threshold: 1,
      severity: 'high',
      loosestThreshold: 10,
    },
    // 3. Rising TOOL_NOT_IN_SCOPE / CONSUMER_NOT_AUTHORIZED / ELEVATED_GRANT_REQUIRED rate.
    'scope-probing': { window: '1h', threshold: 10, severity: 'high', loosestThreshold: 50 },
    // 4. Unusual distinct `caller_subject` count under one consumer.
    'subject-fan-out': { window: '24h', threshold: 25, severity: 'medium', loosestThreshold: 200 },
    // 5. `identity_match = false` occurrences per consumer.
    'identity-echo-mismatch': {
      window: '1h',
      threshold: 3,
      severity: 'high',
      loosestThreshold: 25,
    },
    // 6. Plan:execute ratio per consumer.
    'plan-abandonment': { window: '24h', threshold: 5, severity: 'medium', loosestThreshold: 50 },
    // 7. First ever write by consumer C to write-capable tool T — a notable
    //    event, not an alarm (02 §11.6 says so in as many words).
    'first-write-to-tool': { window: '24h', threshold: 1, severity: 'low', loosestThreshold: 1 },
  });

/** Rank of a severity within the closed set. Higher is more severe. */
export function severityRank(severity: AnomalySeverity): number {
  return ANOMALY_SEVERITIES.indexOf(severity);
}

export function isValidThreshold(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * `overlays/<deployment>/anomaly-detectors.yaml` — VALUES ONLY, same file
 * shape as `../caps/overlay.ts`'s `caps.yaml`:
 *
 *   apiVersion: mcpforge/v1
 *   kind: AnomalyDetectors
 *   deployment: local
 *   detectors:
 *     burst-write:
 *       threshold: 3
 *       severity: critical
 *
 * Note what the schema has NO key for: `enabled`, `window`, `action`, `target`,
 * `consumerId`. Disabling a detector, retargeting it or changing what it does
 * are not overlay acts — they are code and governance acts. An overlay tunes
 * sensitivity, in the tightening direction, and nothing else.
 */
export interface AnomalyDetectorsOverlayFile {
  readonly apiVersion: 'mcpforge/v1';
  readonly kind: 'AnomalyDetectors';
  readonly deployment: string;
  readonly detectors: Readonly<
    Partial<
      Record<DetectorId, { readonly threshold?: number; readonly severity?: AnomalySeverity }>
    >
  >;
}

export interface AnomalyConfigParseError {
  readonly filePath: string;
  readonly message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const OVERLAY_KEYS = ['threshold', 'severity'] as const;

/** Parse and structurally validate one already-read `anomaly-detectors.yaml`. */
export function parseAnomalyDetectorsOverlayFile(
  filePath: string,
  text: string,
):
  | { readonly ok: true; doc: AnomalyDetectorsOverlayFile }
  | { readonly ok: false; error: AnomalyConfigParseError } {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    return { ok: false, error: { filePath, message: `invalid YAML: ${(err as Error).message}` } };
  }
  if (!isRecord(raw)) {
    return { ok: false, error: { filePath, message: 'must be a YAML mapping document' } };
  }
  if (raw['apiVersion'] !== 'mcpforge/v1') {
    return { ok: false, error: { filePath, message: 'apiVersion must be "mcpforge/v1"' } };
  }
  if (raw['kind'] !== 'AnomalyDetectors') {
    return { ok: false, error: { filePath, message: 'kind must be "AnomalyDetectors"' } };
  }
  if (typeof raw['deployment'] !== 'string' || raw['deployment'].length === 0) {
    return { ok: false, error: { filePath, message: 'deployment must be a non-empty string' } };
  }
  const detectorsRaw = raw['detectors'];
  if (detectorsRaw !== undefined && !isRecord(detectorsRaw)) {
    return {
      ok: false,
      error: { filePath, message: 'detectors must be a mapping of detector id -> overrides' },
    };
  }

  const detectors: Partial<Record<DetectorId, { threshold?: number; severity?: AnomalySeverity }>> =
    {};
  for (const [id, override] of Object.entries((detectorsRaw ?? {}) as Record<string, unknown>)) {
    if (!(DETECTOR_IDS as readonly string[]).includes(id)) {
      return {
        ok: false,
        error: {
          filePath,
          message: `detectors.${id} is not one of the seven declared detectors: ${DETECTOR_IDS.join(', ')}`,
        },
      };
    }
    if (!isRecord(override)) {
      return {
        ok: false,
        error: {
          filePath,
          message: `detectors.${id} must be a mapping of ${OVERLAY_KEYS.join('/')}`,
        },
      };
    }
    const parsed: { threshold?: number; severity?: AnomalySeverity } = {};
    for (const [key, value] of Object.entries(override)) {
      if (!(OVERLAY_KEYS as readonly string[]).includes(key)) {
        return {
          ok: false,
          error: {
            filePath,
            message: `detectors.${id}.${key} is not overlay-settable; only ${OVERLAY_KEYS.join(' and ')} are. A detector's window, its implementation and whether it runs at all are code, not deployment values.`,
          },
        };
      }
      if (key === 'threshold') {
        if (!isValidThreshold(value)) {
          return {
            ok: false,
            error: { filePath, message: `detectors.${id}.threshold must be a non-negative number` },
          };
        }
        parsed.threshold = value;
      } else {
        if (
          typeof value !== 'string' ||
          !(ANOMALY_SEVERITIES as readonly string[]).includes(value)
        ) {
          return {
            ok: false,
            error: {
              filePath,
              message: `detectors.${id}.severity must be one of: ${ANOMALY_SEVERITIES.join(', ')}`,
            },
          };
        }
        parsed.severity = value as AnomalySeverity;
      }
    }
    detectors[id as DetectorId] = parsed;
  }

  return {
    ok: true,
    doc: {
      apiVersion: 'mcpforge/v1',
      kind: 'AnomalyDetectors',
      deployment: raw['deployment'],
      detectors,
    },
  };
}

/** Load `overlays/<deployment>/anomaly-detectors.yaml`. `null` (not an error) when absent. */
export function loadAnomalyDetectorsOverlayFile(
  filePath: string,
):
  | { readonly ok: true; doc: AnomalyDetectorsOverlayFile | null }
  | { readonly ok: false; error: AnomalyConfigParseError } {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') return { ok: true, doc: null };
    return { ok: false, error: { filePath, message: (err as Error).message } };
  }
  return parseAnomalyDetectorsOverlayFile(filePath, text);
}

/**
 * THE merge, in one place. Tighten-only in both directions:
 * threshold by `min`, severity by `max`. An overlay value that would loosen
 * either is clamped rather than honoured — never an error, matching
 * `resolveEffectiveCaps`'s deliberate choice: an overlay author asking for
 * something the code does not allow should find it simply does not work.
 */
export function resolveEffectiveDetectorConfig(
  overlay: AnomalyDetectorsOverlayFile['detectors'] | null,
): Readonly<Record<DetectorId, EffectiveDetectorConfig>> {
  const out = {} as Record<DetectorId, EffectiveDetectorConfig>;
  for (const id of DETECTOR_IDS) {
    const compiled = DETECTOR_DEFAULTS[id];
    const override = overlay?.[id];

    const ceiling = Math.min(compiled.threshold, compiled.loosestThreshold);
    const threshold =
      override?.threshold === undefined ? ceiling : Math.min(override.threshold, ceiling);

    const severity =
      override?.severity !== undefined &&
      severityRank(override.severity) > severityRank(compiled.severity)
        ? override.severity
        : compiled.severity;

    out[id] = Object.freeze({
      detectorId: id,
      window: compiled.window,
      threshold,
      severity,
    });
  }
  return Object.freeze(out);
}

/** Convenience: load the overlay (if any) and resolve it in one call. */
export function loadEffectiveDetectorConfig(
  yamlPath: string,
):
  | { readonly ok: true; config: Readonly<Record<DetectorId, EffectiveDetectorConfig>> }
  | { readonly ok: false; error: AnomalyConfigParseError } {
  const loaded = loadAnomalyDetectorsOverlayFile(yamlPath);
  if (!loaded.ok) return loaded;
  return { ok: true, config: resolveEffectiveDetectorConfig(loaded.doc?.detectors ?? null) };
}

/**
 * Every compiled default must sit at or below its own loosest-permitted
 * threshold and name a window in the closed set. Checked at module load rather
 * than only in a test: a default that violates its own floor is a
 * silently-loosened detector, and the process should not start with one.
 */
for (const id of DETECTOR_IDS) {
  const d = DETECTOR_DEFAULTS[id];
  if (!isValidThreshold(d.threshold) || !isValidThreshold(d.loosestThreshold)) {
    throw new Error(`DETECTOR_DEFAULTS.${id} has a non-numeric threshold.`);
  }
  if (d.threshold > d.loosestThreshold) {
    throw new Error(
      `DETECTOR_DEFAULTS.${id}: shipped threshold ${d.threshold} is looser than its own compiled floor ${d.loosestThreshold}.`,
    );
  }
  if (!(ANOMALY_WINDOWS as readonly string[]).includes(d.window)) {
    throw new Error(`DETECTOR_DEFAULTS.${id}.window is not one of ${ANOMALY_WINDOWS.join(', ')}.`);
  }
}
