// MCPForge — Wave 0 exit criterion 6: "One P2P role spans all three servers and
// grants exactly its declared scope."
//
// EXACTLY. Not "at least" and not "roughly": the assertion below is a set
// equality against the role's compiled tool-id list, so a tool leaking in from
// another role, another server or another package fails the test. This is the
// end-to-end scope proof, run through the same `resolveScope` the gateway's
// `tools/list` uses — not through a predicate in isolation.

import { describe, expect, it } from 'vitest';
import { resolveScope, scopeRefusalError } from './resolve.js';
import { CATALOGUE, ROLE_SCOPES, TOOLS, consumer, context } from './scope.fixtures.js';

/** A consumer wide enough to narrow nothing, so the role is the only lens. */
function unrestrictedConsumer() {
  return consumer({
    authorizations: {
      bindingTypes: ['rest', 'database', 'plsql', 'function', 'wrapped-vendor'],
      maxSensitivity: 'personal',
      writeAllowed: true,
      roles: ['p2p', 'r2r', 'o2c'],
      packages: ['jde-fin', 'jde-hr'],
    },
  });
}

function p2pSession() {
  return context({
    heldRoleIds: ['p2p'],
    consumer: unrestrictedConsumer(),
    deployedPackageIds: ['jde-fin', 'jde-hr'],
  });
}

const P2P_TOOLS = [...(ROLE_SCOPES.get('p2p') ?? [])].sort();

describe('Wave 0 exit criterion 6 — a P2P role holder sees exactly the P2P tools', () => {
  it('sees the P2P role scope, and nothing else', () => {
    expect(resolveScope(CATALOGUE, p2pSession()).visible).toEqual(P2P_TOOLS);
  });

  it('the P2P scope spans more than one module server', () => {
    const servers = new Set(
      CATALOGUE.filter((e) => P2P_TOOLS.includes(e.toolId)).map((e) => e.serverId),
    );
    expect(servers.size).toBeGreaterThan(1);
  });

  it('no tool from another process role leaks in', () => {
    const visible = new Set(resolveScope(CATALOGUE, p2pSession()).visible);
    for (const roleId of ['r2r', 'o2c']) {
      for (const toolId of ROLE_SCOPES.get(roleId) ?? []) {
        expect(visible.has(toolId)).toBe(false);
      }
    }
  });

  it("refuses another role's tool with TOOL_NOT_IN_SCOPE", () => {
    const resolution = resolveScope(CATALOGUE, p2pSession());
    for (const toolId of [TOOLS.journalCreate, TOOLS.salesOrderCreate]) {
      const err = scopeRefusalError(toolId, resolution, 'corr-p2p');
      expect(err?.code).toBe('TOOL_NOT_IN_SCOPE');
      expect(resolution.refusals.get(toolId)?.predicate).toBe('Granted');
    }
  });

  it('holding a second role widens the set by exactly that role, and no further', () => {
    const oneRole = new Set(resolveScope(CATALOGUE, p2pSession()).visible);
    const twoRoles = resolveScope(
      CATALOGUE,
      context({
        heldRoleIds: ['p2p', 'o2c'],
        consumer: unrestrictedConsumer(),
        deployedPackageIds: ['jde-fin', 'jde-hr'],
      }),
    ).visible;
    expect(twoRoles.slice().sort()).toEqual(
      [...P2P_TOOLS, ...(ROLE_SCOPES.get('o2c') ?? [])].sort(),
    );
    for (const id of oneRole) expect(twoRoles).toContain(id);
  });

  it('a consumer narrower than the role wins, and says so with its own code', () => {
    const resolution = resolveScope(
      CATALOGUE,
      context({
        heldRoleIds: ['p2p'],
        consumer: consumer({
          authorizations: {
            bindingTypes: ['rest'],
            maxSensitivity: 'internal',
            writeAllowed: false,
            roles: ['p2p'],
            packages: ['jde-fin', 'jde-hr'],
          },
        }),
        deployedPackageIds: ['jde-fin', 'jde-hr'],
      }),
    );
    // A strict subset of what the human alone would see — never a superset.
    for (const id of resolution.visible) expect(P2P_TOOLS).toContain(id);
    expect(resolution.visible.length).toBeLessThan(P2P_TOOLS.length);
    expect(scopeRefusalError(TOOLS.voucherCreate, resolution, 'c')?.code).toBe(
      'CONSUMER_NOT_AUTHORIZED',
    );
  });
});
