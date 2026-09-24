// MCPForge — W0-N12: the pure half of the Consumers tab.
//
// The thresholds here are 03 §16.2's own numbers ("`--status-write` within 30
// days of expiry, `--status-danger` past it"), so they are tested at the
// boundary rather than in the middle: 31 days is not yet a warning, 30 days is,
// 0 days is, and past is danger. A threshold tested only at 5 and 500 days
// would pass with the comparison written the wrong way round.
import { describe, expect, it } from 'vitest';

import {
  EXPIRY_WARNING_DAYS,
  buildCompiledView,
  canProposeEdit,
  daysBetween,
  grantExpiryView,
  grantRow,
  listDelta,
  proposalFiles,
  sortGrants,
  standingView,
} from './authorization-view';

const TODAY = '2026-09-10';

describe('daysBetween', () => {
  it('counts whole days forward and backward, and refuses a non-ISO date', () => {
    expect(daysBetween('2026-09-10', '2026-09-11')).toBe(1);
    expect(daysBetween('2026-09-10', '2026-09-09')).toBe(-1);
    expect(daysBetween('2026-09-10', '2026-10-10')).toBe(30);
    expect(daysBetween('2026-09-10', 'soon')).toBeNull();
    expect(daysBetween('', '2026-09-10')).toBeNull();
  });
});

describe('grantExpiryView — 03 §16.2\'s two chip thresholds, at the boundary', () => {
  it('31 days out is neither warning nor danger', () => {
    const view = grantExpiryView('2026-10-11', false, TODAY);
    expect(view.daysRemaining).toBe(31);
    expect(view.state).toBe('live');
    expect(view.token).toBe('status-ok');
  });

  it('exactly 30 days out is --status-write', () => {
    const view = grantExpiryView('2026-10-10', false, TODAY);
    expect(view.daysRemaining).toBe(EXPIRY_WARNING_DAYS);
    expect(view.state).toBe('expiring');
    expect(view.token).toBe('status-write');
  });

  it('one day out is --status-write and reads in the singular', () => {
    const view = grantExpiryView('2026-09-11', false, TODAY);
    expect(view.token).toBe('status-write');
    expect(view.label).toBe('Expires in 1 day');
  });

  it('past expiry is --status-danger', () => {
    const view = grantExpiryView('2026-09-09', true, TODAY);
    expect(view.state).toBe('expired');
    expect(view.token).toBe('status-danger');
    expect(view.label).toContain('2026-09-09');
  });

  it("the COMPILER's expired verdict wins over the date — it can never be softened here", () => {
    // A grant the compiler calls expired renders as danger even with a
    // far-future date. `grantIsExpired` is fail-closed and this projection must
    // not second-guess it.
    const view = grantExpiryView('2099-01-01', true, TODAY);
    expect(view.state).toBe('expired');
    expect(view.token).toBe('status-danger');
  });

  it('an unusable expiry compiles to expired and says so, never "no expiry, so fine"', () => {
    const view = grantExpiryView('', true, TODAY);
    expect(view.token).toBe('status-danger');
    expect(view.srLabel).toContain('authorizes nothing');
  });

  it('every state carries a non-empty accessible label that expands the chip', () => {
    for (const [expiresAt, expired] of [
      ['2026-12-31', false],
      ['2026-09-20', false],
      ['2026-01-01', true],
      ['', true],
    ] as const) {
      const view = grantExpiryView(expiresAt, expired, TODAY);
      expect(view.label.trim()).not.toBe('');
      expect(view.srLabel.trim()).not.toBe('');
      expect(view.srLabel.length).toBeGreaterThan(view.label.length);
    }
  });
});

