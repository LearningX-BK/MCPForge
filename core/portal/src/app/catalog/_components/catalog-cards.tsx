// MCPForge — W0-J13: the Cards view — "the demo view" per 03 §5.3, kept as
// an alternate toggle, never the default.
'use client';

import { BindingChip, ChangeStateChip, ProbeStatusChip, VerbChip, WriteChip } from '@/components/chips';
import type { CatalogTool } from '../types';

export interface CatalogCardsProps {
  rows: readonly CatalogTool[];
  onOpen: (toolId: string) => void;
}

export function CatalogCards({ rows, onOpen }: CatalogCardsProps) {
  return (
    <div data-testid="catalog-cards" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <button
          key={row.manifest.id}
          type="button"
          data-testid={`catalog-card-${row.manifest.id}`}
          onClick={() => onOpen(row.manifest.id)}
          className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <div className="flex flex-col">
            <span className="text-sm font-medium text-text-1">{row.manifest.title}</span>
            <span className="font-mono text-[11px] text-text-2">{row.manifest.id}</span>
          </div>
          <p className="text-[12.5px] text-text-2">{row.manifest.purpose}</p>
          <div className="flex flex-wrap gap-1">
            <VerbChip verb={row.manifest.verb} />
            {row.manifest.write ? <WriteChip /> : null}
            <BindingChip type={row.manifest.binding.type} />
            <ProbeStatusChip status={row.probeStatus} owningTeam={row.manifest.governance.owner} />
            <ChangeStateChip state={row.changeState} />
          </div>
        </button>
      ))}
    </div>
  );
}
