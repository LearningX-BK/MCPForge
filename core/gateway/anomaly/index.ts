// MCPForge — the detector substrate. W0-N8 + W0-N9, 02 §11.6.
//
// The INTERFACE, the runner, and the implemented Wave 0 detectors. W0-N9
// ships all three named in its `done:` criterion: `burst-write` (both the
// baseline-ratio half and the `writesPerDay`-ceiling half, as an OR),
// `scope-probing`, and `identity-echo-mismatch` (the usage-rollup schema was
// widened with a `consumer_usage_identity_mismatch` satellite to carry its
// signal). The remaining four patterns in 02 §11.6 stay
// declared-but-unimplemented in `./config.ts`'s `DETECTOR_DEFAULTS`, named as
// Wave 3 work rather than silently absent.

export {
  ANOMALY_WINDOWS,
  DETECTOR_IDS,
  WINDOW_GRANULARITY,
  freezeObservation,
  type AnomalyDetector,
  type AnomalyWindow,
  type DetectorFinding,
  type DetectorId,
  type DetectorObservation,
} from './types.js';
export {
  DETECTOR_DEFAULTS,
  isValidThreshold,
  loadAnomalyDetectorsOverlayFile,
  loadEffectiveDetectorConfig,
  parseAnomalyDetectorsOverlayFile,
  resolveEffectiveDetectorConfig,
  severityRank,
  type AnomalyConfigParseError,
  type AnomalyDetectorsOverlayFile,
  type EffectiveDetectorConfig,
} from './config.js';
export {
  DETECTOR_ACTOR_CONSUMER_ID,
  DETECTOR_ACTOR_PREFIX,
  runDetector,
  type AnomalyKillResult,
  type AnomalyRunnerDeps,
  type RunDetectorInput,
  type RunDetectorResult,
} from './runner.js';
export { burstWriteDetector } from './detectors/burst-write.js';
export { scopeProbingDetector, SCOPE_PROBING_ERROR_CODES } from './detectors/scope-probing.js';
export { identityEchoMismatchDetector } from './detectors/identity-echo-mismatch.js';
