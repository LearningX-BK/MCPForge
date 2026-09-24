// MCPForge — W0-J13: the Catalog list — facets, live count line, and the
// Table ⇄ Cards ⇄ Map toggle (03 §5.3).
'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

import { FacetPanel } from '@/components/data';
import { decodeFacets, encodeFacets, toggleFacet, clearAllFacets, type FacetState } from '@/components/data';
import { buildFacetGroups, filterCatalog, FREE_TEXT_KEY, DEFAULT_FACET_STATE } from '../facet-defs';
import type { CatalogData } from '../types';
import { CatalogTable } from './catalog-table';
import { CatalogCards } from './catalog-cards';
import { CatalogMap } from './catalog-map';
import { ViewToggle, DEFAULT_CATALOG_VIEW, type CatalogView } from './view-toggle';

export interface CatalogListProps {
  data: CatalogData;
}

export function CatalogList({ data }: CatalogListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hasAnyParam = searchParams.toString().length > 0;
  const facets: FacetState = React.useMemo(
    () => (hasAnyParam ? decodeFacets(searchParams.toString()) : DEFAULT_FACET_STATE),
    [hasAnyParam, searchParams],
  );

  const view = (searchParams.get('view') as CatalogView | null) ?? DEFAULT_CATALOG_VIEW;

  const writeQuery = React.useCallback(
    (next: FacetState, nextView: CatalogView) => {
      const params = new URLSearchParams(encodeFacets(next));
      if (nextView !== DEFAULT_CATALOG_VIEW) params.set('view', nextView);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const toggle = (group: string, value: string) => writeQuery(toggleFacet(facets, group, value), view);
  const clearAll = () => writeQuery(clearAllFacets(), view);
  const setView = (v: CatalogView) => writeQuery(facets, v);
  const setQuery = (q: string) => {
    const next = { ...facets };
    if (q.trim().length > 0) next[FREE_TEXT_KEY] = [q];
    else delete next[FREE_TEXT_KEY];
    writeQuery(next, view);
  };

  const filtered = React.useMemo(() => filterCatalog(data, facets), [data, facets]);
  const groups = React.useMemo(() => buildFacetGroups(data, data.tools), [data]);

  const openTool = (toolId: string) => router.push(`/catalog/${toolId}`);

  return (
    <div className="flex gap-6">
      <aside className="w-64 shrink-0" data-testid="catalog-facets">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-text-2">Facets</h2>
          <button type="button" onClick={clearAll} className="text-[11px] text-text-2 underline decoration-dotted underline-offset-2">
            Clear all
          </button>
        </div>
        <label htmlFor="catalog-search" className="sr-only">
          Search tools
        </label>
        <input
          id="catalog-search"
          data-testid="catalog-search"
          type="search"
          placeholder="Search tools…"
          defaultValue={facets[FREE_TEXT_KEY]?.[0] ?? ''}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-4 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] text-text-1"
        />
        <FacetPanel groups={groups} isSelected={(g, v) => Boolean(facets[g]?.includes(v))} onToggle={toggle} />
      </aside>

      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p data-testid="catalog-count-line" className="text-[13px] text-text-2">
            {filtered.length} of {data.tools.length} tools · {data.deployment.deploymentLabel}
          </p>
          <ViewToggle view={view} onChange={setView} />
        </div>

        {view === 'table' ? <CatalogTable rows={filtered} onOpen={openTool} /> : null}
        {view === 'cards' ? <CatalogCards rows={filtered} onOpen={openTool} /> : null}
        {view === 'map' ? <CatalogMap rows={filtered} onOpen={openTool} /> : null}
      </div>
    </div>
  );
}
