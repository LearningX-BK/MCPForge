// MCPForge — the seven per-tool codegen templates. W0-B6.
export { readTool, type ToolView, type ViewInput, type ViewResultKey, type ViewGuardrail, type ViewWriteSafety } from './manifest-view.js';
export { buildSchemaJson } from './schema.js';
export { buildResidentDefinition } from './resident-definition.js';
// `./tool-registration.js`, `./handler.js`, `./unit-test.js` and
// `./tests/contract-test.js` are deliberately NOT re-exported here — each
// formats its output via `../emit/writer.js`'s `formatTsDeterministic`,
// which resolves the repo's `.prettierrc` off disk (`node:fs`/`node:path`/
// `node:url`) and so is server-only. This barrel is what the portal's
// `/build` live preview (`representations.ts`, W0-J14) reaches through
// `@mcpforge/codegen/templates` — it is documented there as "pure and
// filesystem-free" and uses only `readTool`, `buildDiscoveryCard`,
// `cardWireShape`, `buildResidentDefinition` and `buildSchemaJson`, none of
// which touch `writer.js`. Server code (the real `forge codegen` emit
// pipeline) imports the full surface from `@mcpforge/codegen/templates/server`.
export { buildDocsMarkdown } from './docs.js';
export { buildDiscoveryCard, cardWireShape, DEFAULT_STATUS } from './card.js';
// buildRoleScopeJson (W0-B6's minimal coreForRoles stub) was SUPERSEDED and
// removed by W0-B8. generated/roles/<id>.scope.json is compiled from
// roles/<id>.yaml by core/codegen/src/compile/ and has exactly one writer.
