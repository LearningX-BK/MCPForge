import { describe, expect, it } from 'vitest';
import { CAP_NAMES, HARD_CEILINGS, resolveEffectiveCaps } from '@mcpforge/gateway/caps';

import { loadCapRows, loadGuardrailRows } from './policy';

describe('loadCapRows — two numbers, never one', () => {
  const rows = loadCapRows();

  it('covers every capped quantity the gateway defines, and no others', () => {
    expect(rows.map((r) => r.name).sort()).toEqual([...CAP_NAMES].sort());
  });

  it('shows the compiled-in hard ceiling from the gateway constant itself', () => {
    for (const row of rows) {
      expect(row.hardCeiling).toBe(HARD_CEILINGS[row.name]);
    }
  });

  it('keeps the overlay value and the ceiling separate, and reports the real merge', () => {
    const effective = resolveEffectiveCaps(
      Object.fromEntries(
        rows.filter((r) => r.overlayValue !== null).map((r) => [r.name, r.overlayValue!]),
      ),
    );
    for (const row of rows) {
      // The third column is `resolveEffectiveCaps`'s answer, not a re-derivation.
      expect(row.effective).toBe(effective[row.name]);
      // And it can never exceed the ceiling — the one-directional rule.
      expect(row.effective).toBeLessThanOrEqual(row.hardCeiling);
    }
  });

  it('reports "not tightened" as null rather than as the ceiling wearing the overlay\'s clothes', () => {
    // Wave 0 ships no overlays/local/caps.yaml.
    for (const row of rows) {
      if (row.overlayValue === null) expect(row.effective).toBe(row.hardCeiling);
    }
  });
});

describe('loadGuardrailRows', () => {
  const rows = loadGuardrailRows();

  it('finds the catalogue\'s declared guardrails and names the tools that carry each', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.kind).not.toBe('');
      expect(row.toolIds.length).toBeGreaterThan(0);
    }
  });

  it('reads the maxNumeric amount ceiling on the voucher-create tool from its manifest', () => {
    const found = rows.find(
      (r) => r.kind === 'maxNumeric' && r.toolIds.includes('jde.ap.voucher.create'),
    );
    expect(found).toBeDefined();
    expect(found!.field).toBe('amount');
    expect(found!.threshold).toContain('250000');
  });
});
