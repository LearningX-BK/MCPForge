// MCPForge — `@mcpforge/registry/index` barrel. W0-G1.

export { buildCatalogueIndex, findEvalAliasLeaks, type EvalAliasLeak } from './build.js';
// `./load.js` is deliberately NOT re-exported here — it imports `node:fs` and
// `node:path` to read `generated/index/catalogue-index.json` off disk, and
// this barrel is what portal client code reaches through
// `@mcpforge/registry/index` for the pure, in-memory `buildCatalogueIndex`
// (W0-J19's `rank-adapter.ts` builds its own index from already-loaded
// `CatalogData` rather than reading the generated artefact). Server code that
// actually needs to load the generated artefact from disk imports from
// `@mcpforge/registry/index/server`.
export type {
  CatalogueIndex,
  CatalogueIndexEntry,
  CatalogueIndexFilters,
  CatalogueIndexToolInput,
} from './types.js';
