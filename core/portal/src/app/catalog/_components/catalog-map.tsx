// MCPForge — W0-J13: the Map view.
//
// JUDGMENT CALL (documented here and in the final task report): 03 §5.3
// names "Table ⇄ Cards ⇄ Map" as the three view toggles but never specifies
// what "Map" shows — no worked example, no field list, unlike every other
// element on this page. The nearest concrete precedent in 03 is Activity's
// Consumption graph view (`@xyflow/react`, tool → agent → platform → scope),
// which is a different dataset (consumption edges, not the catalog) and a
// later task (W0-J16). Rather than invent unspecified content or silently
// drop the toggle, this renders the one relationship the Catalog data
// actually carries as a spatial/grouped layout: tools clustered by
// application then module/server — a real "map of the estate" reading of
// the word that needs no new dependency and asserts nothing 03 does not
// already give this page. A human owner should confirm this reading against
// 03 §5.3 or say what "Map" should show instead.
'use client';

import { BindingChip, ProbeStatusChip } from '@/components/chips';
import type { CatalogTool } from '../types';

export interface CatalogMapProps {
  rows: readonly CatalogTool[];
  onOpen: (toolId: string) => void;
}

export function CatalogMap({ rows, onOpen }: CatalogMapProps) {
  const byApp = new Map<string, Map<string, CatalogTool[]>>();
  for (const row of rows) {
    const app = row.manifest.app;
    const server = row.manifest.server;
    if (!byApp.has(app)) byApp.set(app, new Map());
    const byServer = byApp.get(app)!;
    if (!byServer.has(server)) byServer.set(server, []);
    byServer.get(server)!.push(row);
  }

  return (
    <div data-testid="catalog-map" className="flex flex-col gap-4">
      {[...byApp.entries()].map(([app, byServer]) => (
        <div key={app} className="rounded-md border border-line p-3">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-1">{app}</h3>
          <div className="flex flex-wrap gap-3">
            {[...byServer.entries()].map(([server, tools]) => (
              <div key={server} className="min-w-40 rounded-md border border-line bg-surface-2 p-2">
                <div className="mb-1 text-[11px] font-medium text-text-2">{server}</div>
                <div className="flex flex-col gap-1">
                  {tools.map((t) => (
                    <button
                      key={t.manifest.id}
                      type="button"
                      onClick={() => onOpen(t.manifest.id)}
                      className="flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-1 text-left text-[11px] hover:bg-surface-2"
                    >
                      <span className="truncate text-text-1">{t.manifest.entity}.{t.manifest.verb}</span>
                      <BindingChip type={t.manifest.binding.type} className="shrink-0" />
                      <ProbeStatusChip status={t.probeStatus} className="shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
