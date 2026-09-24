// MCPForge — `@mcpforge/registry/rank` barrel. W0-G2, 02 §5.4.2, §5.4.3.

export { PASS_THROUGH_FLOOR, rankTools } from './pipeline.js';
export {
  DO_NOT_APPROXIMATE,
  NEAREST_LIMIT,
  NO_TOOL_NEXT,
  RAISE_THROUGH_INTAKE,
  chooseBlock,
  createScoreFloorPolicy,
  entityPrefix,
  evaluateFloor,
  isAboveFloor,
  noToolReason,
  sharesEntityPrefix,
  type FindVerdict,
  type FloorConfig,
  type NearestCapability,
  type NoToolVerdict,
  type ToolsVerdict,
} from './floor.js';
export { CALIBRATED_SCORE_FLOOR, CHOOSE_MARGIN, DEFAULT_FLOOR_CONFIG } from './floor.config.js';
export {
  calibrateFloor,
  selectFloor,
  sweepRange,
  type CalibrationOptions,
  type CalibrationResult,
  type FloorTrial,
  type LabelledIntent,
  type ScoreIntent,
} from './calibrate.js';
export {
  SYNTHETIC_DATASET_WARNING,
  buildCalibrationRecord,
  type CalibrationRecord,
} from './calibration.record.js';
export { applyHardFilters, matchesFilters } from './filter.js';
export { BM25_B, BM25_K1, scoreBm25 } from './bm25.js';
export { fuse, rankOrder } from './fusion.js';
export { WAVE0_SEMANTIC_CHANNEL, isSemanticChannelEnabled } from './semantic.js';
export {
  activeRoleBoost,
  applyBoosts,
  consumptionTiebreak,
  entityMatchBoost,
  queryVerbs,
  statusPenalty,
  totalScore,
  verbMatchBoost,
  type BoostInput,
} from './boosts.js';
export { namesStructuredValue, tokenSet, tokenize } from './tokenize.js';
export {
  ACTIVE_ROLE_BOOST,
  ADJACENT_RANK_GAP,
  CONSUMPTION_REFERENCE_COUNT,
  CONSUMPTION_TIEBREAK_CAP,
  DEFAULT_RANK_WEIGHTS,
  ENTITY_MATCH_BOOST,
  RESOLVED_STATUS,
  RRF_K,
  STATUS_PENALTY,
  VERB_MATCH_BOOST,
  resolveWeights,
} from './weights.js';
export type {
  ChannelScores,
  ConsumptionCounts,
  FloorPolicy,
  RankContext,
  RankFilters,
  RankQuery,
  RankWeights,
  RankedResult,
  ScoreBreakdown,
  SemanticChannel,
  SessionVisibility,
  ToolId,
} from './types.js';
