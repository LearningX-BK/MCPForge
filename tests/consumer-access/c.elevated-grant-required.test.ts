// MCPForge — W0-N14(c): 01 §11.5 criterion 14(c).
//
// "An elevated-binding tool held in the caller's role scope but with no
// elevated grant is refused with ELEVATED_GRANT_REQUIRED through BOTH a
// direct tools/call and forge.invoke, and is absent from tools/list while
// remaining findable through forge.find with its agentMessage."
//
// CLAUDE.md non-negotiable #7: "Being in scope is not permission to execute an
// elevated binding ... Catalogue membership is discovery; scope is
// visibility; neither is permission. ... forge.invoke is not a way around it
// — it runs the identical chain."
//
// The grant-refusal half of this is `tests/policy/escalation.elevated-posture.test.ts`
// (W0-N3) clause 2, in depth, against BOTH entry points. The discovery half —
// excluded from tools/list, findable through forge.find, carrying an
// agentMessage — is `core/gateway/meta/visibility.ts`'s `resolveDiscovery`
// (W0-G4), which reuses `authorizeBinding` (stage 6e') "purely to decide
// LISTING and the access annotation. Nothing here authorizes anything: stage
// 6e' runs again, independently, on every call through either entry point."
// This file assembles both real mechanisms into one checkpoint-evidence test
// rather than re-deriving either.

import { describe, expect, it } from 'vitest';
import { callThroughToolsCall, invokeThroughForgeInvoke } from '../../core/gateway/policy/entry-points.js';
import {
  call,
  context,
  defaultRoles,
  functionGrant,
  role,
  TOOLS,
} from '../../core/gateway/policy/policy.fixtures.js';
import { forgeFind } from '../../core/gateway/meta/find.js';
import { resolveDiscovery } from '../../core/gateway/meta/visibility.js';
import { metaContext } from '../../core/gateway/meta/meta.fixtures.js';
import { withEvidence } from './support/evidence.js';

/** `jde.ap.voucher.create` — a `function` binding and a write: elevated posture. */
const ELEVATED_WRITE = TOOLS.voucherCreate;

