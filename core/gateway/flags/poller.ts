// MCPForge — the kill switch's hot-reload poll. W0-E5, 02 §4.7.
//
// `core/gateway/scope/types.ts` (W0-E2) already defines the READ contract:
//
//   export interface RuntimeFlagSource {
//     activeFlags(): readonly RuntimeFlag[];
//   }
//
// deliberately synchronous, because the six scope predicates
// (`../scope/predicates.ts`) are pure and synchronous and must stay that way
// — `resolveScope` cannot become an async function just because one of its
// six inputs now lives in a database. This module is the bridge: it polls
// `RuntimeStore.runtimeFlags` on an interval, and holds the last-read result
// in an in-process cache that `activeFlags()` reads with no I/O.
//
// That is the whole design, and it is also the whole limitation, stated
// honestly rather than glossed: a flag written by `forge kill` is not
// instantaneous everywhere, it is visible within one poll interval
// (`intervalMs`, default 5000 per 02 §4.7 and the W0-E5 `done:` criterion —
// "takes effect within the 5-second poll with no redeploy"). No caller
// waits on the poll; `refreshNow()` exists purely so a test — or an operator
// script that just ran `forge kill` and wants to prove it took effect
// without sleeping five seconds — can force one read deterministically.

import type { RuntimeFlagsRepository, StoredRuntimeFlag } from '../store/flags/types.js';
import type { RuntimeFlag, RuntimeFlagSource } from '../scope/types.js';

/** 02 §4.7 / the W0-E5 `done:` criterion, verbatim: five seconds. */
export const DEFAULT_KILL_SWITCH_POLL_MS = 5000;

function toRuntimeFlag(row: StoredRuntimeFlag): RuntimeFlag {
  return {
    scope: row.scope,
    target: row.target,
    reason: row.reason,
    until: row.until === null ? null : new Date(row.until),
  };
}

export interface PolledRuntimeFlagSource extends RuntimeFlagSource {
  /** Read the store once, synchronously updating what `activeFlags()` returns. */
  refreshNow(): Promise<readonly RuntimeFlag[]>;
  /** Begin polling on `intervalMs`. Idempotent — a second call is a no-op. */
  start(): void;
  /** Stop polling. Idempotent. Safe to call from a test's `afterEach`. */
  stop(): void;
  /** Whether the poll timer is currently running. */
  readonly polling: boolean;
}

export interface CreatePolledRuntimeFlagSourceOptions {
  readonly intervalMs?: number;
  /**
   * Called with every polling error so a caller can log it — a caller MUST NOT
   * be left silently stale. The cache is never cleared on a failed poll: a
   * store hiccup must never look like "every kill switch is lifted", which
   * would be fail-OPEN on the one predicate the whole product's central
   * security claim depends on (CLAUDE.md non-negotiable, `¬KillSwitched`).
   */
  readonly onError?: (error: unknown) => void;
}

/**
 * The real `RuntimeFlagSource`, backed by `RuntimeStore.runtimeFlags`. Built
 * to satisfy the EXACT interface `core/gateway/scope/sources.ts`'s
 * `inMemoryRuntimeFlags` placeholder satisfies, so `resolveScope` and every
 * caller of `ScopeContext.flags` needs no change at all — this is a drop-in
 * replacement, which is the point W0-E2 wrote into that file's own comment.
 */
export function createPolledRuntimeFlagSource(
  repository: RuntimeFlagsRepository,
  options: CreatePolledRuntimeFlagSourceOptions = {},
): PolledRuntimeFlagSource {
  const intervalMs = options.intervalMs ?? DEFAULT_KILL_SWITCH_POLL_MS;
  let cache: readonly RuntimeFlag[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refreshNow(): Promise<readonly RuntimeFlag[]> {
    try {
      const rows = await repository.listActive();
      cache = rows.map(toRuntimeFlag);
    } catch (error) {
      options.onError?.(error);
      // Fail closed on the CACHE, not on the predicate: the last-known-good
      // set of active flags is kept exactly as it was. A store outage must
      // never present as "nothing is kill-switched".
    }
    return cache;
  }

  return {
    activeFlags(): readonly RuntimeFlag[] {
      return cache;
    },
    refreshNow,
    start(): void {
      if (timer !== null) return;
      timer = setInterval(() => {
        void refreshNow();
      }, intervalMs);
      // Node-only guard: let the process exit even if the poller is still
      // running (relevant to short-lived CLI invocations that happen to spin
      // one up), without which a stray poller would hang `forge` itself.
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