describe('standingView — the resolved record, never re-resolved', () => {
  it('an active standing authorization keeps its approver, own expiry and effective flag', () => {
    const view = standingView(
      {
        ref: 'APR-2026-014',
        status: 'active',
        approver: 'meera.rao',
        expiresAt: '2027-01-01',
        effective: true,
      },
      TODAY,
    );
    expect(view).not.toBeNull();
    expect(view!.approver).toBe('meera.rao');
    expect(view!.expiresAt).toBe('2027-01-01');
    expect(view!.effective).toBe(true);
    expect(view!.expiry.token).toBe('status-ok');
  });

  it('an INEFFECTIVE standing authorization is chipped danger whatever its date says', () => {
    const view = standingView(
      {
        ref: 'APR-missing',
        status: 'unresolved',
        approver: '',
        expiresAt: '2099-01-01',
        effective: false,
      },
      TODAY,
    );
    expect(view!.expiry.token).toBe('status-danger');
    expect(view!.status).toBe('unresolved');
  });

  it('a grant with no standing authorization has none — never a fabricated one', () => {
    expect(standingView(undefined, TODAY)).toBeNull();
    expect(grantRow({ bindingType: 'plsql', expiresAt: '2027-01-01' }, TODAY)!.standing).toBeNull();
  });
});

describe('grantRow', () => {
  it('reads every 02 §11.4 field off the compiled entry', () => {
    const row = grantRow(
      {
        bindingType: 'plsql',
        names: ['MCPFORGE_WRAP.AP_VOUCHER'],
        approvalRef: 'APR-2026-009',
        approver: 'priya.n',
        expiresAt: '2026-09-25',
        expired: false,
        standingAuthorization: {
          ref: 'APR-2026-014',
          status: 'active',
          approver: 'meera.rao',
          expiresAt: '2027-01-01',
          effective: true,
        },
      },
      TODAY,
    );
    expect(row).not.toBeNull();
    expect(row!.bindingType).toBe('plsql');
    expect(row!.names).toEqual(['MCPFORGE_WRAP.AP_VOUCHER']);
    expect(row!.approver).toBe('priya.n');
    expect(row!.approvalRef).toBe('APR-2026-009');
    expect(row!.expiry.token).toBe('status-write');
    expect(row!.standing!.approver).toBe('meera.rao');
  });
});

describe('sortGrants — an operator sees the dead and the dying first', () => {
  it('orders expired, then expiring, then live', () => {
    const rows = [
      grantRow({ bindingType: 'c', expiresAt: '2027-01-01', expired: false }, TODAY)!,
      grantRow({ bindingType: 'b', expiresAt: '2026-09-20', expired: false }, TODAY)!,
      grantRow({ bindingType: 'a', expiresAt: '2026-01-01', expired: true }, TODAY)!,
    ];
    expect(sortGrants(rows).map((g) => g.expiry.state)).toEqual([
      'expired',
      'expiring',
      'live',
    ]);
  });
});

describe('listDelta', () => {
  it('reports added and removed as sorted sets, and keeps the removed value visible', () => {
    const delta = listDelta('roles', ['p2p', 'r2r'], ['p2p', 'o2c']);
    expect(delta.values).toEqual(['o2c', 'p2p']);
    expect(delta.added).toEqual(['o2c']);
    expect(delta.removed).toEqual(['r2r']);
  });
});

const ARTEFACT = JSON.stringify({
  consumerId: 'claude-desktop-fin',
  label: 'Claude Desktop — finance',
  class: 'interactive-client',
  status: 'active',
  expiresAt: '2027-01-31',
  expired: false,
  effectiveStatus: 'active',
  authorizations: {
    bindingTypes: ['plsql', 'rest'],
    maxSensitivity: 'financial',
    writeAllowed: true,
    roles: ['p2p'],
    packages: ['jde-fin'],
  },
  limits: { callsPerMinute: 60, concurrentSessions: 2, writesPerDay: 20 },
  attestation: { humanInTheLoop: true, networkOrigins: [] },
  bindingGrants: [
    {
      bindingType: 'plsql',
      names: ['MCPFORGE_WRAP.AP_VOUCHER'],
      approvalRef: 'APR-2026-009',
      approver: 'priya.n',
      expiresAt: '2026-09-20',
      expired: false,
    },
  ],
});

const MERGED = JSON.stringify({
  effectiveStatus: 'active',
  authorizations: {
    bindingTypes: ['rest'],
    maxSensitivity: 'internal',
    writeAllowed: false,
    roles: ['p2p'],
    packages: [],
  },
  attestation: { humanInTheLoop: true },
});

