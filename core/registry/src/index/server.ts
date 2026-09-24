// MCPForge — the catalogue index's SERVER-ONLY surface. `./index.ts` is safe
// to reach from a portal `'use client'` component; this file adds
// `loadCatalogueIndex`, which reads `generated/index/catalogue-index.json`
// off disk via `node:fs`/`node:path` (W0-G1) and so must never be imported
// from client code. Server code (gateway boot, the `forge` CLI, portal
// Route Handlers / Server Actions / Server Components) imports from
// `@mcpforge/registry/index/server`.

export * from './index.js';
export {
  CATALOGUE_INDEX_RELATIVE_PATH,
  CatalogueIndexLoadError,
  loadCatalogueIndex,
} from './load.js';
