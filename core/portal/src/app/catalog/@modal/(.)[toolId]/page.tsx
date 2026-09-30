// MCPForge — W0-J13: the DRAWER — intercepts `/catalog/[toolId]` navigation
// that originates from within `/catalog` (the `(.)` intercepting-route
// segment) and renders it as a `Sheet` over the list instead of replacing
// the page. A direct load of the same URL never hits this file — Next.js
// only intercepts client-side navigations from a matching origin route — so
// it falls through to `../[toolId]/page.tsx`, the full page.
//
// W0-P3e: a server page now, because the data comes from git and `/api/v1`
// and neither can be read in the browser. The Sheet itself is the client
// component `ToolDrawer`.

import { ToolDrawer } from '../../_components/tool-drawer';
import { loadCatalogData, loadToolConsumption } from '../../load-catalog';
import { findTool } from '../../load-tool';

export const dynamic = 'force-dynamic';

export default async function ToolModal({ params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  const id = decodeURIComponent(toolId);
  const data = await loadCatalogData();
  const found = findTool(data, id);
  const tool =
    found === undefined
      ? undefined
      : { ...found, consumption: await loadToolConsumption(found.manifest.id) };

  return <ToolDrawer toolId={id} tool={tool} data={data} />;
}
