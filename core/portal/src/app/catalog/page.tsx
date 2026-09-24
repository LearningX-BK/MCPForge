// MCPForge — W0-J13: `/catalog` — the Registry, evolved (03 §5.3).
import * as React from 'react';

import { CatalogList } from './_components/catalog-list';
import { loadCatalogData } from './load-tool';

export default function CatalogPage() {
  const data = loadCatalogData();

  return (
    <main className="px-6 py-6">
      <h1 className="mb-4 font-display text-xl text-text-1">Catalog</h1>
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
