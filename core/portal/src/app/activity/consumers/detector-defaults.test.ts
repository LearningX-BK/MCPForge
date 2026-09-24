// MCPForge — W0-N13: pins `fixtures.ts`'s restated `DETECTOR_ROW_DEFAULTS`
// against the real `core/gateway/anomaly/config.ts` `DETECTOR_DEFAULTS` and
// `DETECTOR_IDS`, so the two cannot silently drift (see `fixtures.ts`'s file
// header for why the client fixture restates rather than imports these
// values). This file itself is Node-side test-only — never bundled to the
// browser — so it may import the real, `node:fs`-touching module directly.
import { describe, expect, it } from 'vitest';
import { DETECTOR_DEFAULTS } from '@mcpforge/gateway/anomaly';
import { DETECTOR_IDS } from '@mcpforge/gateway/anomaly';

import { DETECTOR_ROW_DEFAULTS } from './fixtures';

describe('DETECTOR_ROW_DEFAULTS mirrors the real DETECTOR_DEFAULTS', () => {
  it('lists exactly the seven declared detector ids, in order', () => {
    expect(DETECTOR_ROW_DEFAULTS.map((d) => d.detectorId)).toEqual([...DETECTOR_IDS]);
  });

  it.each(DETECTOR_ROW_DEFAULTS)('$detectorId: window, threshold and severity match', (row) => {
    const real = DETECTOR_DEFAULTS[row.detectorId];
    expect(row.window).toBe(real.window);
    expect(row.threshold).toBe(real.threshold);
    expect(row.severity).toBe(real.severity);
  });

  it('flags exactly the three Wave 0 detectors as implemented (W0-N9)', () => {
    const implemented = DETECTOR_ROW_DEFAULTS.filter((d) => d.implemented).map((d) => d.detectorId);
    expect(implemented.sort()).toEqual(
      ['burst-write', 'identity-echo-mismatch', 'scope-probing'].sort(),
    );
  });
});
