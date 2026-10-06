// MCPForge — W0-Q3: the committed module servers, for the duplicate-boundary
// warning. Server-only; read from git (`manifests/_servers/*.server.yaml`),
// never a fixture.
import { loadManifestFiles } from '@mcpforge/codegen/validate';

import { resolveRepoRoot } from './repo-root';
import type { ExistingServer } from './server-draft';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function loadExistingServers(repoRoot: string = resolveRepoRoot()): readonly ExistingServer[] {
  const out: ExistingServer[] = [];
  for (const file of loadManifestFiles(repoRoot)) {
    const doc = file.doc as Record<string, unknown> | null | undefined;
    if (doc?.['kind'] !== 'Server' || typeof doc['id'] !== 'string') continue;
    out.push({
      id: doc['id'],
      label: str(doc['label']) || doc['id'],
      app: str(doc['app']),
      module: str(doc['module']),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
