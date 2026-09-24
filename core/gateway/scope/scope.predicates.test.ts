// MCPForge — W0-E2's central proof: each of the six predicates is LOAD-BEARING.
//
// The done criterion is not "six predicates exist". It is "a test per predicate
// proving that removing any one of them widens the set". So each test here
// resolves scope twice against one identical context — once with all six
// predicates, once with that predicate removed — and asserts that the second
// result is a STRICT superset whose extra members are exactly the tools that
// predicate refused. A predicate that had become decorative would produce two
// identical sets and fail its own test.

import { describe, expect, it } from 'vitest';
import { SCOPE_PREDICATES, type ScopePredicateName } from './predicates.js';
import { applyPredicates, resolveScope, scopeRefusalError } from './resolve.js';
import type { ScopeContext } from './types.js';
import {
  CATALOGUE,
  TOOLS,
  ALL_TOOL_IDS,
  consumer,
  context,
  PROBE_ALL_RESOLVED,
} from './scope.fixtures.js';
import type { ProbeStatus, ToolId } from './types.js';

/**
 * One context engineered so that EVERY predicate refuses at least one tool that
 * no other predicate refuses. That isolation is what makes the widening proof
 * attributable: when the set grows, it grew because of the predicate removed.
 */
function baselineContext(): ScopeContext {
  const probe = new Map<ToolId, ProbeStatus>(PROBE_ALL_RESOLVED);
  probe.set(TOOLS.voucherUpdate, 'disabled_schema_drift');
  return context({
    // `jde.fin.journal.create` is granted by r2r, which this human does not hold.
    heldRoleIds: ['p2p', 'o2c'],
    activation: {
      mode: 'explicit',
      toolIds: new Set(ALL_TOOL_IDS.filter((id) => id !== TOOLS.voucherCancel)),
    },
    probeStatuses: probe,
    flags: [
      { scope: 'tool', target: TOOLS.voucherSubmit, reason: 'AP close in progress', until: null },
    ],
  });
}

const BASELINE_VISIBLE = [TOOLS.voucherCreate, TOOLS.voucherSearch, TOOLS.poCreate].sort();

function without(name: ScopePredicateName) {
  return SCOPE_PREDICATES.filter((p) => p.name !== name);
}

/** Resolve with all six, then without `name`; return what removing it added. */
function widening(name: ScopePredicateName): {
  readonly full: readonly ToolId[];
  readonly reduced: readonly ToolId[];
  readonly added: readonly ToolId[];
} {
  const ctx = baselineContext();
  const full = resolveScope(CATALOGUE, ctx).visible;
  const reduced = applyPredicates(CATALOGUE, ctx, without(name)).visible;
  const fullSet = new Set(full);
  return { full, reduced, added: reduced.filter((id) => !fullSet.has(id)) };
}

function expectStrictWidening(name: ScopePredicateName, expectedAdded: readonly ToolId[]): void {
  const { full, reduced, added } = widening(name);
  // Superset: removing a predicate can never REMOVE a tool.
  for (const id of full) expect(reduced).toContain(id);
  // Strict: it must add at least one.
  expect(reduced.length).toBeGreaterThan(full.length);
  expect(added.slice().sort()).toEqual(expectedAdded.slice().sort());
}

describe('visible(session) — the six-way intersection', () => {
  it('resolves to the intersection of all six predicates', () => {
    expect(resolveScope(CATALOGUE, baselineContext()).visible).toEqual(BASELINE_VISIBLE);
  });

  it('runs exactly six named predicates, in refusal-precedence order', () => {
    expect(SCOPE_PREDICATES.map((p) => p.name)).toEqual([
      'Deployed',
      'Granted',
      'ConsumerAuthorized',
      'Activated',
      'ProbeEnabled',
      'NotKillSwitched',
    ]);
  });

  it('is order-independent as a set operation', () => {
    const ctx = baselineContext();
    const reversed = applyPredicates(CATALOGUE, ctx, [...SCOPE_PREDICATES].reverse()).visible;
    expect(reversed).toEqual(resolveScope(CATALOGUE, ctx).visible);
  });
});

