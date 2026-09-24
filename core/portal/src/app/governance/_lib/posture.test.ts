import { describe, expect, it } from 'vitest';

import {
  deriveRows,
  loadCatalogueBindingTypes,
  loadPostureRows,
  type ProbeSnapshot,
} from './posture';
import type { BindingType } from '../types';

const catalogue = new Map<string, readonly BindingType[]>([
  ['jde', ['function']],
  ['oic', ['rest']],
]);

function probe(entries: ProbeSnapshot['tools']): ProbeSnapshot {
  return { reference: 'probe run local @ 2026-09-09T00:00:00.000Z', tools: entries };
}

describe('CLAUDE.md non-negotiable #2 — identity carriage comes from the probe or not at all', () => {
  it('renders no verdict when no probe has reported', () => {
    const rows = deriveRows(catalogue, { reference: null, tools: [] });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.identityCarries).toBeNull();
      expect(row.probeReference).toBeNull();
      // A row with no probe evidence is never highlighted as an exception
      // either — "we do not know" is not "it failed".
      expect(row.exception).toBe(false);
      expect(row.note).toContain('No probe evidence');
    }
  });

  it('a verdict and its probe reference are always both present or both absent', () => {
    const rows = deriveRows(
      catalogue,
      probe([
        {
          toolId: 'jde.ap.voucher.create',
          bindingType: 'function',
          identity: {
            carries: 'verified',
            observedIdentity: 'a.user',
            disposition: null,
            detail: 'Target reported executing as a.user.',
          },
        },
      ]),
    );
    for (const row of rows) {
      expect(row.identityCarries === null).toBe(row.probeReference === null);
    }
  });

  it('the binding-type chips still come from the catalogue, not from the probe', () => {
    const rows = deriveRows(catalogue, { reference: null, tools: [] });
    expect(rows.find((r) => r.application === 'jde')!.bindingTypes).toEqual(['function']);
  });
});

describe('the service-account exception row', () => {
  const rows = deriveRows(
    catalogue,
    probe([
      {
        toolId: 'jde.ap.voucher.create',
        bindingType: 'function',
        identity: {
          carries: 'verified',
          observedIdentity: 'a.user',
          disposition: null,
          detail: 'Target reported executing as a.user.',
        },
      },
      {
        toolId: 'oic.int.invoice.run_process',
        bindingType: 'rest',
        identity: {
          carries: 'no',
          observedIdentity: 'OIC_INTEGRATION_USER',
          disposition: 'readonly-lowsens',
          detail: 'Target reported executing as OIC_INTEGRATION_USER, not the calling human.',
        },
      },
    ]),
  );

  it('is highlighted for the application whose PROBE reported non-carriage', () => {
    const oic = rows.find((r) => r.application === 'oic')!;
    expect(oic.exception).toBe(true);
    expect(oic.identityCarries).toBe('no');
    expect(oic.nonCarriageDisposition).toBe('readonly-lowsens');
    expect(oic.enforcedBy).toContain('OIC_INTEGRATION_USER');
  });

  it('is not raised for an application the probe found carrying identity', () => {
    expect(rows.find((r) => r.application === 'jde')!.exception).toBe(false);
  });

  it('takes the WEAKEST verdict across an application\'s tools', () => {
    const mixed = deriveRows(
      new Map([['oic', ['rest'] as readonly BindingType[]]]),
      probe([
        {
          toolId: 'oic.int.a.get',
          bindingType: 'rest',
          identity: { carries: 'verified', observedIdentity: 'u', disposition: null, detail: 'ok' },
        },
        {
          toolId: 'oic.int.b.run_process',
          bindingType: 'rest',
          identity: {
            carries: 'no',
            observedIdentity: 'SVC',
            disposition: 'block',
            detail: 'service account',
          },
        },
      ]),
    );
    expect(mixed[0]!.identityCarries).toBe('no');
    expect(mixed[0]!.exception).toBe(true);
  });
});

describe('loadCatalogueBindingTypes / loadPostureRows against the real repo', () => {
  it('computes binding types in play from the deployed catalogue', () => {
    const map = loadCatalogueBindingTypes();
    expect(map.get('jde')).toBeDefined();
    expect(map.get('jde')!.length).toBeGreaterThan(0);
  });

  it('claims nothing about identity in a repo where no probe has run', () => {
    for (const row of loadPostureRows()) {
      if (row.probeReference === null) expect(row.identityCarries).toBeNull();
    }
  });
});