describe('buildCompiledView — every authorization dimension, explicitly, diffed', () => {
  it('renders each dimension and marks what this edit widens', () => {
    const view = buildCompiledView('claude-desktop-fin', ARTEFACT, MERGED, TODAY)!;
    expect(view.bindingTypes).toEqual(['plsql', 'rest']);
    expect(view.roles).toEqual(['p2p']);
    expect(view.packages).toEqual(['jde-fin']);
    expect(view.maxSensitivity).toBe('financial');
    expect(view.writeAllowed).toBe(true);
    expect(view.limits.map((l) => l.field)).toEqual([
      'callsPerMinute',
      'concurrentSessions',
      'writesPerDay',
    ]);

    const bindingTypes = view.listDeltas.find((d) => d.field === 'bindingTypes')!;
    expect(bindingTypes.added).toEqual(['plsql']);
    expect(bindingTypes.removed).toEqual([]);
    const packages = view.listDeltas.find((d) => d.field === 'packages')!;
    expect(packages.added).toEqual(['jde-fin']);

    // The two most consequential widenings are named as scalar changes.
    const fields = view.scalarDeltas.map((d) => d.field);
    expect(fields).toContain('maxSensitivity');
    expect(fields).toContain('writeAllowed');
    expect(view.scalarDeltas.find((d) => d.field === 'writeAllowed')).toEqual({
      field: 'writeAllowed',
      before: 'false',
      after: 'true',
    });
  });

  it('a FIRST registration diffs against nothing and reports the whole grant as added', () => {
    const view = buildCompiledView('claude-desktop-fin', ARTEFACT, '', TODAY)!;
    const bindingTypes = view.listDeltas.find((d) => d.field === 'bindingTypes')!;
    expect(bindingTypes.added).toEqual(['plsql', 'rest']);
    expect(view.scalarDeltas.map((d) => d.field)).toContain('effectiveStatus');
  });

  it('carries every compiled bindingGrant through with its chip', () => {
    const view = buildCompiledView('claude-desktop-fin', ARTEFACT, MERGED, TODAY)!;
    expect(view.grants).toHaveLength(1);
    expect(view.grants[0]!.expiry.token).toBe('status-write');
  });

  it('returns null rather than a plausible-looking view when the artefact is not JSON', () => {
    expect(buildCompiledView('x', 'not json', '', TODAY)).toBeNull();
  });
});

describe('proposalFiles / canProposeEdit — nothing saves directly', () => {
  const source = {
    path: 'consumers/claude-desktop-fin.consumer.yaml',
    artefactPath: 'generated/consumers/claude-desktop-fin.authorization.json',
    yamlText: 'id: claude-desktop-fin\n',
    isNew: false,
  };

  it('the proposal is the record AND the compiled artefact, with the compiler\'s own bytes', () => {
    const files = proposalFiles(source, 'id: claude-desktop-fin\nstatus: active\n', {
      artefactJson: '{"consumerId":"claude-desktop-fin"}\n',
    });
    expect(Object.keys(files).sort()).toEqual([
      'consumers/claude-desktop-fin.consumer.yaml',
      'generated/consumers/claude-desktop-fin.authorization.json',
    ]);
    expect(files['generated/consumers/claude-desktop-fin.authorization.json']).toBe(
      '{"consumerId":"claude-desktop-fin"}\n',
    );
  });

  it('a failed compile carries NO files — a proposal with no visible authorization change is refused', () => {
    expect(
      proposalFiles(source, 'anything', {
        artefactJson: '',
        error: { message: 'm', next: 'n' },
      }),
    ).toEqual({});
    expect(proposalFiles(source, 'anything', undefined)).toEqual({});
  });

  it('an unchanged record is not proposable; an edited one is', () => {
    const draft = { artefactJson: '{}' };
    expect(canProposeEdit(source, source.yamlText, draft)).toBe(false);
    expect(canProposeEdit(source, 'id: claude-desktop-fin\nstatus: suspended\n', draft)).toBe(true);
    expect(canProposeEdit(source, 'changed', undefined)).toBe(false);
    expect(
      canProposeEdit(source, 'changed', { artefactJson: '', error: { message: 'm', next: 'n' } }),
    ).toBe(false);
  });

  it('a NEW registration is proposable as soon as it compiles', () => {
    expect(canProposeEdit({ ...source, isNew: true }, source.yamlText, { artefactJson: '{}' })).toBe(
      true,
    );
  });
});
