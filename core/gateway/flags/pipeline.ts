// MCPForge — wiring the poll and the notification together. W0-E5.
//
// `./poller.ts` reads the store; `./notify.ts` calls `sendToolListChanged()`.
// Neither depends on the other, on purpose (each is independently testable),
// but the gateway process wants "poll, and if the set changed, notify" as one
// action running every `intervalMs`. That is all this file does.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RuntimeFlagsRepository } from '../store/flags/types.js';
import type { RuntimeFlag } from '../scope/types.js';
import {
  createPolledRuntimeFlagSource,
  DEFAULT_KILL_SWITCH_POLL_MS,
  type CreatePolledRuntimeFlagSourceOptions,
  type PolledRuntimeFlagSource,
} from './poller.js';
import { watchServerForKillSwitchChanges, type KillSwitchNotifyHandle } from './notify.js';

export interface KillSwitchPipeline extends PolledRuntimeFlagSource {
  readonly notifications: KillSwitchNotifyHandle;
}

export interface CreateKillSwitchPipelineOptions extends CreatePolledRuntimeFlagSourceOptions {
  readonly onNotify?: (flags: ReturnType<PolledRuntimeFlagSource['activeFlags']>) => void;
}

/**
 * The production wiring: poll `repository` on `intervalMs` (default 5000,
 * 02 §4.7), and on every poll where the active flag set changed, call
 * `server.sendToolListChanged()`. `start()` begins both; `stop()` stops both.
 *
 * `refreshNow()` — used directly by tests that need the effect without
 * waiting out a real interval — also drives the notification check, so a
 * test proving "the notification fires" and a test proving "the flag takes
 * effect" are the same call, which is the honest shape of the real pipeline.
 */
export function createKillSwitchPipeline(
  repository: RuntimeFlagsRepository,
  server: McpServer,
  options: CreateKillSwitchPipelineOptions = {},
): KillSwitchPipeline {
  const intervalMs = options.intervalMs ?? DEFAULT_KILL_SWITCH_POLL_MS;
  const source = createPolledRuntimeFlagSource(repository, options);
  const notifications = watchServerForKillSwitchChanges(source, server, {
    ...(options.onNotify ? { onNotify: options.onNotify } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
  });
  // The baseline is primed from whatever `activeFlags()` returns before the
  // first read — the empty set — so the FIRST `refreshNow()` that finds any
  // active flag correctly counts as a change worth notifying about.
  notifications.primeBaseline();

  async function tick(): Promise<readonly RuntimeFlag[]> {
    const flags = await source.refreshNow();
    await notifications.checkAndNotify();
    return flags;
  }

  // Deliberately NOT `source.start()`: that would run the poller's own
  // internal timer, which calls only `source.refreshNow()` and never checks
  // for a change — the notification would then never fire on a real
  // interval, only when a test calls `refreshNow()` directly. This module
  // owns its own timer so every tick is "poll, then notify if changed", the
  // single action 02 §4.7's pipeline actually needs.
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    activeFlags: source.activeFlags,
    notifications,
    refreshNow: tick,
    start(): void {
      if (timer !== null) return;
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop(): void {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
    get polling(): boolean {
      return timer !== null;
    },
  };
}

export { DEFAULT_KILL_SWITCH_POLL_MS };
