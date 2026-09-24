// MCPForge — the elevated-posture binding types (02 §11.4 / CLAUDE.md #7),
// factored out of `./binding.ts` so this ONE constant has ONE fs-free module
// both `binding.ts`'s policy rule (`policy.expedited-review-elevated-binding`)
// and the portal's `/build` `review-path.ts` (W0-J14, client-side, a
// `'use client'` component chain) can import without either pulling the
// other's dependencies along:
//
//   - `binding.ts` (and the rest of `@mcpforge/codegen/rules`) imports
//     `./helpers.js`, which imports `node:fs` for OTHER rules' manifest
//     scanning — fine for `forge validate`, server-only, but it would crash
//     a portal client bundle that only wants this one Set.
//   - This file has no import at all, so `@mcpforge/codegen/rules/elevated-
//     binding-types` is safe from both sides, and `binding.ts` re-exports it
//     rather than re-declaring it, so there is still exactly one definition.
export const ELEVATED_BINDING_TYPES = new Set(['plsql', 'function']);
