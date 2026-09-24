// MCPForge — W0-E8 cases 2 and 3.
//
//   case 2  reach data the caller cannot reach natively
//   case 3  call an unlisted tool through `forge.invoke`
//
// Both run against the REAL six-way `resolveScope` (W0-E2) driven by the REAL
// ten-stage policy chain (W0-E3), through the real entry points in
// `core/gateway/policy/entry-points.ts`. Nothing here substitutes a decision
// for a stage: the only things injected are W0-E3's own fixture seams for the
// stages whose owning task has not landed (6c/6d/6f/6g/6h), and every one of
// those is set to its PERMISSIVE value — allow the rate, accept the arguments,
// breach no guardrail, not-a-write, no replay. That direction matters: if the
// refusal were coming from a seam rather than from scope resolution, these
// tests would pass for the wrong reason. Set permissive, the ONLY thing that
// can refuse is the machinery under test.

import { describe, expect, it, vi } from 'vitest';
import {
  callThroughToolsCall,
  invokeThroughForgeInvoke,
} from '../../core/gateway/policy/entry-points.js';
import { call, context, POLICY_CATALOGUE, TOOLS } from '../../core/gateway/policy/policy.fixtures.js';
import { resolveScope } from '../../core/gateway/scope/resolve.js';
import { expectFailsClosed, expectProceeds } from './harness.js';

// The caller holds p2p and o2c. `jde.fin.journal.create` is r2r's — the
// classic "reach data the caller cannot reach natively": the tool is deployed,
// probed, enabled and in this deployment's catalogue; the ONLY thing standing
// between the caller and it is the role grant.
const NOT_GRANTED = TOOLS.journalCreate;

describe('W0-E8 case 2 — reaching data the caller cannot reach natively', () => {
  it('the tool is genuinely present and enabled, so the refusal is the grant and nothing else', () => {
    const inCatalogue = POLICY_CATALOGUE.some((e) => e.toolId === NOT_GRANTED);
    expect(inCatalogue).toBe(true);

    // Held by someone: r2r grants it. The caller just is not that someone.
    const asR2r = resolveScope(POLICY_CATALOGUE, context({ heldRoleIds: ['r2r'] }).scope);
    expect(asR2r.visible).toContain(NOT_GRANTED);
  });

  it('it is not in the caller resolved scope, so it is never listed to them', () => {
    const resolution = resolveScope(POLICY_CATALOGUE, context().scope);
    expect(resolution.visible).not.toContain(NOT_GRANTED);
    expect(resolution.refusals.get(NOT_GRANTED)?.predicate).toBe('Granted');
  });

  it('calling it anyway through tools/call FAILS CLOSED with TOOL_NOT_IN_SCOPE at 6a', async () => {
    const decision = await callThroughToolsCall(call(NOT_GRANTED, { amount: 1 }), context());

    const refused = expectFailsClosed(decision, { code: 'TOOL_NOT_IN_SCOPE', stage: '6a' });
    // 02 §11.3: TOOL_NOT_IN_SCOPE and CONSUMER_NOT_AUTHORIZED are not
    // interchangeable — this refusal must tell the operator to widen the HUMAN.
    expect(refused.error.next).toMatch(/forge\.find|role/i);
    // And it must not leak that the tool exists elsewhere in the estate as
    // something the caller could obtain by asking differently.
    expect(refused.stagesRun).toEqual(['6a']);
  });

  it('a tool id in NO catalogue at all also fails closed with TOOL_NOT_IN_SCOPE, not INPUT_INVALID', async () => {
    const decision = await callThroughToolsCall(call('jde.hr.employee.get'), context());
    expectFailsClosed(decision, { code: 'TOOL_NOT_IN_SCOPE', stage: '6a' });
  });

  it('the same call by a caller who DOES hold r2r gets PAST 6a — so 6a refused on the grant, not on a broken fixture', async () => {
    const decision = await callThroughToolsCall(
      call(NOT_GRANTED, { amount: 1 }),
      context({ heldRoleIds: ['r2r'] }),
    );
    // The consumer fixture already authorizes r2r and the `function` binding
    // type; what it does NOT carry is a bindingGrant, so this baseline stops at
    // 6e′ rather than proceeding. That is the correct, fail-closed answer and
    // it is asserted as such — see ./escalation.elevated-binding.test.ts.
    expect(decision.outcome).toBe('refused');
    expect((decision as { error: { code: string } }).error.code).toBe('ELEVATED_GRANT_REQUIRED');
  });
});

describe('W0-E8 case 3 — calling an unlisted tool through forge.invoke', () => {
  it('forge.invoke refuses the unlisted tool IDENTICALLY to tools/call', async () => {
    const viaToolsCall = await callThroughToolsCall(call(NOT_GRANTED, { amount: 1 }), context());
    const viaForgeInvoke = await invokeThroughForgeInvoke(
      call(NOT_GRANTED, { amount: 1 }),
      context(),
    );

    expectFailsClosed(viaToolsCall, { code: 'TOOL_NOT_IN_SCOPE', stage: '6a' });
    expectFailsClosed(viaForgeInvoke, { code: 'TOOL_NOT_IN_SCOPE', stage: '6a' });

    // "Identical chain" (CLAUDE.md #7) as an assertion, not a claim: same
    // stages walked, same stage refusing, same code, same condition, same next.
    expect(viaForgeInvoke).toEqual(viaToolsCall);
  });

  it('forge.invoke walks every stage tools/call walks — it cannot skip one', async () => {
    // A tool the caller genuinely holds, so the chain runs to the end and the
    // full stage list is observable rather than truncated by an early refusal.
    const permitted = call(TOOLS.voucherSearch);
    const viaToolsCall = await callThroughToolsCall(permitted, context());
    const viaForgeInvoke = await invokeThroughForgeInvoke(permitted, context());

    expectProceeds(viaToolsCall);
    expectProceeds(viaForgeInvoke);
    expect(viaForgeInvoke.stagesRun).toEqual(viaToolsCall.stagesRun);
    expect(viaForgeInvoke.stagesRun).toHaveLength(10);
  });

  it('forge.invoke does not reach the write gate for a tool it was refused at 6a', async () => {
    // The sharpest form of "not a way around it": if `forge.invoke` trusted the
    // caller-supplied tool id, the unlisted WRITE tool below would reach 6g and
    // mint a plan token. This spy is on the real seam the chain calls; it only
    // records, and asserting it was never called is asserting no plan was made.
    const writeGate = { evaluate: vi.fn(() => ({ kind: 'not-a-write' as const })) };
    const ctx = context({ runtime: { writeGate } });

    const decision = await invokeThroughForgeInvoke(call(NOT_GRANTED, { amount: 1 }), ctx);

    expectFailsClosed(decision, { code: 'TOOL_NOT_IN_SCOPE', stage: '6a' });
    expect(writeGate.evaluate).not.toHaveBeenCalled();
  });
});
