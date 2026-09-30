// MCPForge — W0-J13: `/catalog/[toolId]` — the FULL PAGE, rendered when
// this route is opened directly (typed URL, refresh, shared link) rather
// than navigated to from the list. See `../layout.tsx` and
// `../@modal/(.)[toolId]/page.tsx` for the drawer counterpart.
//
// W0-P3e: the tool is its committed manifest; its status and 30-day
// consumption are read from `/api/v1` as the viewer.
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ToolPageBody } from '../_components/tool-page-body';
import { loadCatalogData, loadToolConsumption } from '../load-catalog';
import { findTool, manifestsById } from '../load-tool';

export const dynamic = 'force-dynamic';

export default async function ToolPage({ params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  const data = await loadCatalogData();
  const found = findTool(data, decodeURIComponent(toolId));

  if (!found) {
    notFound();
  }
  const tool = { ...found, consumption: await loadToolConsumption(found.manifest.id) };

  return (
    <main className="mx-auto max-w-4xl px-6 py-6">
      <Link href="/catalog" className="mb-4 inline-block text-[13px] text-text-2 underline decoration-dotted underline-offset-2">
        ← Back to Catalog
      </Link>
      <ToolPageBody tool={tool} data={data} manifestsById={manifestsById(data)} />
    </main>
  );
}
