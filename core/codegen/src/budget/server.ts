// MCPForge — the token-budget gate's SERVER-ONLY surface. `./index.ts` is
// safe to reach from a portal `'use client'` component; this file adds
// `runTokenBudgetGate`/`chooseDemotions`, which pull in `../emit/version.js`'s
// `codegenVersion()` (`node:fs`/`node:path`/`node:url`, to read the package's
// own `package.json`) and so must never be imported from client code.
// `forge ci` stage 9 imports from `@mcpforge/codegen/budget/server`.

export * from './index.js';
export { runTokenBudgetGate, chooseDemotions } from './gate.js';
