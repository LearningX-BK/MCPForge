// MCPForge — proof that `CapsRuntime` really plugs into the frozen policy
// chain at stage 6c, with no change to core/gateway/policy/**. W0-E6.

import { describe, expect, it } from 'vitest';
import { callThroughToolsCall as runPolicyChain } from '../policy/entry-points.js';
import { call, context, entry, TOOLS } from '../policy/policy.fixtures.js';
import { CapsRuntime } from './index.js';
import { resolveEffectiveCaps } from './overlay.js';

describe('CapsRuntime plugged into stage 6c of the real policy chain', () => {
  it('admits a call under every cap', async () => {
    const caps = resolveEffectiveCaps(null);
    const runtime = new CapsRuntime(caps);
    const ctx = context({ runtime: { rateLimiter: runtime } });
    const decision = await runPolicyChain(call(TOOLS.voucherSearch), ctx);
    expect(decision.outcome).not.toBe('refused');
  });

  it('refuses at stage 6c with RATE_LIMITED, and a non-empty next, once the per-tool cap is exhausted', async () => {
    const caps = resolveEffectiveCaps({ perToolRateLimitPerMinute: 1 });
    const runtime = new CapsRuntime(caps);
    const ctx = context({ runtime: { rateLimiter: runtime } });

    const first = await runPolicyChain(call(TOOLS.voucherSearch), ctx);
    expect(first.outcome).not.toBe('refused');

    const second = await runPolicyChain(call(TOOLS.voucherSearch), ctx);
    expect(second.outcome).toBe('refused');
    if (second.outcome !== 'refused') throw new Error('unreachable');
    expect(second.stage).toBe('6c');
    expect(second.error.code).toBe('RATE_LIMITED');
    expect(second.error.next.trim().length).toBeGreaterThan(0);
  });

  it('refuses once global concurrency is exhausted, and releasing frees it for the next call', async () => {
    const caps = resolveEffectiveCaps({ globalConcurrency: 1 });
    const runtime = new CapsRuntime(caps);
    const ctx = context({ runtime: { rateLimiter: runtime } });
    const theCall = call(TOOLS.voucherSearch);

    const first = await runPolicyChain(theCall, ctx);
    expect(first.outcome).not.toBe('refused');

    const second = await runPolicyChain(theCall, ctx);
    expect(second.outcome).toBe('refused');
    if (second.outcome !== 'refused') throw new Error('unreachable');
    expect(second.error.code).toBe('RATE_LIMITED');

    // Once the first call's slot is released, the next admission succeeds again.
    runtime.release(theCall, ctx);
    const third = await runPolicyChain(theCall, ctx);
    expect(third.outcome).not.toBe('refused');
  });

  it('refuses once a binding-specific concurrency cap is exhausted, independent of another binding', async () => {
    const caps = resolveEffectiveCaps({ perBindingConcurrency: 1 });
    const runtime = new CapsRuntime(caps);
    const ctx = context({ runtime: { rateLimiter: runtime } });

    const searchEntry = entry(TOOLS.voucherSearch);
    const poEntry = entry(TOOLS.poCreate);
    expect(searchEntry.bindingRef).not.toBe(poEntry.bindingRef);

    const first = await runPolicyChain(call(TOOLS.voucherSearch), ctx);
    expect(first.outcome).not.toBe('refused');

    // Same binding again — refused (its one concurrency slot is held).
    const second = await runPolicyChain(call(TOOLS.voucherSearch), ctx);
    expect(second.outcome).toBe('refused');

    // A different tool with a different bindingRef is unaffected.
    const third = await runPolicyChain(call(TOOLS.poCreate), ctx);
    expect(third.outcome).not.toBe('refused');
  });
});
