// MCPForge — the real per-tool / per-caller rate limiter. W0-E6.
//
// In-memory sliding window, Wave-0-appropriate: CLAUDE.md §3.1 — "the gateway
// runs as ONE instance at Wave 0 — multi-replica is a Postgres-era property" —
// so no cross-process coordination is needed here, and none is built.
//
// Keyed by `Principal.subject` for the per-caller limit, never by display
// name or email (non-negotiable: "Principal.subject is the only identity
// value written to audit, mappings and idempotency keys" — a rate-limit key
// is exactly that kind of identity-keyed state, so the same rule applies).

import type { CapValues } from './ceilings.js';

const WINDOW_MS = 60_000;

/** One sliding window counter for one key. `count` and `record` are separate so a caller can peek both windows before committing either hit. */
class SlidingWindow {
  private timestamps: number[] = [];

  count(now: number): number {
    this.evict(now);
    return this.timestamps.length;
  }

  record(now: number): void {
    this.timestamps.push(now);
  }

  private evict(now: number): void {
    const cutoff = now - WINDOW_MS;
    while (this.timestamps.length > 0 && this.timestamps[0]! <= cutoff) {
      this.timestamps.shift();
    }
  }
}

export interface RateLimitCheckInput {
  readonly toolId: string;
  /** `Principal.subject` — never a display name or email. */
  readonly callerSubject: string;
}

export type RateLimitVerdict =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/**
 * Real, stateful rate limiter over the two overlay-settable rate caps. One
 * instance is meant to live for the process lifetime of a single gateway
 * instance (Wave 0: exactly one).
 */
export class CapsRateLimiter {
  private readonly perTool = new Map<string, SlidingWindow>();
  private readonly perCaller = new Map<string, SlidingWindow>();

  constructor(private readonly caps: CapValues) {}

  check(input: RateLimitCheckInput, now: number = Date.now()): RateLimitVerdict {
    const toolWindow = this.windowFor(this.perTool, input.toolId);
    const toolLimit = this.caps.perToolRateLimitPerMinute;
    const callerWindow = this.windowFor(this.perCaller, input.callerSubject);
    const callerLimit = this.caps.perCallerRateLimitPerMinute;

    // Peek both windows before committing either hit — a call refused on the
    // caller limit must not silently consume a slot of the tool's own limit,
    // and vice versa.
    if (toolWindow.count(now) >= toolLimit) {
      return {
        allowed: false,
        reason: `Tool ${input.toolId} exceeded its per-tool rate limit of ${toolLimit} calls/minute.`,
      };
    }
    if (callerWindow.count(now) >= callerLimit) {
      return {
        allowed: false,
        reason: `Caller ${input.callerSubject} exceeded its per-caller rate limit of ${callerLimit} calls/minute across all tools.`,
      };
    }

    toolWindow.record(now);
    callerWindow.record(now);
    return { allowed: true };
  }

  private windowFor(map: Map<string, SlidingWindow>, key: string): SlidingWindow {
    let w = map.get(key);
    if (w === undefined) {
      w = new SlidingWindow();
      map.set(key, w);
    }
    return w;
  }
}
