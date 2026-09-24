// MCPForge — W0-P9: the policy chain is where an execution grant is minted,
// and only at `proceed`.

import { describe, expect, it } from 'vitest';

import { generateConfirmSigningKey, singleKeyKeyring } from '../confirm/token.js';
import { callThroughToolsCall, invokeThroughForgeInvoke } from '../entry-points.js';
import { TOOLS, call, context, entry } from '../policy.fixtures.js';
import { verifyExecutionGrant } from './grant.js';

const KEYRING = singleKeyKeyring(generateConfirmSigningKey('egr-chain'));

describe('W0-P9 — the chain mints the grant at proceed', () => {
  it('a call that walks all ten stages carries a grant bound to exactly that call', async () => {
    const ctx = context({ runtime: { executionGrantKeyring: KEYRING } });
    const c = call(TOOLS.voucherSearch, { supplier: '4242' });
    const decision = await callThroughToolsCall(c, ctx);
    expect(decision.outcome).toBe('proceed');
    if (decision.outcome !== 'proceed') return;
    expect(decision.executionGrant).not.toBeNull();

    const verified = verifyExecutionGrant(
      decision.executionGrant ?? undefined,
      {
        toolId: c.toolId,
        bindingRef: entry(c.toolId).bindingRef,
        args: c.args,
        callerSubject: ctx.scope.session.principal.subject,
        correlationId: c.correlationId,
      },
      KEYRING,
      ctx.scope.now,
    );
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.purpose).toBe('execute');
      expect(verified.payload.consumerId).toBe(ctx.scope.session.consumer.consumerId);
    }
  });

  it('forge.invoke mints the identical grant — it is the same chain (CLAUDE.md #7)', async () => {
    const ctx = context({ runtime: { executionGrantKeyring: KEYRING } });
    const c = call(TOOLS.voucherSearch, { supplier: '4242' });
    const viaCall = await callThroughToolsCall(c, ctx);
    const viaInvoke = await invokeThroughForgeInvoke(c, ctx);
    expect(viaCall.outcome).toBe('proceed');
    expect(viaInvoke.outcome).toBe('proceed');
    if (viaCall.outcome === 'proceed' && viaInvoke.outcome === 'proceed') {
      expect(viaInvoke.executionGrant).toBe(viaCall.executionGrant);
    }
  });

  it('a REFUSED call carries no grant', async () => {
    const ctx = context({ runtime: { executionGrantKeyring: KEYRING } });
    const decision = await callThroughToolsCall(call('jde.no.such.tool.get'), ctx);
    expect(decision.outcome).toBe('refused');
    expect('executionGrant' in decision).toBe(false);
  });

  it('with no grant keyring the chain proceeds with a NULL grant, which every executor refuses', async () => {
    const decision = await callThroughToolsCall(call(TOOLS.voucherSearch), context());
    expect(decision.outcome).toBe('proceed');
    if (decision.outcome === 'proceed') expect(decision.executionGrant).toBeNull();
  });

  it('a mint that cannot bind (no catalogue entry for the tool) is a DENIAL, never a grant-less proceed', async () => {
    const ctx = context({ runtime: { executionGrantKeyring: KEYRING } });
    const decision = await callThroughToolsCall(call(TOOLS.voucherSearch), ctx, { stages: [] });
    // `stages: []` walks nothing, so only the mint step can refuse; strip the
    // catalogue to make it unable to bind.
    expect(decision.outcome).toBe('proceed');
    const stripped = { ...ctx, catalogue: [] };
    const denied = await callThroughToolsCall(call(TOOLS.voucherSearch), stripped, { stages: [] });
    expect(denied.outcome).toBe('refused');
    if (denied.outcome === 'refused') expect(denied.error.code).toBe('INTERNAL');
  });
});
