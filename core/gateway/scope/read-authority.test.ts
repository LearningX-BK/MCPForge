// W0-P3a — the READ authority behind `/api/v1/**` (owner decision, 27 Sep 2026).
//
// It is Deployed ∩ Granted ∩ ConsumerAuthorized: who MAY see a tool's runtime
// records. It must NOT depend on what works now (probe, kill switch) or on a
// per-session lens (activation), and each of its three predicates must still
// be load-bearing.

import { describe, expect, it } from 'vitest';
import { READ_AUTHORITY_PREDICATES, resolveReadAuthority, resolveScope } from './resolve.js';
import { CATALOGUE, TOOLS, ALL_TOOL_IDS, consumer, context } from './scope.fixtures.js';
import type { ProbeStatus, ToolId } from './types.js';

describe('resolveReadAuthority', () => {
  it('is exactly the three authority predicates, frozen', () => {
    expect(READ_AUTHORITY_PREDICATES.map((p) => p.name)).toEqual([
      'Deployed',
      'Granted',
      'ConsumerAuthorized',
    ]);
    expect(Object.isFrozen(READ_AUTHORITY_PREDICATES)).toBe(true);
  });

  it('does not hide history when no probe report exists, where tools/list shows nothing', () => {
    const ctx = context({ probeStatuses: new Map<ToolId, ProbeStatus>() });
    expect(resolveScope(CATALOGUE, ctx).visible).toEqual([]);
    expect(resolveReadAuthority(CATALOGUE, ctx).visible).toContain(TOOLS.voucherCreate);
  });

  it('does not hide a kill-switched tool from the people granted it', () => {
    const ctx = context({
      flags: [{ scope: 'tool', target: TOOLS.voucherCreate, reason: 'incident', until: null }],
    });
    expect(resolveScope(CATALOGUE, ctx).visible).not.toContain(TOOLS.voucherCreate);
    expect(resolveReadAuthority(CATALOGUE, ctx).visible).toContain(TOOLS.voucherCreate);
  });

  it('ignores an activation lens: a stateless read has none', () => {
    const lens = context({ activation: { mode: 'explicit', toolIds: new Set<ToolId>() } });
    expect(resolveReadAuthority(CATALOGUE, lens).visible).toEqual(
      resolveReadAuthority(CATALOGUE, context()).visible,
    );
  });

  it('still refuses a tool the human holds no role for (Granted)', () => {
    const none = context({ heldRoleIds: [] });
    expect(resolveReadAuthority(CATALOGUE, none).visible).toEqual([]);
    // journal.create is granted only by r2r, which the default human lacks.
    expect(resolveReadAuthority(CATALOGUE, context()).visible).not.toContain(TOOLS.journalCreate);
  });

  it('still refuses what the consumer is not authorized for (ConsumerAuthorized)', () => {
    const narrow = context({ consumer: consumer({ authorizations: { bindingTypes: [] } }) });
    expect(resolveReadAuthority(CATALOGUE, narrow).visible).toEqual([]);
  });

  it('still refuses what is not deployed here (Deployed)', () => {
    const nothingDeployed = context({ deployedPackageIds: [] });
    expect(resolveReadAuthority(CATALOGUE, nothingDeployed).visible).toEqual([]);
  });

  it('is never wider than the catalogue it was given', () => {
    const visible = resolveReadAuthority(CATALOGUE, context()).visible;
    for (const id of visible) expect(ALL_TOOL_IDS).toContain(id);
  });
});
