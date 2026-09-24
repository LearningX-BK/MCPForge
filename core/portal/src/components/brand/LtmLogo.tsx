// MCPForge — the LTM brand mark (03 §4.1).
//
// "the real asset `LTM_Coral.svg`, viewBox `0 0 3800 1000`, aspect 3.8:1.
// Vendored at `core/portal/public/brand/ltm-coral.svg` and also inlined as a
// React component ... so it can inherit `currentColor` for the monochrome
// variants. Rendered at 120px wide in the expanded sidebar, and replaced by
// a 28px coral glyph mark in the collapsed icon rail. Never placed on a
// coral background. On light backgrounds the full-colour asset is used as-is;
// on dark it is used as-is; no recolouring of the mark itself."
//
// One `<path>`, inlined verbatim from `public/brand/ltm-coral.svg` (never
// recoloured — `fill: var(--ltm-coral-500)`, the canonical brand value from
// `tokens.primitives.css`, never a raw hex literal here per CLAUDE.md §2 /
// 03 §13.6 rule 1, `mcpforge/no-raw-color`). The `glyph` variant reuses
// the SAME path data, just narrowing the SVG's own `viewBox` to the mark's
// first closed sub-path (`x: 0..1000` of the full `0..3800` wordmark) — the
// leading letterform reads on its own at 28px the way the full lockup does
// at 120px, with no separate asset to keep in sync.
import * as React from 'react';

const LTM_PATH_D =
  'M290,770h710v230H250C111.9,1000,0,888.1,0,750V0h250v730c0,22.1,17.9,40,40,40ZM840,230h460c22.1,0,40,17.9,40,40v730h250V270c0-22.1,17.9-40,40-40h460V0H840v230ZM3349.3,0s-22-1.5-33.1,9.8c-13.7,14-27.8,52.4-27.8,52.4l-238.4,605.1-238.4-605.1s-14.1-38.4-27.8-52.4c-11.1-11.3-33.1-9.8-33.1-9.8h-450.7v999.8h250V238.4c0-13.8,12.2-25,24.6-25,25.3,0,35.9,30.3,48.7,62.9,12.8,32.6,274.1,685.8,274.1,685.8,9,22.9,31.2,38,55.8,38h193.6c24.6,0,46.8-15.1,55.8-38,0,0,261.3-653.2,274.1-685.8,12.8-32.6,23.4-62.9,48.7-62.9s24.6,11.2,24.6,25v761.6h250V0h-450.7Z';

export interface LtmLogoProps {
  /** `full` — the 120px, 3.8:1 wordmark (expanded sidebar). `glyph` — the
   * 28px single-letterform mark (collapsed rail). */
  variant: 'full' | 'glyph';
  className?: string;
}

/** LTM — the real brand asset, never recoloured, never on a coral ground. */
export function LtmLogo({ variant, className }: LtmLogoProps): React.ReactElement {
  const viewBox = variant === 'full' ? '0 0 3800 1000' : '0 0 1000 1000';
  const width = variant === 'full' ? 120 : 28;
  const height = variant === 'full' ? Math.round(120 / 3.8) : 28;

  return (
    <svg
      role="img"
      aria-label="LTM"
      viewBox={viewBox}
      width={width}
      height={height}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path style={{ fill: 'var(--ltm-coral-500)' }} d={LTM_PATH_D} />
    </svg>
  );
}
