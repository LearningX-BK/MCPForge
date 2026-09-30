// MCPForge — W0-P3d: the call page states a reversal contract only from what
// the audit row and the committed manifest (at the call's version) hold.
import { describe, expect, it } from 'vitest';

import { resolveRepoRoot } from '../../../build/_lib/repo-root';
import { getActivityCall } from '../../fixtures';
import { reversalContractFor } from './reversal-facts';

const ROOT = resolveRepoRoot();
const base = getActivityCall('call_ex4402')!;
const executed = {
  ...base,
  toolId: 'jde.ap.voucher.create',
  toolVersion: '1.0.0',
  ts: '2026-09-01T00:00:00.000Z',
  reversal: undefined,
};

describe('reversalContractFor', () => {
  it('takes class and tool from the row, and window and preconditions from the manifest at the same version', () => {
    expect(reversalContractFor(executed, ROOT)).toEqual({
      class: 'compensating-tool',
      tool: 'jde.ap.voucher.cancel',
      toolHref: '/catalog/jde.ap.voucher.cancel',
      windowHours: 720,
      windowEndsAt: '2026-10-01T00:00:00.000Z',
      preconditions: 'Voucher must be unpaid and not yet posted to a closed period.',
    });
  });

  it('states no window when the committed manifest is a different version', () => {
    const contract = reversalContractFor({ ...executed, toolVersion: '0.9.0' }, ROOT);
    expect(contract?.class).toBe('compensating-tool');
    expect(contract?.windowHours).toBeUndefined();
    expect(contract?.windowEndsAt).toBeUndefined();
  });

  it('states nothing when the row records no class, never an assumed irreversible', () => {
    expect(reversalContractFor({ ...executed, reversalClass: undefined }, ROOT)).toBeUndefined();
  });

  it('states nothing for a read, a plan or a reverse row', () => {
    expect(reversalContractFor({ ...executed, isWrite: false }, ROOT)).toBeUndefined();
    expect(reversalContractFor({ ...executed, phase: 'plan' }, ROOT)).toBeUndefined();
    expect(reversalContractFor({ ...executed, phase: 'reverse' }, ROOT)).toBeUndefined();
  });
});
