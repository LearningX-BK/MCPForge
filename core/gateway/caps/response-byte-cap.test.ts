import { describe, expect, it } from 'vitest';
import { resolveEffectiveCaps } from './overlay.js';
import { effectiveResponseByteCap, enforceResponseByteCap } from './response-byte-cap.js';

const CAPS = resolveEffectiveCaps(null);

describe('enforceResponseByteCap', () => {
  it('passes when under the cap', () => {
    expect(() =>
      enforceResponseByteCap({
        toolId: 'jde.ap.voucher.search',
        correlationId: 'req_1',
        byteLength: 100,
        manifestResponseByteCap: 1_000,
        effectiveCaps: CAPS,
        narrowingParams: ['dateFrom'],
      }),
    ).not.toThrow();
  });

  it('refuses with a non-empty, narrowing-parameter-naming next when exceeded', () => {
    try {
      enforceResponseByteCap({
        toolId: 'jde.ap.voucher.search',
        correlationId: 'req_2',
        byteLength: 2_000,
        manifestResponseByteCap: 1_000,
        effectiveCaps: CAPS,
        narrowingParams: ['dateFrom'],
      });
      throw new Error('expected to throw');
    } catch (err) {
      const forgeErr = err as { code: string; next: string };
      expect(forgeErr.code).toBe('INTERNAL');
      expect(forgeErr.next).toContain('dateFrom');
      expect(forgeErr.next.trim().length).toBeGreaterThan(0);
    }
  });

  it('never lets a manifest cap exceed the effective ceiling', () => {
    expect(effectiveResponseByteCap(CAPS.responseByteCap * 100, CAPS)).toBe(CAPS.responseByteCap);
  });
});
