// MCPForge — W0-J13 / W0-P3e: the tool-detail drawer over the Catalog list.
// Client-only (open state, `router.back()`); its data arrives as props from
// the server page `../@modal/(.)[toolId]/page.tsx`.
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

import { manifestsById } from '../load-tool';
import type { CatalogData, CatalogTool } from '../types';
import { ToolPageBody } from './tool-page-body';

export function ToolDrawer({
  toolId,
  tool,
  data,
}: {
  readonly toolId: string;
  readonly tool: CatalogTool | undefined;
  readonly data: CatalogData;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(true);

  const close = () => {
    setOpen(false);
    router.back();
  };

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? close() : undefined)}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl"
        data-testid="tool-detail-drawer"
      >
        <SheetHeader>
          <SheetTitle className="sr-only">
            {tool ? tool.manifest.title : 'Tool not found'}
          </SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">
          {tool ? (
            <ToolPageBody tool={tool} data={data} manifestsById={manifestsById(data)} />
          ) : (
            <p className="text-[13px] text-text-2">
              No tool with id &quot;{toolId}&quot; was found.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
