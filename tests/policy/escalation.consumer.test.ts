// MCPForge — W0-E8 [P5] cases 5 and 6.
//
//   case 5  an UNREGISTERED consumer presenting an otherwise-valid user token
//   case 6  a consumer SUSPENDED mid-session, via the real `forge kill`
//
// CLAUDE.md non-negotiable #6: "Every call needs BOTH a registered consumer and
// a resolved human identity. Authorization is the intersection … never the
// union, never a substitute. … There is no consumer-only path and no human-only
// path."
//
// HONESTY NOTE ON CASE 5 (CLAUDE.md §8). The literal refusal 02 §11.2 specifies
// for an unregistered consumer is `CONSUMER_UNREGISTERED` at session
// establishment, step `[2a]` — and `core/gateway/consumer/**`, the registry that
// authenticates a presenting client and loads its record at `[2a]`, is W0-N2's
// task and does not exist yet (it is named as a seam in
// `core/gateway/scope/types.ts`'s own comment). So the escalation attempt below
// is made against the two layers that ARE built and that `[2a]` will sit in
// front of, not instead of:
//
//   (a) scope resolution — a consumer that is not `active` sees an EMPTY
//       catalogue, which is "is served no tools/list" made literal; and
//   (b) the policy chain's stage 6a′, the deliberate call-time re-check, which
//       refuses before any later stage runs.
//
// The user's JWT in case 5 is minted and verified by the REAL W0-D1 issuer, so
// "an otherwise-valid user token" is a fact about a real token and not an
// assumption. When W0-N2 lands, the `[2a]` refusal joins this file; nothing here
// is written in a way that would then need rewriting.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ERROR_TAXONOMY } from '@mcpforge/shared';
import { callThroughToolsCall } from '../../core/gateway/policy/entry-points.js';
import {
  call,
  context,
  POLICY_CATALOGUE,
  TOOLS,
} from '../../core/gateway/policy/policy.fixtures.js';
import type { PolicyContext } from '../../core/gateway/policy/types.js';
import { consumer, principal } from '../../core/gateway/scope/scope.fixtures.js';
import { resolveScope } from '../../core/gateway/scope/resolve.js';
import {
  consumerAuthorizedPredicate,
  type PredicateRefusal,
} from '../../core/gateway/scope/predicates.js';
import { generateLocalSigningKey, localTokenIssuer } from '../../core/gateway/identity/jwt.js';
import { applyKill } from '../../core/gateway/flags/kill.js';
import { createPolledRuntimeFlagSource } from '../../core/gateway/flags/poller.js';
import { openRuntimeStore } from '../../core/gateway/store/store.js';
import type { RuntimeStore } from '../../core/gateway/store/repository.js';
import { expectFailsClosed, expectProceeds } from './harness.js';

// A read tool that otherwise passes every stage, so the ONLY variable in these
// tests is the consumer's standing.
const PERMITTED = TOOLS.voucherSearch;

describe('W0-E8 [P5] case 5 — an unregistered consumer presenting a valid user token', () => {
  it('the human token really is valid — minted and verified by the real local issuer', async () => {
    const issuer = localTokenIssuer({
      signingKey: generateLocalSigningKey('w0-e8'),
      issuer: 'https://mcpforge.test',
      audience: 'mcpforge',
    });
    const human = principal();
    const issued = await issuer.issue(human);

    const verified = await issuer.verify(issued.token, 'req_w0e8_case5');
    expect(verified.subject).toBe(human.subject);
    expect(verified.groups).toEqual(human.groups);
  });

  it('an unregistered consumer is served NO tools/list — the resolved catalogue is empty', () => {
    const unregistered = consumer({ consumerId: 'not-in-consumers-dir', effectiveStatus: 'unregistered' });
    const resolution = resolveScope(POLICY_CATALOGUE, context({ consumer: unregistered }).scope);

    expect(resolution.visible).toEqual([]);
    expect(resolution.refusals.size).toBe(POLICY_CATALOGUE.length);

    // Every single tool is refused BY THE CONSUMER PREDICATE — asserted against
    // the predicate itself rather than against `refusals`, because `refusals`
    // records only the FIRST predicate to refuse in precedence order and one
    // fixture tool (`voucherGet`, in the undeployed `jde-hr` package) is refused
    // by `Deployed` before `ConsumerAuthorized` is ever reached. Asserting the
    // predicate directly is the stronger claim: it proves the emptiness is owned
    // by the consumer's standing and is not an accident of the other five.
    const ctx = context({ consumer: unregistered }).scope;
    for (const entry of POLICY_CATALOGUE) {
      const outcome = consumerAuthorizedPredicate.evaluate(entry, ctx);
      expect(outcome.admitted, `${entry.toolId} was admitted by ConsumerAuthorized`).toBe(false);
      expect((outcome as PredicateRefusal).code).toBe('CONSUMER_SUSPENDED');
    }

    // And for every tool that the SAME session would otherwise have seen, the
    // refusal scope resolution actually records is the consumer's. (Tools the
    // other five predicates already withheld are refused earlier in precedence
    // order; they are not what this case is about, and asserting the consumer
    // predicate on them would be asserting the wrong thing.)
    const baseline = resolveScope(POLICY_CATALOGUE, context().scope).visible;
    expect(baseline.length).toBeGreaterThan(0);
    for (const toolId of baseline) {
      const refusal = resolution.refusals.get(toolId);
      expect(refusal, `${toolId} was not refused at all`).toBeDefined();
      expect(refusal!.predicate).toBe('ConsumerAuthorized');
      expect(refusal!.code).toBe('CONSUMER_SUSPENDED');
    }
  });

  it('naming a tool directly anyway FAILS CLOSED at 6a′, with the valid human token unable to help', async () => {
    const unregistered = consumer({ consumerId: 'not-in-consumers-dir', effectiveStatus: 'unregistered' });
    const decision = await callThroughToolsCall(
      call(PERMITTED),
      context({ consumer: unregistered }),
    );

    const refused = expectFailsClosed(decision, { code: 'CONSUMER_SUSPENDED', stage: '6a′' });
    expect(refused.error.message).toMatch(/not-in-consumers-dir/);
    expect(refused.error.message).toMatch(/unregistered/);
    // "no human-only path": the refusal names the CLIENT's registration, and
    // does not offer a role change as the remedy.
    expect(refused.error.next).toMatch(/registration/i);
  });

  it('every non-active standing fails closed — expired and retired are not softer than suspended', async () => {
    for (const status of ['unregistered', 'suspended', 'expired', 'retired']) {
      const decision = await callThroughToolsCall(
        call(PERMITTED),
        context({ consumer: consumer({ effectiveStatus: status }) }),
      );
      expectFailsClosed(decision, { code: 'CONSUMER_SUSPENDED', stage: '6a′' });
    }
  });

  it('the same call with the SAME human token and a REGISTERED consumer proceeds', async () => {
    expectProceeds(await callThroughToolsCall(call(PERMITTED), context()));
  });

  it('CONSUMER_UNREGISTERED exists in the closed taxonomy with a real next, awaiting W0-N2 step [2a]', () => {
    // Recorded here rather than asserted as behaviour, because nothing emits it
    // yet: see this file's honesty note. If it ever loses its `next`, that is a
    // non-negotiable #5 break and this fails.
    const declared = ERROR_TAXONOMY.CONSUMER_UNREGISTERED;
    expect(declared.code).toBe('CONSUMER_UNREGISTERED');
    expect(declared.next.trim().length).toBeGreaterThan(0);
    expect(declared.retryable).toBe(false);
  });
});

