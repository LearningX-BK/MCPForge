// MCPForge — W0-N7's `RATE_LIMITED` refusal shape for consumer-level quotas,
// 02 §11.6. Proves the exact `next` text names a window and a reset time, and
// that the peek/commit contract does not silently consume a slot on a call
// that is about to be refused on the OTHER dimension.

import { describe, expect, it } from 'vitest';
import { ConsumerCallRateLimiter, checkConsumerQuota } from './consumer-quota.js';
import type { ConsumerQuotaUsageSource } from './consumer-quota.js';
import { resolveEffectiveConsumerLimits } from './consumer-limits.js';

const FIXED_NOW = new Date('2026-09-07T12:00:00.000Z');

function usageWithWrites(writes: number): ConsumerQuotaUsageSource {
  return {
    async getBucket() {
      return { writes };
    },
  };
}

describe('checkConsumerQuota — callsPerMinute', () => {
  it('allows calls under the limit', async () => {
    const limits = resolveEffectiveConsumerLimits({ callsPerMinute: 3, writesPerDay: 100 }, null);
    const rateLimiter = new ConsumerCallRateLimiter();
    const verdict = await checkConsumerQuota(
      { consumerId: 'agent-1', isWrite: false },
      limits,
      { usage: usageWithWrites(0), rateLimiter, now: () => FIXED_NOW },
    );
    expect(verdict.allowed).toBe(true);
  });

  it('refuses with RATE_LIMITED once the per-minute limit is reached, naming the window and its reset time', async () => {
    const limits = resolveEffectiveConsumerLimits({ callsPerMinute: 2, writesPerDay: 100 }, null);
    const rateLimiter = new ConsumerCallRateLimiter();
    rateLimiter.record('agent-1', FIXED_NOW.getTime());
    rateLimiter.record('agent-1', FIXED_NOW.getTime());

    const verdict = await checkConsumerQuota(
      { consumerId: 'agent-1', isWrite: false },
      limits,
      { usage: usageWithWrites(0), rateLimiter, now: () => FIXED_NOW },
    );

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('unreachable');
    expect(verdict.code).toBe('RATE_LIMITED');
    expect(verdict.message).toBe(
      'Consumer agent-1 exceeded its declared limit of 2 calls/minute.',
    );
    // Names the window ("per-minute window") AND the exact reset instant.
    expect(verdict.next).toMatch(/per-minute window that resets at 2026-09-07T12:01:00\.000Z/);
    expect(verdict.next).toMatch(/agent-1/);
  });

  it('does not confuse one consumer\'s window with another\'s', async () => {
    const limits = resolveEffectiveConsumerLimits({ callsPerMinute: 1, writesPerDay: 100 }, null);
    const rateLimiter = new ConsumerCallRateLimiter();
    rateLimiter.record('agent-1', FIXED_NOW.getTime());

    const verdict = await checkConsumerQuota(
      { consumerId: 'agent-2', isWrite: false },
      limits,
      { usage: usageWithWrites(0), rateLimiter, now: () => FIXED_NOW },
    );
    expect(verdict.allowed).toBe(true);
  });
});

describe('checkConsumerQuota — writesPerDay', () => {
  it('allows a write under the daily limit', async () => {
    const limits = resolveEffectiveConsumerLimits({ callsPerMinute: 100, writesPerDay: 5 }, null);
    const verdict = await checkConsumerQuota(
      { consumerId: 'agent-1', isWrite: true },
      limits,
      { usage: usageWithWrites(4), rateLimiter: new ConsumerCallRateLimiter(), now: () => FIXED_NOW },
    );
    expect(verdict.allowed).toBe(true);
  });

  it('refuses with RATE_LIMITED once the daily write limit is reached, naming the daily window and its UTC reset', async () => {
    const limits = resolveEffectiveConsumerLimits({ callsPerMinute: 100, writesPerDay: 5 }, null);
    const verdict = await checkConsumerQuota(
      { consumerId: 'agent-1', isWrite: true },
      limits,
      { usage: usageWithWrites(5), rateLimiter: new ConsumerCallRateLimiter(), now: () => FIXED_NOW },
    );
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error('unreachable');
    expect(verdict.code).toBe('RATE_LIMITED');
    expect(verdict.message).toBe('Consumer agent-1 exceeded its declared limit of 5 writes/day.');
    // The daily bucket for 2026-09-07 resets at the start of 2026-09-08 UTC.
    expect(verdict.next).toMatch(/daily window \(UTC\) that resets at 2026-09-08T00:00:00\.000Z/);
  });

  it('a read call never consults the write quota, even at/over the daily write limit', async () => {
    const limits = resolveEffectiveConsumerLimits({ callsPerMinute: 100, writesPerDay: 0 }, null);
    const verdict = await checkConsumerQuota(
      { consumerId: 'agent-1', isWrite: false },
      limits,
      { usage: usageWithWrites(999), rateLimiter: new ConsumerCallRateLimiter(), now: () => FIXED_NOW },
    );
    expect(verdict.allowed).toBe(true);
  });

  it('a call refused on callsPerMinute does not also evaluate (or leak a false pass on) writesPerDay', async () => {
    const limits = resolveEffectiveConsumerLimits({ callsPerMinute: 0, writesPerDay: 100 }, null);
    let usageQueried = false;
    const usage: ConsumerQuotaUsageSource = {
      async getBucket() {
        usageQueried = true;
        return { writes: 0 };
      },
    };
    const verdict = await checkConsumerQuota(
      { consumerId: 'agent-1', isWrite: true },
      limits,
      { usage, rateLimiter: new ConsumerCallRateLimiter(), now: () => FIXED_NOW },
    );
    expect(verdict.allowed).toBe(false);
    // The call-rate ceiling is checked FIRST and short-circuits — the write
    // quota query never runs for a call already refused on the other axis.
    expect(usageQueried).toBe(false);
  });
});
