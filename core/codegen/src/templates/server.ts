// MCPForge — the codegen templates' SERVER-ONLY surface. `./index.ts` is
// safe to reach from a portal `'use client'` component; this file adds the
// templates that format their output through `../emit/writer.js`'s
// `formatTsDeterministic` (`node:fs`/`node:path`/`node:url`, to resolve the
// repo's own `.prettierrc`) and so must never be imported from client code.
// Server code (the real `forge codegen` emit pipeline) imports from
// `@mcpforge/codegen/templates/server`.

export * from './index.js';
export { buildToolRegistrationTs } from './tool-registration.js';
export { buildHandlerTs } from './handler.js';
export { buildUnitTestTs } from './unit-test.js';
export { buildContractTestTs } from './tests/contract-test.js';