describe('W0-E8 [P5] case 6 — a consumer suspended MID-SESSION by the real forge kill', () => {
  let store: RuntimeStore;
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mcpforge-w0e8-'));
    store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'runtime.db') });
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('the next call after forge kill consumer:<id> FAILS CLOSED, with no redeploy and no new session', async () => {
    // The real store-backed flag source the running gateway uses — W0-E5's
    // `createPolledRuntimeFlagSource`, not the in-memory fixture.
    const flags = createPolledRuntimeFlagSource(store.runtimeFlags, { intervalMs: 5000 });
    await flags.refreshNow();

    const base = context();
    // One long-lived session context, built ONCE and reused across both calls,
    // which is what makes this "mid-session" rather than "on reconnect".
    const session: PolicyContext = { ...base, scope: { ...base.scope, flags } };
    const consumerId = session.scope.session.consumer.consumerId;

    // Before: the session works.
    expectProceeds(await callThroughToolsCall(call(PERMITTED), session));

    // `forge kill consumer:<id>` — the real command's business logic, writing a
    // real row to the real runtime_flags table and a real audit record.
    const killed = await applyKill(store.runtimeFlags, store.audit, {
      raw: `consumer:${consumerId}`,
      reason: 'credential suspected compromised',
      actorSubject: 'ops-bikash',
      deploymentId: 'ltm-dev',
    });
    expect(killed.scope).toBe('consumer');
    expect(killed.target).toBe(consumerId);

    // Still working until the poll ticks — stated, not glossed: the 5-second
    // window is a real property of 02 §4.7's design, not a bug.
    expectProceeds(await callThroughToolsCall(call(PERMITTED), session));

    // One tick of the REAL poll (`refreshNow` is exactly what the 5s interval
    // calls), no restart of anything.
    await flags.refreshNow();

    const refused = expectFailsClosed(await callThroughToolsCall(call(PERMITTED), session), {
      code: 'CONSUMER_SUSPENDED',
      stage: '6b',
    });
    // 02 §4.7: the flag's own reason text is surfaced verbatim.
    expect(refused.error.message).toMatch(/credential suspected compromised/);
    expect(refused.error.next).toMatch(/credential suspected compromised/);
  });

  it('the suspension also empties the session tools/list — nothing stays visible to a killed consumer', async () => {
    const flags = createPolledRuntimeFlagSource(store.runtimeFlags, { intervalMs: 5000 });
    const base = context();
    const session: PolicyContext = { ...base, scope: { ...base.scope, flags } };

    await applyKill(store.runtimeFlags, store.audit, {
      raw: `consumer:${session.scope.session.consumer.consumerId}`,
      reason: 'credential suspected compromised',
      actorSubject: 'ops-bikash',
      deploymentId: 'ltm-dev',
    });
    await flags.refreshNow();

    expect(resolveScope(POLICY_CATALOGUE, session.scope).visible).toEqual([]);
  });

  it('the kill is audited — a suspension with no "who and why" would be its own escalation', async () => {
    const flags = createPolledRuntimeFlagSource(store.runtimeFlags, { intervalMs: 5000 });
    const applied = await applyKill(store.runtimeFlags, store.audit, {
      raw: 'consumer:claude-desktop-coe',
      reason: 'credential suspected compromised',
      actorSubject: 'ops-bikash',
      deploymentId: 'ltm-dev',
    });
    await flags.refreshNow();

    expect(applied.auditCallId.length).toBeGreaterThan(0);
    expect(flags.activeFlags().map((f) => f.target)).toContain('claude-desktop-coe');
  });
});
