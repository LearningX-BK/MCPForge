// MCPForge — W0-J13: the tool page body shared by the full page and the
// drawer — same content, per the `done:` line ("rendered as a drawer ...
// and as a full page when opened directly"). A `Tabs` switch adds the
// Agent view and the Role simulator alongside the ten-section Detail tab.
'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AgentView } from './agent-view';
import { RoleSimulatorView } from './role-simulator-view';
import { ToolDetail } from './tool-detail';
import type { CatalogData, CatalogTool, ToolManifest } from '../types';

export interface ToolPageBodyProps {
  tool: CatalogTool;
  data: CatalogData;
  manifestsById: ReadonlyMap<string, ToolManifest>;
}

export function ToolPageBody({ tool, data, manifestsById }: ToolPageBodyProps) {
  return (
    <Tabs defaultValue="detail" data-testid="tool-page-tabs">
      <TabsList>
        <TabsTrigger value="detail">Detail</TabsTrigger>
        <TabsTrigger value="agent">Agent view</TabsTrigger>
        <TabsTrigger value="role">Role simulator</TabsTrigger>
      </TabsList>
      <TabsContent value="detail">
        <ToolDetail tool={tool} data={data} />
      </TabsContent>
      <TabsContent value="agent">
        <AgentView manifest={tool.manifest} className="pt-3" />
      </TabsContent>
      <TabsContent value="role">
        <RoleSimulatorView data={data} manifestsById={manifestsById} className="pt-3" />
      </TabsContent>
    </Tabs>
  );
}
