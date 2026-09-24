// MCPForge — W0-J13: Table ⇄ Cards ⇄ Map view toggle. 03 §5.3: "Table is
// the default for the real portal (the concept defaulted to cards; cards
// are the demo view, table is the working view)."
'use client';

import { cn } from 'cn';

export const CATALOG_VIEWS = ['table', 'cards', 'map'] as const;
export type CatalogView = (typeof CATALOG_VIEWS)[number];
export const DEFAULT_CATALOG_VIEW: CatalogView = 'table';

const LABELS: Record<CatalogView, string> = { table: 'Table', cards: 'Cards', map: 'Map' };

export interface ViewToggleProps {
  view: CatalogView;
  onChange: (view: CatalogView) => void;
  className?: string;
}

export function ViewToggle({ view, onChange, className }: ViewToggleProps) {
  return (
    <div role="radiogroup" aria-label="Catalog view" data-testid="catalog-view-toggle" className={cn('inline-flex rounded-md border border-line p-0.5', className)}>
      {CATALOG_VIEWS.map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          data-testid={`catalog-view-${v}`}
          onClick={() => onChange(v)}
          className={cn(
            'rounded px-3 py-1 text-[12.5px] font-medium',
            view === v ? 'bg-accent-tint text-accent' : 'text-text-2 hover:bg-surface-2',
          )}
        >
          {LABELS[v]}
        </button>
      ))}
    </div>
  );
}
