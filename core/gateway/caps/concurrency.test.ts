import { describe, expect, it } from 'vitest';
import { ConcurrencyLimiter, GLOBAL_CONCURRENCY_KEY } from './concurrency.js';

describe('ConcurrencyLimiter', () => {
  it('admits up to the limit and refuses the call beyond it', () => {
    const limiter = new ConcurrencyLimiter(2, 'binding');
    expect(limiter.tryAcquire('b1').allowed).toBe(true);
    expect(limiter.tryAcquire('b1').allowed).toBe(true);
    const third = limiter.tryAcquire('b1');
    expect(third.allowed).toBe(false);
    if (!third.allowed) expect(third.reason).toMatch(/b1/);
  });

  it('release frees a slot for a subsequent admission', () => {
    const limiter = new ConcurrencyLimiter(1, 'binding');
    expect(limiter.tryAcquire('b1').allowed).toBe(true);
    expect(limiter.tryAcquire('b1').allowed).toBe(false);
    limiter.release('b1');
    expect(limiter.tryAcquire('b1').allowed).toBe(true);
  });

  it('a leaked slot (never released) keeps refusing — proves release is load-bearing, not cosmetic', () => {
    const limiter = new ConcurrencyLimiter(1, 'binding');
    limiter.tryAcquire('b1');
    // no release
    expect(limiter.tryAcquire('b1').allowed).toBe(false);
    expect(limiter.currentInFlight('b1')).toBe(1);
  });

  it('release never goes negative', () => {
    const limiter = new ConcurrencyLimiter(1, 'binding');
    limiter.release('never-acquired');
    expect(limiter.currentInFlight('never-acquired')).toBe(0);
  });

  it('keys are independent — a different binding is unaffected by another one being full', () => {
    const limiter = new ConcurrencyLimiter(1, 'binding');
    limiter.tryAcquire('b1');
    expect(limiter.tryAcquire('b2').allowed).toBe(true);
  });

  it('the global key works like any other key', () => {
    const limiter = new ConcurrencyLimiter(1, 'gateway');
    expect(limiter.tryAcquire(GLOBAL_CONCURRENCY_KEY).allowed).toBe(true);
    expect(limiter.tryAcquire(GLOBAL_CONCURRENCY_KEY).allowed).toBe(false);
  });

  it('a zero limit (overlay locked fully closed) refuses immediately', () => {
    const limiter = new ConcurrencyLimiter(0, 'gateway');
    expect(limiter.tryAcquire('anything').allowed).toBe(false);
  });
});
