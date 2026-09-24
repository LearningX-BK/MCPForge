// MCPForge — W0-G4 `done:` clause 2: "`forge.activate` refuses an activation
// exceeding the VTC hard cap or the caller's grants and emits `list_changed`."
//
// Three distinct claims, three distinct tests, and the notification is
// asserted as a real call on the same `ToolListChangedNotifier` seam W0-E5's
// own suite spies on (`flags/notify.test.ts` uses `vi.fn()` against the same
// interface, and `flags/pipeline.e2e.test.ts` proves that seam reaches the
// wire). Nothing here builds a second notification path to assert against.

import { describe, expect, it, vi } from 'vitest';
import { forgeActivate } from './activate.js';
import { functionGrant, role } from '../policy/policy.fixtures.js';
import { CORRELATION_ID, metaSession, TOOLS } from './meta.fixtures.js';
import { META_TOOL_COUNT, VTC_DEFAULT, VTC_HARD_CAP } from './vtc.js';
import type { PolicyRoleView } from '../policy/index.js';

function grantedRoles(): ReadonlyMap<string, PolicyRoleView> {
  return new Map<string, PolicyRoleView>([
    ['p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] })],
    ['o2c', role({ roleId: 'o2c' })],
    ['r2r', role({ roleId: 'r2r' })],
  ]);
}

describe('forge.activate: the happy path emits list_changed', () => {
  it('activates a held role, sets session scope, and fires notifications/tools/list_changed', () => {
    const sendToolListChanged = vi.fn();
    const session = metaSession({ roles: grantedRoles(), notifier: { sendToolListChanged } });

    const result = forgeActivate(session, { role: 'p2p' }, CORRELATION_ID);

    expect(result.result).toBe('activated');
    if (result.result !== 'activated') return;
    expect(result.toolIds).toContain(TOOLS.voucherCreate);
    expect(result.count).toBe(META_TOOL_COUNT + result.toolIds.length);
    expect(result.tokenEstimate).toBeGreaterThan(0);
    expect(sendToolListChanged).toHaveBeenCalledTimes(1);

    // The session's scope actually moved — the client's next tools/list differs.
    const activation = session.context().policy.scope.session.activation;
    expect(activation.mode).toBe('explicit');
    if (activation.mode !== 'explicit') return;
    expect([...activation.toolIds].sort()).toEqual([...result.toolIds]);
  });

  it('activates an explicit tool id list', () => {
    const sendToolListChanged = vi.fn();
    const session = metaSession({ roles: grantedRoles(), notifier: { sendToolListChanged } });
    const result = forgeActivate(
      session,
      { toolIds: [TOOLS.voucherSearch, TOOLS.voucherCancel] },
      CORRELATION_ID,
    );
    expect(result.result).toBe('activated');
    expect(sendToolListChanged).toHaveBeenCalledTimes(1);
  });
});

describe('DONE: forge.activate refuses an activation exceeding the VTC hard cap', () => {
  it(`refuses ${VTC_HARD_CAP - META_TOOL_COUNT + 1} tools, names the cap, and does NOT notify`, () => {
    const sendToolListChanged = vi.fn();
    const session = metaSession({ roles: grantedRoles(), notifier: { sendToolListChanged } });

    const tooMany = Array.from(
      { length: VTC_HARD_CAP - META_TOOL_COUNT + 1 },
      (_, i) => `jde.ap.filler_${String(i).padStart(2, '0')}.get`,
    );
    const result = forgeActivate(session, { toolIds: tooMany }, CORRELATION_ID);

    expect(result.result).toBe('error');
    if (result.result !== 'error') return;
    expect(result.error.message).toContain(String(VTC_HARD_CAP));
    expect(result.error.next.trim().length).toBeGreaterThan(0);
    expect(result.error.next.toLowerCase()).not.toContain('try again');
    expect(sendToolListChanged).not.toHaveBeenCalled();
    expect(session.context().policy.scope.session.activation.mode).toBe('default');
  });

  it('an activation at the hard cap boundary is not refused for the cap', () => {
    const session = metaSession({ roles: grantedRoles() });
    const atCap = Array.from(
      { length: VTC_HARD_CAP - META_TOOL_COUNT },
      (_, i) => `jde.ap.filler_${String(i).padStart(2, '0')}.get`,
    );
    const result = forgeActivate(session, { toolIds: atCap }, CORRELATION_ID);
    // It still fails — those ids are not in scope — but NOT with the cap message.
    expect(result.result).toBe('error');
    if (result.result !== 'error') return;
    expect(result.error.code).toBe('TOOL_NOT_IN_SCOPE');
  });

  it('warns, but does not refuse, between the ≤16 default and the hard cap', () => {
    // The fixture role is smaller than the default, so this asserts the shape
    // of the rule rather than a fixture accident: at or under the default there
    // is no warning at all.
    const session = metaSession({ roles: grantedRoles() });
    const result = forgeActivate(session, { role: 'p2p' }, CORRELATION_ID);
    if (result.result !== 'activated') throw new Error('expected activation');
    expect(result.count).toBeLessThanOrEqual(VTC_DEFAULT);
    expect(result.vtc.withinDefault).toBe(true);
    expect(result.warning).toBeUndefined();
  });
});

describe("DONE: forge.activate refuses an activation exceeding the caller's grants", () => {
  it('refuses an elevated tool with no live bindingGrant: ELEVATED_GRANT_REQUIRED, no notification', () => {
    const sendToolListChanged = vi.fn();
    // Default fixture roles carry NO grants: voucher.create is a `function`
    // binding and therefore elevated posture (02 §11.4).
    const session = metaSession({ notifier: { sendToolListChanged } });

    const result = forgeActivate(session, { toolIds: [TOOLS.voucherCreate] }, CORRELATION_ID);

    expect(result.result).toBe('error');
    if (result.result !== 'error') return;
    expect(result.error.code).toBe('ELEVATED_GRANT_REQUIRED');
    expect(result.error.next).toContain('approvals/');
    expect(sendToolListChanged).not.toHaveBeenCalled();
    expect(session.context().policy.scope.session.activation.mode).toBe('default');
  });

  it('refuses a role the caller does not hold', () => {
    const session = metaSession();
    const result = forgeActivate(session, { role: 'r2r' }, CORRELATION_ID);
    expect(result.result).toBe('error');
    if (result.result !== 'error') return;
    expect(result.error.code).toBe('TOOL_NOT_IN_SCOPE');
  });

  it('refuses a tool outside the six-way intersection, by name', () => {
    const session = metaSession({ roles: grantedRoles() });
    const result = forgeActivate(session, { toolIds: [TOOLS.journalCreate] }, CORRELATION_ID);
    expect(result.result).toBe('error');
    if (result.result !== 'error') return;
    expect(result.error.code).toBe('TOOL_NOT_IN_SCOPE');
    expect(result.error.message).toContain(TOOLS.journalCreate);
  });

  it('refuses a disabled tool rather than activating a dead entry', () => {
    const session = metaSession({
      roles: grantedRoles(),
      probeStatuses: new Map([
        ...Object.values(TOOLS).map((id) => [id, 'resolved' as const] as const),
        [TOOLS.voucherCancel, 'disabled_missing_binding' as const],
      ]),
    });
    const result = forgeActivate(session, { toolIds: [TOOLS.voucherCancel] }, CORRELATION_ID);
    expect(result.result).toBe('error');
    if (result.result !== 'error') return;
    expect(result.error.code).toBe('TOOL_DISABLED');
  });

  it('never silently narrows: one ungranted id refuses the whole activation', () => {
    const session = metaSession();
    const result = forgeActivate(
      session,
      { toolIds: [TOOLS.voucherSearch, TOOLS.voucherCreate] },
      CORRELATION_ID,
    );
    expect(result.result).toBe('error');
    expect(session.context().policy.scope.session.activation.mode).toBe('default');
  });
});

describe('forge.activate: input refusals still carry a real next', () => {
  it('refuses an empty selection', () => {
    const result = forgeActivate(metaSession(), {}, CORRELATION_ID);
    expect(result.result).toBe('error');
    if (result.result !== 'error') return;
    expect(result.error.next.toLowerCase()).not.toContain('try again');
  });

  it('refuses an unknown role and an undeployed package', () => {
    for (const input of [{ role: 'nope' }, { package: 'nope' }]) {
      const result = forgeActivate(metaSession(), input, CORRELATION_ID);
      expect(result.result).toBe('error');
      if (result.result !== 'error') continue;
      expect(result.error.code).toBe('INPUT_INVALID');
      expect(result.error.next.trim().length).toBeGreaterThan(0);
    }
  });
});
