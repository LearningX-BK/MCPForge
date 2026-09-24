// MCPForge — W0-J11: the palette's typed contract onto `forge.find`.
//
// SEAM (same pattern as write-path/identity-block.tsx's probe seam and
// data/facets.ts's URL seam, documented here for the same reason): 03 §9.4
// describes `/api/find` as a real gateway HTTP endpoint the palette calls —
// "one index, three consumers... The Requests dedupe verdict, the palette,
// and the agent all get the same answer to the same question. Building any
// of the three on a separate index would be the single most likely way this
// product's efficiency claims quietly stop being true." That route does not
// exist yet: only the MCP transport is built (`core/gateway/transport/**`),
// and creating an HTTP route is outside this task's `touches:`
// (`core/portal/src/components/palette/**` only).
//
// So this file does NOT invent a parallel/simplified result shape. It
// type-imports the REAL `forge.find` contract — `FindInput`/`FindResponse`/
// `FindResultEntry`/`MetaToolCard` — straight from `core/gateway/meta/**`
// (`@mcpforge/gateway/meta`, added as a portal devDependency for this
// type-only import; verified with a standalone `tsc --noEmit` probe before
// committing to the approach — it resolves cleanly with no runtime cost,
// since `import type` is erased and `@mcpforge/gateway`'s own runtime
// dependencies, including the native `better-sqlite3` binding, are never
// pulled into the portal bundle). `FindClient` is the injectable seam: when
// `/api/find` exists, a caller supplies `(input) => fetch('/api/find', ...)`
// typed exactly as this function signature, and nothing in this directory
// changes. Until then, tests and callers pass a mock that returns
// `FindResponse` values shaped exactly as `forgeFind()` produces them — the
// mechanism that makes "there is no portal-only search index" true at the
// type level even before the wire exists.
//
// Do not substitute a hand-rolled result shape in the meantime, and do not
// wire this to a live HTTP call — none exists (see the file header on
// `command-palette.tsx` for how this is used).
import type { FindInput, FindResponse, FindResultEntry, MetaToolCard } from '@mcpforge/gateway/meta';

export type { FindInput, FindResponse, FindResultEntry, MetaToolCard };

/**
 * The injectable client. Mirrors `forgeFind(ctx, input): FindResponse`
 * (`core/gateway/meta/find.ts`) exactly, async because the real caller is an
 * HTTP round-trip once `/api/find` exists — the palette never assumes a
 * synchronous local index.
 */
export type FindClient = (input: FindInput) => Promise<FindResponse>;
