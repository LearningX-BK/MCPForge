// MCPForge — real per-binding and global concurrency limits. W0-E6, 02 §4.7.
//
// In-memory counters, Wave-0-appropriate (CLAUDE.md §3.1: single gateway
// instance, no cross-process coordination needed). A counting semaphore per
// key (`bindingRef` for per-binding, a single fixed key for global), with a
// synchronous, non-blocking `tryAcquire`/`release` pair — admission control,
// not a queue: a call that cannot get a slot is refused immediately with
// `RATE_LIMITED` (02 §4.7 groups concurrency under stage 6c "rate limit /
// concurrency"), never held waiting.
//
// SEAM NOTE (CLAUDE.md §8 — flagged, not guessed): `PolicyRuntime.rateLimiter`
// (core/gateway/policy/types.ts, W0-E3) exposes exactly one synchronous
// `check()` call with no matching "call finished" signal, so stage 6c alone
// cannot RELEASE a concurrency slot when the call completes — only admit one.
// `ConcurrencyLimiter.release()` is real and tested here, but wiring
// `release()` to actually fire when a tool call finishes is the job of
// whatever executes the binding after stage 6c admits the call (the
// dispatcher around `generated/tools/<id>/handler.generated.ts`), which does
// not exist yet (`generated/tools` is empty at Wave 0 — see handler.ts's own
// header). `./index.ts`'s `CapsRuntime.rateLimiter` acquires a slot inside
// `check()` for both concurrency keys and is only safe to use once its owner
// calls `CapsRuntime.release(call)` after the call finishes (success OR
// failure) — this is documented on `CapsRuntime` itself and asserted by
// `concurrency.test.ts`'s "leaked slot" case.

export type ConcurrencyVerdict =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/** A counting semaphore keyed by an arbitrary string, with a fixed limit per key. */
export class ConcurrencyLimiter {
  private readonly inFlight = new Map<string, number>();

  constructor(
    private readonly limit: number,
    private readonly label: string,
  ) {}

  tryAcquire(key: string): ConcurrencyVerdict {
    const current = this.inFlight.get(key) ?? 0;
    if (current >= this.limit) {
      return {
        allowed: false,
        reason: `${this.label} ${key} is at its concurrency limit of ${this.limit} in-flight calls.`,
      };
    }
    this.inFlight.set(key, current + 1);
    return { allowed: true };
  }

  /** Release exactly one previously-acquired slot for `key`. A release with no matching acquire is a no-op floored at zero, never negative. */
  release(key: string): void {
    const current = this.inFlight.get(key) ?? 0;
    if (current <= 1) {
      this.inFlight.delete(key);
      return;
    }
    this.inFlight.set(key, current - 1);
  }

  currentInFlight(key: string): number {
    return this.inFlight.get(key) ?? 0;
  }
}

/** The fixed key `ConcurrencyLimiter` uses for the single global counter. */
export const GLOBAL_CONCURRENCY_KEY = '__global__';
