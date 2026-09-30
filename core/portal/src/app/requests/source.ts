// MCPForge — W0-P3c: what `/requests` ranks against. Server-only.
//
// The committed discovery index, `generated/index/catalogue-index.json` —
// the artefact `forge.find` serves, CI-verified against the manifests — plus
// each tool's title and disambiguation from its manifest (the index carries
// no title). Read from git on every request; nothing is typed in.

import { loadManifestFiles } from '@mcpforge/codegen/validate';
import { loadCatalogueIndex } from '@mcpforge/registry/index/server';

import { resolveRepoRoot } from '../build/_lib/repo-root';
import type { RequestCatalog } from './rank-adapter';

export function loadRequestCatalog(repoRoot: string = resolveRepoRoot()): RequestCatalog {
  const index = loadCatalogueIndex(repoRoot);
  const tools: Record<string, { title: string; disambiguation: string | null }> = {};
  for (const file of loadManifestFiles(repoRoot)) {
    const doc = file.doc as
      | { kind?: unknown; id?: unknown; title?: unknown; disambiguation?: unknown }
      | null
      | undefined;
    if (doc?.kind !== 'Tool' || typeof doc.id !== 'string') continue;
    tools[doc.id] = {
      title: typeof doc.title === 'string' ? doc.title : doc.id,
      disambiguation: typeof doc.disambiguation === 'string' ? doc.disambiguation.trim() : null,
    };
  }
  return { index, tools };
}
