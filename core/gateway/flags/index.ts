// MCPForge — the kill switch's public surface. W0-E5, 02 §4.7 as extended by
// 02 §11.2.

export {
  createPolledRuntimeFlagSource,
  DEFAULT_KILL_SWITCH_POLL_MS,
  type CreatePolledRuntimeFlagSourceOptions,
  type PolledRuntimeFlagSource,
} from './poller.js';
export {
  watchForKillSwitchChanges,
  watchServerForKillSwitchChanges,
  type KillSwitchNotifyHandle,
  type ToolListChangedNotifier,
  type WatchOptions,
} from './notify.js';
export { createKillSwitchPipeline, type KillSwitchPipeline } from './pipeline.js';
export { killSwitchRefusalError } from './checks.js';
export {
  applyKill,
  parseKillTarget,
  newKillCorrelationId,
  InvalidKillTargetError,
  KILL_TOOL_ID,
  type ApplyKillInput,
  type ApplyKillResult,
  type ParsedKillTarget,
} from './kill.js';
