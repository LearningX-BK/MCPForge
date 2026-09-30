// MCPForge — W0-J13: `/catalog` — the Registry, evolved (03 §5.3).
//
// W0-P3e: the tools are this repository's committed manifests; probe status
// is the gateway's, read as the viewer. When the gateway cannot be read the
// catalogue still renders from git and says, once, why statuses are unknown.
import * as React from 'react';

import { LiveStateNotice } from '@/components/live/live-state-notice';

import { CatalogList } from './_components/catalog-list';
import { loadCatalogData } from './load-catalog';

export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
  const data = await loadCatalogData();

  return (
    <main className="px-6 py-6">
      <h1 className="mb-4 font-display text-xl text-text-1">Catalog</h1>
      {data.runtimeNotice === undefined ? null : (
        <LiveStateNotice state={data.runtimeNotice} subject="Probe status" className="mb-4" />
      )}
      {/* `CatalogList` reads `useSearchParams` (facet state, view state) —
          Next.js requires a Suspense boundary around any client component
          that does, so a facet-URL round trip does not opt the whole route
          out of static rendering. */}
      <React.Suspense fallback={<p className="text-[13px] text-text-2">Loading catalog…</p>}>
        <CatalogList data={data} />
      </React.Suspense>
    </main>
  );
}
