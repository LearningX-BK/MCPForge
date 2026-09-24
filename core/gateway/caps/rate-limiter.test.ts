import { describe, expect, it } from 'vitest';
import { resolveEffectiveCaps } from './overlay.js';
import { CapsRateLimiter } from './rate-limiter.js';

describe('CapsRateLimiter', () => {
  it('allows calls under both the per-tool and per-caller limits', () => {
    const caps = resolveEffectiveCaps({
      perToolRateLimitPerMinute: 5,
      perCallerRateLimitPerMinute: 5,
    });
    const limiter = new CapsRateLimiter(caps);
    for (let i = 0; i < 5; i++) {
      expect(
        limiter.check({ toolId: 'jde.ap.voucher.create', callerSubject: 'alice' }).allowed,
      ).toBe(true);
    }
  });

  it('refuses the call that exceeds the per-tool limit, independent of caller', () => {
    const caps = resolveEffectiveCaps({
      perToolRateLimitPerMinute: 2,
      perCallerRateLimitPerMinute: 100,
    });
    const limiter = new CapsRateLimiter(caps);
    const now = Date.now();
    expect(limiter.check({ toolId: 't1', callerSubject: 'alice' }, now).allowed).toBe(true);
    expect(limiter.check({ toolId: 't1', callerSubject: 'bob' }, now).allowed).toBe(true);
    const third = limiter.check({ toolId: 't1', callerSubject: 'carol' }, now);
    expect(third.allowed).toBe(false);
    if (!third.allowed) expect(third.reason).toMatch(/per-tool/);
  });

  it('refuses the call that exceeds the per-caller limit, keyed by Principal.subject, independent of tool', () => {
    const caps = resolveEffectiveCaps({
      perToolRateLimitPerMinute: 100,
      perCallerRateLimitPerMinute: 2,
    });
    const limiter = new CapsRateLimiter(caps);
    const now = Date.now();
    expect(limiter.check({ toolId: 't1', callerSubject: 'alice' }, now).allowed).toBe(true);
    expect(limiter.check({ toolId: 't2', callerSubject: 'alice' }, now).allowed).toBe(true);
    const third = limiter.check({ toolId: 't3', callerSubject: 'alice' }, now);
    expect(third.allowed).toBe(false);
    if (!third.allowed) expect(third.reason).toMatch(/per-caller/);
    // a different caller is unaffected
    expect(limiter.check({ toolId: 't1', callerSubject: 'bob' }, now).allowed).toBe(true);
  });

  it('a call refused on the caller limit does not consume a slot of the tool limit (peek-then-commit)', () => {
    const caps = resolveEffectiveCaps({
      perToolRateLimitPerMinute: 100,
      perCallerRateLimitPerMinute: 1,
    });
    const limiter = new CapsRateLimiter(caps);
    const now = Date.now();
    limiter.check({ toolId: 't1', callerSubject: 'alice' }, now); // consumes alice's one caller slot
    limiter.check({ toolId: 't1', callerSubject: 'alice' }, now); // refused on caller limit
    // bob, a different caller under the same tool, must still see the tool's limit intact
    expect(limiter.check({ toolId: 't1', callerSubject: 'bob' }, now).allowed).toBe(true);
  });

  it('the window rolls off after 60s so a later call is allowed again', () => {
    const caps = resolveEffectiveCaps({
      perToolRateLimitPerMinute: 1,
      perCallerRateLimitPerMinute: 1,
    });
    const limiter = new CapsRateLimiter(caps);
    const t0 = 1_000_000;
    expect(limiter.check({ toolId: 't1', callerSubject: 'alice' }, t0).allowed).toBe(true);
    expect(limiter.check({ toolId: 't1', callerSubject: 'alice' }, t0 + 1_000).allowed).toBe(false);
    expect(limiter.check({ toolId: 't1', callerSubject: 'alice' }, t0 + 60_001).allowed).toBe(true);
  });

  it('a rate limit tightened to zero by the overlay refuses every call', () => {
    const caps = resolveEffectiveCaps({ perToolRateLimitPerMinute: 0 });
    const limiter = new CapsRateLimiter(caps);
    expect(limiter.check({ toolId: 't1', callerSubject: 'alice' }).allowed).toBe(false);
  });
});