describe('W0-N14(c) — elevated binding: no grant, refused through both entry points, discovery not permission', () => {
  it('ELEVATED_GRANT_REQUIRED via tools/call AND forge.invoke; absent from tools/list; findable via forge.find with an agentMessage', async () => {
    await withEvidence(
      'c',
      '(c) An elevated-binding tool held in the caller\'s role scope but with no elevated grant is refused with ELEVATED_GRANT_REQUIRED through both a direct tools/call and forge.invoke, and is absent from tools/list while remaining findable through forge.find with its agentMessage.',
      "ELEVATED_GRANT_REQUIRED via tools/call AND forge.invoke; absent from tools/list; findable via forge.find with an agentMessage",
      async () => {
        // Held in scope — p2p grants jde.ap.voucher.* — but the p2p role
        // carries NO bindingGrant of any kind: scope membership without a
        // grant is exactly the case CLAUDE.md #7 forbids from admitting.
        const rolesWithNoGrant = new Map(defaultRoles());
        rolesWithNoGrant.set('p2p', role({ roleId: 'p2p', bindingGrants: [] }));

        const overrides = { roles: rolesWithNoGrant };

        // --- (1) both entry points refuse identically -----------------------
        const viaToolsCall = await callThroughToolsCall(
          call(ELEVATED_WRITE, { amount: 100 }),
          context(overrides),
        );
        const viaForgeInvoke = await invokeThroughForgeInvoke(
          call(ELEVATED_WRITE, { amount: 100 }),
          context(overrides),
        );

        if (viaToolsCall.outcome !== 'refused' || viaForgeInvoke.outcome !== 'refused') {
          throw new Error('expected both entry points to refuse with no elevated grant held');
        }
        expect(viaToolsCall.error.code).toBe('ELEVATED_GRANT_REQUIRED');
        expect(viaToolsCall.stage).toBe('6e′');
        expect(viaForgeInvoke.error.code).toBe('ELEVATED_GRANT_REQUIRED');
        expect(viaForgeInvoke.stage).toBe('6e′');
        // The IDENTICAL chain, not a parallel one.
        expect(viaForgeInvoke.error.code).toBe(viaToolsCall.error.code);
        expect(viaForgeInvoke.error.next).toBe(viaToolsCall.error.next);
        expect(viaForgeInvoke.stagesRun).toEqual(viaToolsCall.stagesRun);
        expect(viaToolsCall.error.next.length).toBeGreaterThan(0);
        expect(viaToolsCall.error.next.toLowerCase()).not.toMatch(/^try again\b/);

        // --- (2) discovery: absent from tools/list, findable via forge.find --
        const ctx = metaContext(overrides);
        const discovery = resolveDiscovery(ctx);

        expect(discovery.visible).toContain(ELEVATED_WRITE);
        expect(discovery.listable).not.toContain(ELEVATED_WRITE);
        expect(discovery.findable.has(ELEVATED_WRITE)).toBe(true);
        const access = discovery.access.get(ELEVATED_WRITE);
        expect(access?.level).toBe('requires_grant');
        expect(access?.agentMessage).toBeDefined();
        expect(access?.agentMessage).toMatch(/ELEVATED_GRANT_REQUIRED/);
        expect(access?.agentMessage).toMatch(/bindingGrant/);

        const found = forgeFind(ctx, { query: 'AP voucher create' });
        if (found.result !== 'tools') {
          throw new Error(`expected forge.find to return tools, got no_tool: ${found.reason}`);
        }
        const foundEntry = found.tools.find((t) => t.card['id'] === ELEVATED_WRITE);
        if (foundEntry === undefined) {
          throw new Error(`expected forge.find to surface ${ELEVATED_WRITE} as findable`);
        }
        expect(foundEntry.access).toBe('requires_grant');
        expect(foundEntry.agentMessage).toBeDefined();
        expect(foundEntry.agentMessage).toBe(access?.agentMessage);

        // --- (3) baseline: the SAME call with a live grant proceeds ----------
        // Proves the refusals above are the missing grant and nothing else
        // (CLAUDE.md #7 — scope is visibility, not permission).
        const rolesWithGrant = new Map(defaultRoles());
        rolesWithGrant.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
        const baseline = await callThroughToolsCall(
          call(ELEVATED_WRITE, { amount: 100 }),
          context({ roles: rolesWithGrant }),
        );
        expect(baseline.outcome).toBe('proceed');
        const discoveryWithGrant = resolveDiscovery(metaContext({ roles: rolesWithGrant }));
        expect(discoveryWithGrant.listable).toContain(ELEVATED_WRITE);

        return {
          elevatedTool: ELEVATED_WRITE,
          toolsCallRefusalCode: viaToolsCall.error.code,
          toolsCallRefusalStage: viaToolsCall.stage,
          toolsCallRefusalNext: viaToolsCall.error.next,
          forgeInvokeRefusalCode: viaForgeInvoke.error.code,
          forgeInvokeRefusalStage: viaForgeInvoke.stage,
          identicalAcrossEntryPoints: viaForgeInvoke.error.next === viaToolsCall.error.next,
          listableWithoutGrant: discovery.listable,
          findableWithoutGrant: [...discovery.findable],
          accessLevelWithoutGrant: access?.level,
          agentMessageWithoutGrant: access?.agentMessage,
          forgeFindSurfacedIt: true,
          baselineWithGrantOutcome: baseline.outcome,
          listableWithGrant: discoveryWithGrant.listable,
          realMechanism:
            'core/gateway/policy/binding-auth/authorize.ts authorizeBinding (stage 6e′) via core/gateway/policy/entry-points.ts (identical chain) and core/gateway/meta/visibility.ts resolveDiscovery (same authorizeBinding call, for listing only) — the mechanisms tests/policy/escalation.elevated-posture.test.ts (W0-N3) and core/gateway/meta/*.test.ts (W0-G4) already prove.',
        };
      },
    );
  });
});