describe('each predicate is load-bearing — removing it widens the set', () => {
  it('1. Deployed', () => {
    // jde.ap.voucher.get is selected only into `jde-hr`, which is not deployed.
    expectStrictWidening('Deployed', [TOOLS.voucherGet]);
  });

  it('2. Granted', () => {
    // jde.fin.journal.create is granted by r2r, a role this human does not hold.
    expectStrictWidening('Granted', [TOOLS.journalCreate]);
  });

  it('3. ConsumerAuthorized [P5]', () => {
    // Three separate consumer axes: declared roles, binding type, sensitivity.
    expectStrictWidening('ConsumerAuthorized', [
      TOOLS.salesOrderCreate,
      TOOLS.voucherDownload,
      TOOLS.voucherExplain,
    ]);
  });

  it('4. Activated', () => {
    expectStrictWidening('Activated', [TOOLS.voucherCancel]);
  });

  it('5. ProbeEnabled', () => {
    expectStrictWidening('ProbeEnabled', [TOOLS.voucherUpdate]);
  });

  it('6. NotKillSwitched', () => {
    expectStrictWidening('NotKillSwitched', [TOOLS.voucherSubmit]);
  });
});

describe('refusals carry the right closed-taxonomy code and a real next', () => {
  const ctx = baselineContext();
  const resolution = resolveScope(CATALOGUE, ctx);

  const refusalFor = (toolId: ToolId) => {
    const err = scopeRefusalError(toolId, resolution, 'corr-1');
    expect(err).not.toBeNull();
    return err!;
  };

  it('a visible tool produces no refusal', () => {
    expect(scopeRefusalError(TOOLS.voucherCreate, resolution, 'corr-1')).toBeNull();
  });

  it('the human being too narrow is TOOL_NOT_IN_SCOPE', () => {
    expect(refusalFor(TOOLS.journalCreate).code).toBe('TOOL_NOT_IN_SCOPE');
  });

  it('the CONSUMER being too narrow is CONSUMER_NOT_AUTHORIZED, never TOOL_NOT_IN_SCOPE', () => {
    // 02 §11.3: the two refusals must stay distinct, because they tell an
    // operator whether the client registration or the role is too narrow.
    for (const toolId of [TOOLS.salesOrderCreate, TOOLS.voucherDownload, TOOLS.voucherExplain]) {
      const err = refusalFor(toolId);
      expect(err.code).toBe('CONSUMER_NOT_AUTHORIZED');
      expect(err.code).not.toBe('TOOL_NOT_IN_SCOPE');
    }
  });

  it('a kill switch is TOOL_DISABLED and carries the flag reason verbatim', () => {
    const err = refusalFor(TOOLS.voucherSubmit);
    expect(err.code).toBe('TOOL_DISABLED');
    expect(err.next).toContain('AP close in progress');
  });

  it('an unprobed or failing binding is TOOL_DISABLED', () => {
    expect(refusalFor(TOOLS.voucherUpdate).code).toBe('TOOL_DISABLED');
  });

  it('an unknown tool id is TOOL_NOT_IN_SCOPE, not INPUT_INVALID', () => {
    expect(scopeRefusalError('jde.zzz.thing.get', resolution, 'corr-1')?.code).toBe(
      'TOOL_NOT_IN_SCOPE',
    );
  });

  it('every refusal carries a non-empty, actionable next', () => {
    for (const [, refusal] of resolution.refusals) {
      expect(refusal.next.trim().length).toBeGreaterThan(0);
      expect(refusal.next.toLowerCase()).not.toContain('try again');
      expect(refusal.reason.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('a consumer restricted below its human sees the narrower set', () => {
  it('writeAllowed: false hides every write tool the human legitimately holds', () => {
    const ctx = context({
      heldRoleIds: ['p2p'],
      consumer: consumer({ authorizations: { writeAllowed: false } }),
    });
    const resolution = resolveScope(CATALOGUE, ctx);

    expect(resolution.visible).not.toContain(TOOLS.voucherCreate);
    expect(resolution.visible).toContain(TOOLS.voucherSearch);

    const err = scopeRefusalError(TOOLS.voucherCreate, resolution, 'corr-2');
    expect(err?.code).toBe('CONSUMER_NOT_AUTHORIZED');
    expect(resolution.refusals.get(TOOLS.voucherCreate)?.predicate).toBe('ConsumerAuthorized');
  });

  it('a consumer authorizing fewer binding types narrows, and the human cannot widen it', () => {
    const restricted = resolveScope(
      CATALOGUE,
      context({ consumer: consumer({ authorizations: { bindingTypes: ['rest'] } }) }),
    ).visible;
    const broad = resolveScope(CATALOGUE, context()).visible;
    expect(restricted).not.toContain(TOOLS.voucherCreate); // `function` binding
    expect(broad).toContain(TOOLS.voucherCreate);
    for (const id of restricted) expect(broad).toContain(id);
  });
});

describe('fail-closed behaviour', () => {
  it('a non-active consumer sees nothing, and the refusal is CONSUMER_SUSPENDED', () => {
    for (const status of ['suspended', 'retired', 'expired']) {
      const resolution = resolveScope(
        CATALOGUE,
        context({ consumer: consumer({ effectiveStatus: status }) }),
      );
      expect(resolution.visible).toEqual([]);
      expect(scopeRefusalError(TOOLS.voucherSearch, resolution, 'c')?.code).toBe(
        'CONSUMER_SUSPENDED',
      );
    }
  });

  it('a consumer kill switch refuses with CONSUMER_SUSPENDED, not TOOL_DISABLED', () => {
    const resolution = resolveScope(
      CATALOGUE,
      context({
        flags: [
          {
            scope: 'consumer',
            target: 'claude-desktop-coe',
            reason: 'credential rotation overdue',
            until: null,
          },
        ],
      }),
    );
    expect(resolution.visible).toEqual([]);
    expect(scopeRefusalError(TOOLS.voucherSearch, resolution, 'c')?.code).toBe(
      'CONSUMER_SUSPENDED',
    );
  });

  it('a deployment kill switch empties the catalogue', () => {
    const resolution = resolveScope(
      CATALOGUE,
      context({
        flags: [{ scope: 'deployment', target: 'ltm-dev', reason: 'incident 4471', until: null }],
      }),
    );
    expect(resolution.visible).toEqual([]);
  });

  it('a spent kill switch (until in the past) no longer hides its tool', () => {
    const flags = [
      {
        scope: 'tool' as const,
        target: TOOLS.voucherSearch,
        reason: 'expired hold',
        until: new Date('2026-09-01T00:00:00Z'),
      },
    ];
    expect(resolveScope(CATALOGUE, context({ flags })).visible).toContain(TOOLS.voucherSearch);
  });

  it('no probe report at all means nothing is visible', () => {
    const resolution = resolveScope(CATALOGUE, context({ probeStatuses: new Map() }));
    expect(resolution.visible).toEqual([]);
  });

  it('an empty consumer authorization list authorizes nothing, not everything', () => {
    for (const empty of [{ bindingTypes: [] }, { roles: [] }, { packages: [] }] as const) {
      expect(
        resolveScope(CATALOGUE, context({ consumer: consumer({ authorizations: empty }) })).visible,
      ).toEqual([]);
    }
  });

  it('an unknown role id grants nothing rather than throwing', () => {
    expect(resolveScope(CATALOGUE, context({ heldRoleIds: ['no-such-role'] })).visible).toEqual([]);
  });

  it('a predicate that throws denies the tool with INTERNAL rather than admitting it', () => {
    const exploding = {
      name: 'ProbeEnabled' as ScopePredicateName,
      evaluate(): never {
        throw new Error('probe report unreadable');
      },
    };
    const resolution = applyPredicates(CATALOGUE, baselineContext(), [exploding]);
    expect(resolution.visible).toEqual([]);
    expect(resolution.refusals.get(TOOLS.voucherSearch)?.code).toBe('INTERNAL');
  });
});
