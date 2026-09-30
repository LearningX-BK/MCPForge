// MCPForge — W0-J13: shared lookup used by both the full-page and drawer
// routes for `/catalog/[toolId]`, so the two never risk disagreeing about
// which tool a given id resolves to. W0-P3e: the data itself is loaded by
// `./load-catalog.ts` (git + `/api/v1`); this file only looks things up in it.
import type { CatalogData, CatalogTool, ToolManifest } from './types';

export function findTool(data: CatalogData, toolId: string): CatalogTool | undefined {
  return data.tools.find((t) => t.manifest.id === toolId);
}

export function manifestsById(data: CatalogData): Map<string, ToolManifest> {
  return new Map(data.tools.map((t) => [t.manifest.id, t.manifest]));
}
