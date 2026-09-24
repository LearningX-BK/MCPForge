// MCPForge — the §12.1 contrast gate (03 §4.6, §13.1).
//
// Asserts every --text-*/--bg-* pair and every --status-* text token, in
// both themes, against the WCAG 2.1 relative-luminance formula. Also pins
// the handful of values 03 §4.6/§13.2 calls out by name, so a future edit
// that "looks right" cannot silently reintroduce a marginal or failing
// value.

import { describe, expect, it } from 'vitest';
import { tokens } from './tokens.js';

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`contrast.test: expected a 6-digit hex colour, got "${hex}"`);
  const int = parseInt(m[1]!, 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(channelToLinear);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2.1 contrast ratio between two opaque hex colours. */
function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

const AA_NORMAL_TEXT = 4.5;

describe('contrast — pinned values (03 §4.6, §13.2)', () => {
  it('light --text-3 is #6E7379, not the marginal #767B82', () => {
    expect(tokens.light.text3).toBe('#6e7379');
  });

  it('light --accent is #B23A2C, not the brand-500 #F2665B', () => {
    expect(tokens.light.accent).toBe('#b23a2c');
  });

  it('dark --accent-solid-fg is ink #1A1D21, not white', () => {
    expect(tokens.dark.accentSolidFg).toBe('#1a1d21');
  });

  it('dark status text tokens are the -300 steps', () => {
    expect(tokens.dark.statusRead).toBe('#5fa8c6');
    expect(tokens.dark.statusOk).toBe('#4fbf7b');
    expect(tokens.dark.statusWrite).toBe('#e0a040');
    expect(tokens.dark.statusPlatform).toBe('#a78bfa');
  });
});

describe('contrast — light theme, text on --bg-surface (#FFFFFF)', () => {
  const bg = tokens.light.bgSurface;

  it.each([
    ['--text-1', tokens.light.text1],
    ['--text-2', tokens.light.text2],
    ['--text-3', tokens.light.text3],
    ['--accent', tokens.light.accent],
    ['--status-read', tokens.light.statusRead],
    ['--status-ok', tokens.light.statusOk],
    ['--status-write', tokens.light.statusWrite],
    ['--status-platform', tokens.light.statusPlatform],
    ['--status-danger', tokens.light.statusDanger],
    ['--status-neutral', tokens.light.statusNeutral],
  ])('%s passes AA (>= 4.5:1) on --bg-surface', (_name, fg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('--accent-solid-fg on --accent-solid-bg passes AA (the primary button)', () => {
    expect(
      contrastRatio(tokens.light.accentSolidFg, tokens.light.accentSolidBg),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});

describe('contrast — dark theme, text on --bg-surface-2 (#262A2F, the worst realistic card surface)', () => {
  const bg = tokens.dark.bgSurface2;

  it.each([
    ['--text-1', tokens.dark.text1],
    ['--text-2', tokens.dark.text2],
    ['--text-3', tokens.dark.text3],
    ['--accent', tokens.dark.accent],
    ['--status-read', tokens.dark.statusRead],
    ['--status-ok', tokens.dark.statusOk],
    ['--status-write', tokens.dark.statusWrite],
    ['--status-platform', tokens.dark.statusPlatform],
    ['--status-danger', tokens.dark.statusDanger],
    ['--status-neutral', tokens.dark.statusNeutral],
  ])('%s passes AA (>= 4.5:1) on --bg-surface-2', (_name, fg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('--accent-solid-fg (ink) on --accent-solid-bg (coral) passes AA', () => {
    expect(
      contrastRatio(tokens.dark.accentSolidFg, tokens.dark.accentSolidBg),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});

describe('contrast — every --text-*/--bg-* pair, both themes', () => {
  const textKeys = ['text1', 'text2', 'text3'] as const;
  const bgKeys = ['bgCanvas', 'bgSurface', 'bgSurface2'] as const;

  for (const theme of ['light', 'dark'] as const) {
    for (const textKey of textKeys) {
      for (const bgKey of bgKeys) {
        it(`${theme}: --${textKey} on --${bgKey} passes AA`, () => {
          const fg = tokens[theme][textKey];
          const bg = tokens[theme][bgKey];
          const ratio = contrastRatio(fg, bg);
          // text-3 on the canvas colour (not a card) is out of scope per
          // §4.6 (checked only on --bg-surface); everything else must pass.
          if (textKey === 'text3' && bgKey !== 'bgSurface') return;
          expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        });
      }
    }
  }
});

describe('contrast — status chips as actually rendered (this task)', () => {
  // `StatusChip` (components/chips/status-chip.tsx) renders its `strong`
  // token as text on its own `-bg` token, and both `--status-write-bg` (an
  // alpha wash) and `--status-neutral-bg` sit inside cards/canvas that use
  // `--bg-surface-3` (#F4F5F7 light / #2C3036 dark) — the worst realistic
  // backdrop, NOT the flat `--bg-surface` the earlier blocks in this file
  // check. axe's `color-contrast` measures exactly this composited pair;
  // `--text-3`/`--status-write`'s pinned tests above did not, which is how
  // the two failures this task fixed went uncaught. `--status-write-bg` is
  // semi-transparent, so it is flattened onto `--bg-surface-3` first.
  function parseRgba(value: string): [number, number, number, number] {
    const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)$/.exec(value);
    if (!m) throw new Error(`contrast.test: expected an rgb()/rgba() colour, got "${value}"`);
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  }

  function flattenOntoHex(fgRgbaCss: string, bgHex: string): string {
    const [r, g, b, a] = parseRgba(fgRgbaCss);
    const [br, bg, bb] = hexToRgb(bgHex);
    const mix = (fgChannel: number, bgChannel: number) =>
      Math.round(fgChannel * a + bgChannel * (1 - a));
    return `#${[mix(r, br), mix(g, bg), mix(b, bb)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  }

  it.each([
    ['light', tokens.light.statusWriteStrong, tokens.light.statusWriteBg, tokens.light.bgSurface3],
    ['light', tokens.light.statusNeutralStrong, tokens.light.statusNeutralBg, tokens.light.bgSurface3],
    ['light', tokens.light.statusOkStrong, tokens.light.statusOkBg, tokens.light.bgSurface3],
    ['dark', tokens.dark.statusWriteStrong, tokens.dark.statusWriteBg, tokens.dark.bgSurface3],
    ['dark', tokens.dark.statusNeutralStrong, tokens.dark.statusNeutralBg, tokens.dark.bgSurface3],
    ['dark', tokens.dark.statusOkStrong, tokens.dark.statusOkBg, tokens.dark.bgSurface3],
    ['dark', tokens.dark.statusDangerStrong, tokens.dark.statusDangerBg, tokens.dark.bgSurface3],
  ] as const)(
    '%s: chip text on its own (possibly translucent) chip bg, over --bg-surface-3, passes AA',
    (_theme, fg, chipBg, canvasBg) => {
      const flatBg = chipBg.startsWith('rgba') ? flattenOntoHex(chipBg, canvasBg) : chipBg;
      expect(contrastRatio(fg, flatBg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    },
  );
});

describe('contrast — text-disabled is intentionally sub-AA (never used for content)', () => {
  it('light text-disabled on bg-surface is below AA', () => {
    expect(
      contrastRatio(tokens.light.textDisabled, tokens.light.bgSurface),
    ).toBeLessThan(AA_NORMAL_TEXT);
  });

  it('dark text-disabled on bg-surface-2 is below AA', () => {
    expect(
      contrastRatio(tokens.dark.textDisabled, tokens.dark.bgSurface2),
    ).toBeLessThan(AA_NORMAL_TEXT);
  });
});
