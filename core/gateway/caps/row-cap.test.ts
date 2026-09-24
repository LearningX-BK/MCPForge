import { describe, expect, it } from 'vitest';
import { HARD_CEILINGS } from './ceilings.js';
import { resolveEffectiveCaps } from './overlay.js';
import { effectiveRowCap, enforceRowCap } from './row-cap.js';

const CAPS = resolveEffectiveCaps(null);

describe('effectiveRowCap', () => {
  it('falls back to the effective ceiling when the manifest declares no cap', () => {
    expect(effectiveRowCap(undefined, CAPS)).toBe(CAPS.rowCap);
  });

  it('honours a manifest cap tighter than the ceiling', () => {
    expect(effectiveRowCap(50, CAPS)).toBe(50);
  });

  it('never lets a manifest cap exceed the ceiling', () => {
    expect(effectiveRowCap(HARD_CEILINGS.rowCap + 1_000, CAPS)).toBe(HARD_CEILINGS.rowCap);
  });
});

describe('enforceRowCap', () => {
  it('passes silently when under the cap', () => {
    expect(() =>
      enforceRowCap({
        toolId: 'jde.ap.voucher.search',
        correlationId: 'req_1',
        rowCount: 10,
        manifestRowCap: 100,
        effectiveCaps: CAPS,
        narrowingParams: ['dateFrom', 'dateTo'],
      }),
    ).not.toThrow();
  });

  it('REFUSES with ROW_CAP_EXCEEDED and a next naming the narrowing parameter, when exceeded', () => {
    try {
      enforceRowCap({
        toolId: 'jde.ap.voucher.search',
        correlationId: 'req_2',
        rowCount: 101,
        manifestRowCap: 100,
        effectiveCaps: CAPS,
        narrowingParams: ['dateFrom', 'dateTo'],
      });
      throw new Error('expected enforceRowCap to throw');
    } catch (err) {
      const forgeErr = err as { code: string; next: string };
      expect(forgeErr.code).toBe('ROW_CAP_EXCEEDED');
      expect(forgeErr.next).toContain('dateFrom');
      expect(forgeErr.next).toContain('dateTo');
      expect(forgeErr.next.trim().length).toBeGreaterThan(0);
    }
  });

  it('re-checks against the effective (overlay-tightened) ceiling, not just the manifest value', () => {
    const tightCaps = resolveEffectiveCaps({ rowCap: 5 });
    expect(() =>
      enforceRowCap({
        toolId: 'jde.ap.voucher.search',
        correlationId: 'req_3',
        rowCount: 10,
        manifestRowCap: 100, // manifest asks for 100, overlay tightened the ceiling to 5
        effectiveCaps: tightCaps,
        narrowingParams: ['dateFrom'],
      }),
    ).toThrow();
  });

  it('is a coding error, not a silent pass, for a row-capped call declaring no narrowingParams', () => {
    expect(() =>
      enforceRowCap({
        toolId: 'jde.ap.voucher.search',
        correlationId: 'req_4',
        rowCount: 999_999,
        effectiveCaps: CAPS,
        narrowingParams: [],
      }),
    ).toThrow(/narrowingParams/);
  });
});
