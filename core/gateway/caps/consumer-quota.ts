// MCPForge — consumer-level quota enforcement. W0-N7, 02 §11.6.
//
// Two of a consumer's declared `limits` (`core/gateway/consumer/types.js`) are
// enforced here — see `./consumer-limits.ts`'s header for why exactly these
// two and not `concurrentSessions` / `operatingWindow`:
//
//   - `callsPerMinute` — an in-memory sliding one-minute window, PER CONSUMER,
//     the same real-time mechanism `./rate-limiter.ts` already uses for the
//     per-tool and per-caller caps. A rollup read cannot answer "calls this
//     minute" cheaply enough to check on every call (a bucket is hourly/daily
//     by design, 02 §11.6), so this dimension is real-time state, not a
//     rollup read.
//   - `writesPerDay` — the DAILY usage-rollup bucket's own `writes` count
//     (`../store/usage/**`), which is exactly the "cheap, because it rolls up
//     data already being written" reuse 02 §11.6 describes. No second counter
//     is kept for this: the rollup this same task built is the source of
//     truth.
//
// **Not wired into the live policy chain here.** `./index.ts`'s `CapsRuntime`
// documents an identical, pre-existing gap for `release()` — "the
// binding-execution dispatcher that would call it does not exist yet at Wave
// 0" — and the same is true of composing this seam into policy stage 6c
// (`core/gateway/policy/**`, an OPUS_GUARDED_PATH this task does not touch).
// `consumer-quota.test.ts` proves the contract — the exact `RATE_LIMITED`
// shape, the window-and-reset `next` text, and the tighten-never-loosen
// ceiling — directly against this module, the same way `ceilings.test.ts` and
// `overlay.test.ts` prove `./ceilings.ts` and `./overlay.ts` without a live
// gateway call in the loop.

import type { ConsumerUsageGranularity } from '../store/usage/types.js';
import { bucketStartFor } from '../store/usage/repository.js';
import type { ConsumerLimitValues } from './consumer-limits.js';

const MINUTE_MS = 60_000;

/** One sliding one-minute window per consumer id. Mirrors `./rate-limiter.ts`'s `SlidingWindow`. */
class ConsumerMinuteWindow {
  private timestamps: number[] = [];

  count(now: number): number {
    const cutoff = now - MINUTE_MS;
    while (this.timestamps.length > 0 && this.timestamps[0]! <= cutoff) {
      this.timestamps.shift();
    }
    return this.timestamps.length;
  }

  record(now: number): void {
    this.timestamps.push(now);
  }
}

/**
 * Real, stateful per-consumer call-rate limiter. One instance is meant to
 * live for the process lifetime of a single gateway instance (Wave 0: exactly
 * one — 02 §10.4 item 6), matching `CapsRateLimiter`.
 */
export class ConsumerCallRateLimiter {
  private readonly windows = new Map<string, ConsumerMinuteWindow>();

  /** Calls this consumer has made in the current one-minute window, without recording a new one. */
  count(consumerId: string, now: number = Date.now()): number {
    return this.windowFor(consumerId).count(now);
  }

  record(consumerId: string, now: number = Date.now()): void {
    this.windowFor(consumerId).record(now);
  }

  private windowFor(consumerId: string): ConsumerMinuteWindow {
    let w = this.windows.get(consumerId);
    if (w === undefined) {
      w = new ConsumerMinuteWindow();
      this.windows.set(consumerId, w);
    }
    return w;
  }
}

/** The subset of `UsageRepository` this check needs — kept narrow so a test can supply a fake. */
export interface ConsumerQuotaUsageSource {
  getBucket(
    consumerId: string,
    granularity: ConsumerUsageGranularity,
    bucketStart: string,
  ): Promise<{ readonly writes: number } | undefined>;
}

export interface ConsumerQuotaCheckInput {
  readonly consumerId: string;
  readonly isWrite: boolean;
}

/**
 * Shaped exactly like the `RATE_LIMITED` refusal the policy chain already
 * builds (`core/gateway/policy/idempotency/gate.ts`, `stages.ts`'s stage 6c) —
 * `code`, `message`, `next` — so wiring this into the live chain later is a
 * direct assignment, not a translation.
 */
export type ConsumerQuotaVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: 'RATE_LIMITED';
      readonly message: string;
      readonly next: string;
    };

function nextMinuteBoundaryIso(now: number): string {
  return new Date(Math.ceil((now + 1) / MINUTE_MS) * MINUTE_MS).toISOString();
}

function nextDayBoundaryIso(dayBucketStart: string): string {
  return new Date(new Date(dayBucketStart).getTime() + 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Check ONE call against a consumer's already-resolved effective limits
 * (`resolveEffectiveConsumerLimits` — tighten-never-loosen already applied).
 * Does NOT record the call; call `rateLimiter.record(consumerId, now)`
 * yourself once the call is actually admitted, matching `CapsRateLimiter`'s
 * peek-then-commit contract (a call refused on one limit must not consume a
 * slot of the other).
 */
export async function checkConsumerQuota(
  input: ConsumerQuotaCheckInput,
  limits: ConsumerLimitValues,
  deps: {
    readonly usage: ConsumerQuotaUsageSource;
    readonly rateLimiter: ConsumerCallRateLimiter;
    /** Injectable clock, so tests do not depend on wall time. Defaults to now. */
    now?(): Date;
  },
): Promise<ConsumerQuotaVerdict> {
  const now = (deps.now?.() ?? new Date()).getTime();
  const nowIso = new Date(now).toISOString();

  const callCount = deps.rateLimiter.count(input.consumerId, now);
  if (callCount >= limits.callsPerMinute) {
    const resetAt = nextMinuteBoundaryIso(now);
    return {
      allowed: false,
      code: 'RATE_LIMITED',
      message: `Consumer ${input.consumerId} exceeded its declared limit of ${limits.callsPerMinute} calls/minute.`,
      next: `This is a per-minute window that resets at ${resetAt} (UTC); wait until then and call again, or ask the consumer owner to raise callsPerMinute on ${input.consumerId}'s registration.`,
    };
  }

  if (input.isWrite) {
    const dayStart = bucketStartFor('day', nowIso);
    const bucket = await deps.usage.getBucket(input.consumerId, 'day', dayStart);
    const writesSoFar = bucket?.writes ?? 0;
    if (writesSoFar >= limits.writesPerDay) {
      const resetAt = nextDayBoundaryIso(dayStart);
      return {
        allowed: false,
        code: 'RATE_LIMITED',
        message: `Consumer ${input.consumerId} exceeded its declared limit of ${limits.writesPerDay} writes/day.`,
        next: `This is a daily window (UTC) that resets at ${resetAt}; wait until then, or ask the consumer owner to raise writesPerDay on ${input.consumerId}'s registration.`,
      };
    }
  }

  return { allowed: true };
}
