'use client';

// MCPForge — W0-J10: `FacetPanel` — facet pill rows with roving tabindex.
//
// 03 §12.2: "The facet pill rows (roving tabindex within the group, `Tab`
// moves between groups — not 40 tab stops to cross a filter bar)." So each
// facet ROW is one tab stop from outside: exactly one pill per row carries
// `tabIndex=0` (the "active" pill — the selected one if any, else the
// first), every other pill in that row carries `tabIndex=-1`, and arrow
// keys move the active pill and focus within the row. `Tab`/`Shift+Tab`
// leave the row entirely, using the browser's native tab order, because
// nothing here intercepts `Tab`.
import * as React from 'react';
import { cn } from 'cn';

export interface FacetOption {
  value: string;
  label: string;
  /** Optional live count, e.g. "JD Edwards Financials (42)". */
  count?: number;
}

export interface FacetGroupDef {
  /** Facet group key, e.g. "app", "verb", "write". */
  key: string;
  /** Group heading, e.g. "Application". */
  label: string;
  options: FacetOption[];
}

export interface FacetPanelProps {
  groups: FacetGroupDef[];
  isSelected: (group: string, value: string) => boolean;
  onToggle: (group: string, value: string) => void;
  className?: string;
}

/** One facet row: roving tabindex across its own pills only. */
function FacetRow({
  group,
  isSelected,
  onToggle,
}: {
  group: FacetGroupDef;
  isSelected: (group: string, value: string) => boolean;
  onToggle: (group: string, value: string) => void;
}) {
  const pillRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  // The roving index: the first selected pill, else 0. Recomputed on every
  // render from selection state rather than tracked separately, so a
  // selection made by mouse click also becomes the roving stop without an
  // extra effect.
  const selectedIndex = group.options.findIndex((opt) => isSelected(group.key, opt.value));
  const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const focusPill = (index: number) => {
    pillRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = group.options.length;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusPill((index + 1) % count);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusPill((index - 1 + count) % count);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusPill(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusPill(count - 1);
    }
    // Tab/Shift+Tab: intentionally not handled — native tab order carries
    // focus out of the row and into the next group.
  };

  return (
    <div
      role="group"
      aria-label={group.label}
      data-testid={`facet-group-${group.key}`}
      className="flex flex-col gap-1.5"
    >
      <span className="text-xs font-medium text-text-2">{group.label}</span>
      <div className="flex flex-wrap gap-1.5">
        {group.options.map((opt, index) => {
          const selected = isSelected(group.key, opt.value);
          return (
            <button
              key={opt.value}
              ref={(el) => {
                pillRefs.current[index] = el;
              }}
              type="button"
              role="checkbox"
              aria-checked={selected}
              tabIndex={index === activeIndex ? 0 : -1}
              data-testid={`facet-pill-${group.key}-${opt.value}`}
              onClick={() => onToggle(group.key, opt.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
                selected
                  ? 'border-accent-border bg-accent-tint text-accent'
                  : 'border-line bg-surface text-text-2 hover:bg-surface-2',
              )}
            >
              {opt.label}
              {typeof opt.count === 'number' && (
                <span className="tabular-nums text-text-3">{opt.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A group of facet pill rows. `Tab` moves between rows; arrows move within one. */
export function FacetPanel({ groups, isSelected, onToggle, className }: FacetPanelProps) {
  return (
    <div className={cn('flex flex-col gap-4', className)} data-testid="facet-panel">
      {groups.map((group) => (
        <FacetRow key={group.key} group={group} isSelected={isSelected} onToggle={onToggle} />
      ))}
    </div>
  );
}
