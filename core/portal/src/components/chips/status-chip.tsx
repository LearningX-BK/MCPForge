// MCPForge — W0-J5: the chip family, driven entirely by
// `@mcpforge/shared`'s `status.ts` (03 §8, §13.5). `StatusChip` is the one
// rendering primitive; every named chip below (`BindingChip`,
// `ProbeStatusChip`, `ChangeStateChip`, `VerbChip`, `EnvChip`) is a thin,
// typed wrapper over it, and `StatusChip` itself is also exported directly
// for the closed enums that don't need a dedicated wrapper (`CALL_PHASE`,
// `CALL_OUTCOME`, `REVERSAL_CLASS`, `ERROR_CODE`).
//
// Accessibility contract (03 §12.5), enforced the same way on every chip:
//   - the visible child is always the entry's `label` text — never an icon
//     alone;
//   - the icon is always `aria-hidden` (see ./icon.tsx);
//   - the chip's accessible name is the *expanded* `srLabel` (or a
//     caller-supplied, more specific string — e.g. one that names an owner
//     or an approver), set via `aria-label` so it replaces rather than
//     supplements the visible text for assistive tech, satisfying "every
//     chip carries an accessible name that expands the abbreviation."
// Colour is carried by `--status-<token>-*` (03 §7.3) and is never the sole
// differentiator — the label text differs first, per 03 §12.5.
import type { StatusEntry } from '@mcpforge/shared';
import { cn } from 'cn';

import { StatusIcon } from './icon';

/**
 * How strongly the chip's colour is applied. 03 §11.1 is the only place the
 * design system asks for a *filled* status chip outside the danger
 * treatment already baked into `--status-danger` bare buttons/links — the
 * environment chip, where "production" is deliberately the one filled
 * chip in the whole product ("the asymmetry is the signal"). Every other
 * chip family in this file is the default `soft` (tinted fill + border).
 */
export type ChipTreatment = 'soft' | 'outline' | 'filled';

// `StatusEntry['token']` values already carry the `status-` prefix (e.g.
// `'status-danger'`, per core/shared/src/status.ts's `StatusToken`), and so
// does the Tailwind utility name generated from `globals.css`'s `@theme`
// block (`--color-status-danger-bg` -> `bg-status-danger-bg`). Prefixing it
// a second time here — `bg-status-${token}-bg` — previously produced
// `bg-status-status-danger-bg`, a class Tailwind's JIT scanner had no reason
// to generate and every chip silently rendered without its status colour.
// Found during W0-J7's review of `../chips`; fixed here since it's a
// small, one-file correctness bug, not a design decision.
const treatmentClasses: Record<ChipTreatment, (token: StatusEntry['token']) => string> = {
  soft: (token) => `bg-${token}-bg text-${token}-strong border-${token}-border`,
  outline: (token) => `bg-transparent text-${token}-strong border-${token}-border`,
  filled: (token) => `bg-${token}-strong text-white border-${token}-strong`,
};

// Tailwind's JIT scanner needs the full class names to appear literally
// somewhere for it to generate them — the template-string lookup above is
// invisible to it. This inert table exists only so every `bg-status-*-bg`
// etc. class is scanned and kept. It renders nothing and nothing imports it.
const _tailwindSafelist = `
  bg-status-read-bg text-status-read-strong border-status-read-border
  bg-status-ok-bg text-status-ok-strong border-status-ok-border
  bg-status-write-bg text-status-write-strong border-status-write-border
  bg-status-platform-bg text-status-platform-strong border-status-platform-border
  bg-status-neutral-bg text-status-neutral-strong border-status-neutral-border
  bg-status-danger-bg text-status-danger-strong border-status-danger-border
  bg-status-read-strong bg-status-ok-strong bg-status-write-strong
  bg-status-platform-strong bg-status-neutral-strong bg-status-danger-strong
`;
void _tailwindSafelist;

export interface StatusChipProps {
  entry: StatusEntry;
  /**
   * Overrides `entry.srLabel` as the accessible name — use this to fold in
   * call-specific detail the closed vocabulary can't know (an owning team,
   * an approver, a relative time), per the worked examples in 03 §12.5
   * ("Change state: in review. Proposed by Priya, 2 days ago.").
   */
  srLabel?: string | undefined;
  treatment?: ChipTreatment | undefined;
  className?: string | undefined;
}

/** The one chip-rendering primitive. Every other chip in this family wraps it. */
export function StatusChip({ entry, srLabel, treatment = 'soft', className }: StatusChipProps) {
  return (
    <span
      aria-label={srLabel ?? entry.srLabel}
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5',
        'text-[10.5px] font-bold tracking-[0.4px] whitespace-nowrap',
        treatmentClasses[treatment](entry.token),
        className,
      )}
    >
      <StatusIcon name={entry.icon} className="size-3" />
      <span>{entry.label}</span>
    </span>
  );
}
