// MCPForge — barrel + the composed `RateLimiter` that plugs into the policy
// chain's stage 6c seam. W0-E6, 02 §4.7.
//
// THE EXACT SEAM THIS PLUGS INTO (core/gateway/policy/types.ts, W0-E3):
//
//   /** 6c — caps and concurrency. SEAM: W0-E6 (`core/gateway/caps/**`). */
//   export interface RateLimiter {
//     check(
//       call: PolicyCall,
//       ctx: PolicyContext,
//     ): { readonly allowed: true } | { readonly allowed: false; readonly reason: string };
//   }
//
// `CapsRuntime` implements exactly that interface, so a composition root
// (outside this task's touches) wires it in as
// `ctx.runtime.rateLimiter = new CapsRuntime(effectiveCaps)` and stage 6c
// (core/gateway/policy/stages.ts) needs no change at all — it already calls
// `ctx.runtime.rateLimiter.check(call, ctx)` and maps a `{allowed:false}`
// verdict onto `RATE_LIMITED` with a `next` naming the consumer owner.
//
// `check()` does FOUR real things per call, in this order, admitting only if
// all four pass: per-tool rate, per-caller rate (keyed by
// `ctx.scope.session.principal.subject` — Principal.subject, never a display
// name or email), per-binding concurrency (keyed by the tool's
// `bindingRef`), and global concurrency. A concurrency admission taken here
// MUST be released once the call finishes — see ./concurrency.ts's header for
// the documented gap: nothing downstream of stage 6c yet calls
// `CapsRuntime.release()`, because the binding-execution dispatcher that
// would call it does not exist yet at Wave 0 (`generated/tools` is empty).

import type { PolicyCall, PolicyContext, RateLimiter } from '../policy/index.js';
import { GLOBAL_CONCURRENCY_KEY, ConcurrencyLimiter } from './concurrency.js';
import { CapsRateLimiter } from './rate-limiter.js';
import type { CapValues } from './ceilings.js';

export * from './ceilings.js';
export * from './overlay.js';
export * from './rate-limiter.js';
export * from './concurrency.js';
export * from './row-cap.js';
export * from './response-byte-cap.js';
// W0-N7 — consumer-level quota enforcement, 02 §11.6.
export * from './consumer-limits.js';
export * from './consumer-quota.js';

/**
 * The composed runtime: rate limits + concurrency, satisfying the policy
 * chain's `RateLimiter` seam. One instance per gateway process (Wave 0: one
 * gateway instance, so one `CapsRuntime`).
 */
export class CapsRuntime implements RateLimiter {
  private readonly rate: CapsRateLimiter;
  private readonly perBinding: ConcurrencyLimiter;
  private readonly global: ConcurrencyLimiter;

  constructor(readonly caps: CapValues) {
    this.rate = new CapsRateLimiter(caps);
    this.perBinding = new ConcurrencyLimiter(caps.perBindingConcurrency, 'binding');
    this.global = new ConcurrencyLimiter(caps.globalConcurrency, 'gateway');
  }

  check(
    call: PolicyCall,
    ctx: PolicyContext,
  ): { readonly allowed: true } | { readonly allowed: false; readonly reason: string } {
    const callerSubject = ctx.scope.session.principal.subject;

    const rateVerdict = this.rate.check({ toolId: call.toolId, callerSubject });
    if (!rateVerdict.allowed) return rateVerdict;

    const entry = ctx.catalogue.find((e) => e.toolId === call.toolId);
    const bindingKey = entry?.bindingRef ?? call.toolId;

    const globalVerdict = this.global.tryAcquire(GLOBAL_CONCURRENCY_KEY);
    if (!globalVerdict.allowed) return globalVerdict;

    const bindingVerdict = this.perBinding.tryAcquire(bindingKey);
    if (!bindingVerdict.allowed) {
      // Undo the global slot this call would otherwise leak — a refusal must
      // not silently consume a global concurrency slot forever.
      this.global.release(GLOBAL_CONCURRENCY_KEY);
      return bindingVerdict;
    }

    return { allowed: true };
  }

  /**
   * Release the concurrency slots `check()` admitted for one call. MUST be
   * called exactly once per admitted call, after it finishes (success or
   * failure) — see this module's header for the documented gap: nothing in
   * Wave 0's policy chain or handler pipeline calls this yet, because the
   * binding-execution dispatcher that would call it does not exist.
   */
  release(call: { readonly toolId: string }, ctx: PolicyContext): void {
    const entry = ctx.catalogue.find((e) => e.toolId === call.toolId);
    const bindingKey = entry?.bindingRef ?? call.toolId;
    this.perBinding.release(bindingKey);
    this.global.release(GLOBAL_CONCURRENCY_KEY);
  }
}
