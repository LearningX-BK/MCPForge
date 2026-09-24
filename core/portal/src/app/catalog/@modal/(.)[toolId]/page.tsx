// MCPForge — W0-J13: the DRAWER — intercepts `/catalog/[toolId]` navigation
// that originates from within `/catalog` (the `(.)` intercepting-route
// segment) and renders it as a `Sheet` over the list instead of replacing
// the page. A direct load of the same URL never hits this file — Next.js
// only intercepts client-side navigations from a matching origin route — so
// it falls through to `../[toolId]/page.tsx`, the full page.
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ToolPageBody } from '../../_components/tool-page-body';
import { findTool, loadCatalogData, manifestsById } from '../../load-tool';

export default function ToolModal({ params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = React.use(params);
  const router = useRouter();
  const data = loadCatalogData();
  const tool = findTool(data, toolId);

  const [open, setOpen] = React.useState(true);

  const close = () => {
    setOpen(false);
    router.back();
  };

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? close() : undefined)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl" data-testid="tool-detail-drawer">
        <SheetHeader>
          <SheetTitle className="sr-only">{tool ? tool.manifest.title : 'Tool not found'}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">
          {tool ? (
            <ToolPageBody tool={tool} data={data} manifestsById={manifestsById(data)} />
          ) : (
            <p className="text-[13px] text-text-2">No tool with id &quot;{toolId}&quot; was found.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
