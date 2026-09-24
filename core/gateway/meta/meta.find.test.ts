// MCPForge — W0-G4 `done:` clauses 4 and 5, and 02 §4.5 / §11.4.5's one
// shared resolution:
//
//   "a disabled tool is excluded from `tools/list` but still findable through
//    `forge.find` with its `agentMessage`"
//
//   [P5] "a tool the session lacks an elevated grant for is excluded from
//    `tools/list` by the six-way intersection but remains findable through
//    `forge.find` with a per-result `access: 'requires_grant'` and an
//    `agentMessage` naming the grant and its approver"
//
// Both are asserted against the SAME code path (`resolveDiscovery`), because
// 02 §11.4.5 says in as many words that the second reuses the first rather
// than inventing a parallel mechanism.

import { describe, expect, it } from 'vitest';
import { consumer } from '../scope/scope.fixtures.js';
import { forgeFind } from './find.js';
import { functionGrant, role } from '../policy/policy.fixtures.js';
import { metaContext, TOOLS } from './meta.fixtures.js';
import { resolveDiscovery } from './visibility.js';
import type { PolicyRoleView } from '../policy/index.js';

/** p2p carrying a live `function` grant naming the voucher orchestration. */
function grantedRoles(): ReadonlyMap<string, PolicyRoleView> {
  return new Map<string, PolicyRoleView>([
    ['p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] })],
    ['o2c', role({ roleId: 'o2c' })],
    ['r2r', role({ roleId: 'r2r' })],
  ]);
}

function ids(response: ReturnType<typeof forgeFind>): string[] {
  return response.result === 'tools' ? response.tools.map((t) => String(t.card['id'])) : [];
}

describe('forge.find: the ordinary path', () => {
  it('ranks the visible catalogue and returns cards with an access field', () => {
    const response = forgeFind(metaContext({ roles: grantedRoles() }), {
      query: 'create a voucher for a supplier invoice against a PO',
    });
    expect(response.result).toBe('tools');
    if (response.result !== 'tools') return;
    expect(response.tools.length).toBeGreaterThan(0);
    expect(response.tools[0]!.card['id']).toBe(TOOLS.voucherCreate);
    expect(response.tools[0]!.access).toBe('available');
  });

  it('honours the structured filters and the limit (default 5, max 10)', () => {
    const ctx = metaContext({ roles: grantedRoles() });
    expect(ids(forgeFind(ctx, { query: 'create or search a voucher', limit: 2 }))).toHaveLength(2);
    expect(
      ids(forgeFind(ctx, { query: 'create or search a voucher', limit: 99 })).length,
    ).toBeLessThanOrEqual(10);
    const writes = forgeFind(ctx, { query: 'search a voucher', write: false });
    if (writes.result === 'tools') {
      for (const t of writes.tools) expect(t.card['write']).toBe(false);
    }
  });

  it("returns W0-G3's no_tool verdict unchanged when nothing clears the floor", () => {
    const response = forgeFind(metaContext(), { query: 'adjust an employee payroll deduction' });
    expect(response.result).toBe('no_tool');
    if (response.result !== 'no_tool') return;
    expect(response.next).toContain('Do not attempt to approximate it with another tool.');
  });
});

describe('DONE: a disabled tool is excluded from tools/list but findable, with its agentMessage', () => {
  const AGENT_MESSAGE =
    'This capability exists but is disabled: identity could not be verified for this binding. Do not retry; it will not succeed until JDE Finance CoE enables it.';

  function disabledCtx() {
    return metaContext({
      roles: grantedRoles(),
      probeStatuses: new Map([
        ...[...Object.values(TOOLS)].map((id) => [id, 'resolved' as const] as const),
        [TOOLS.voucherSearch, 'disabled_identity_unverified' as const],
      ]),
      agentMessages: new Map([[TOOLS.voucherSearch, AGENT_MESSAGE]]),
    });
  }

  it('is excluded from the tools/list set', () => {
    expect(resolveDiscovery(disabledCtx()).listable).not.toContain(TOOLS.voucherSearch);
  });

  it('is still findable, with access "disabled" and the probe report\'s own agentMessage', () => {
    const response = forgeFind(disabledCtx(), { query: 'search a voucher for supplier invoices' });
    expect(response.result).toBe('tools');
    if (response.result !== 'tools') return;
    const hit = response.tools.find((t) => t.card['id'] === TOOLS.voucherSearch);
    expect(hit).toBeDefined();
    expect(hit!.access).toBe('disabled');
    expect(hit!.agentMessage).toBe(AGENT_MESSAGE);
    expect(hit!.agentMessage!.toLowerCase()).not.toContain('try again');
  });
});

describe('[P5] DONE: a tool with no elevated grant — excluded from tools/list, findable as requires_grant', () => {
  const APPROVER = 'a.steward@ltm.example';

  // The default fixture roles carry NO bindingGrants, so `voucher.create` — a
  // `function` binding, elevated posture (02 §11.4) — has no grant behind it.
  function ungrantedCtx() {
    return metaContext({ approvers: new Map([[TOOLS.voucherCreate, APPROVER]]) });
  }

  it('the six-way intersection still admits it — it is the GRANT that is missing, not visibility', () => {
    expect(resolveDiscovery(ungrantedCtx()).visible).toContain(TOOLS.voucherCreate);
  });

  it('is excluded from the tools/list set', () => {
    expect(resolveDiscovery(ungrantedCtx()).listable).not.toContain(TOOLS.voucherCreate);
  });

  it('is findable, with access "requires_grant" and an agentMessage naming the grant and its approver', () => {
    const response = forgeFind(ungrantedCtx(), {
      query: 'create a voucher for a supplier invoice',
    });
    expect(response.result).toBe('tools');
    if (response.result !== 'tools') return;
    const hit = response.tools.find((t) => t.card['id'] === TOOLS.voucherCreate);
    expect(hit).toBeDefined();
    expect(hit!.access).toBe('requires_grant');
    expect(hit!.agentMessage).toContain('bindingGrant');
    expect(hit!.agentMessage).toContain('ORCH_AP_VOUCHER_CREATE'); // the grant's named target
    expect(hit!.agentMessage).toContain(APPROVER); // its approver
    expect(hit!.agentMessage!.toLowerCase()).not.toContain('try again');
  });

  it('becomes listable and "available" once a live, recorded grant is held', () => {
    const ctx = metaContext({ roles: grantedRoles() });
    const discovery = resolveDiscovery(ctx);
    expect(discovery.listable).toContain(TOOLS.voucherCreate);
    expect(discovery.access.get(TOOLS.voucherCreate)?.level).toBe('available');
  });

  it('still names the grant when the deployment can name no approver', () => {
    const response = forgeFind(metaContext(), { query: 'create a voucher for a supplier invoice' });
    if (response.result !== 'tools') throw new Error('expected tools');
    const hit = response.tools.find((t) => t.card['id'] === TOOLS.voucherCreate)!;
    expect(hit.agentMessage).toContain('approvals/');
    expect(hit.agentMessage!.trim().length).toBeGreaterThan(0);
  });
});

describe('find never widens beyond the two reachable exclusions', () => {
  it('a tool refused by Granted is neither listable nor findable', () => {
    // `journal.create` is r2r-only and the fixture principal holds p2p + o2c.
    const discovery = resolveDiscovery(metaContext());
    expect(discovery.listable).not.toContain(TOOLS.journalCreate);
    expect(discovery.findable.has(TOOLS.journalCreate)).toBe(false);
    expect(
      ids(forgeFind(metaContext(), { query: 'create a general ledger journal' })),
    ).not.toContain(TOOLS.journalCreate);
  });

  it('a tool refused by Deployed is neither listable nor findable', () => {
    // `voucher.get` is only in the undeployed `jde-hr` package.
    const discovery = resolveDiscovery(metaContext());
    expect(discovery.findable.has(TOOLS.voucherGet)).toBe(false);
  });

  it('a tool refused by ConsumerAuthorized is neither listable nor findable', () => {
    const discovery = resolveDiscovery(
      metaContext({ consumer: consumer({ authorizations: { maxSensitivity: 'internal' } }) }),
    );
    // `voucher.explain` is `personal` sensitivity, above the consumer's ceiling.
    expect(discovery.findable.has(TOOLS.voucherExplain)).toBe(false);
  });
});
