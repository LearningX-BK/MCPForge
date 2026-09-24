// MCPForge — the `codegen-version` that appears in every provenance header.
// W0-B4.
//
// 02 §2.3's worked example shows `codegen-version: 1.4.2` but neither 02 nor
// any other build-plan document names a source of truth for that string —
// there is no existing "codegen version" concept anywhere in the repo before
// this task. JUDGMENT CALL (documented per CLAUDE.md §8, not blocked on):
// the codegen *package's own* `package.json` `version` field is the least
// fabricated choice available — it is already the thing that changes when
// the emit pipeline's behaviour changes, and it needs no new file, no new
// convention and no coordination with a document that doesn't mention it.
// It reads `0.0.0` today because the package has never been versioned; that
// is an honest reflection of Wave 0's state, not a placeholder pretending to
// be something else.
//
// Read via a STATIC JSON import (not `readFileSync`), same reasoning as
// `../schema/index.ts`'s schema documents: `runTokenBudgetGate`
// (`../budget/gate.ts`) calls this from the portal's `/build` live preview,
// which runs CLIENT-SIDE (`checks.ts`, `checks-pane.tsx`, W0-J14/J19-adjacent)
// — a `node:fs` read at call time would either fail in the browser or drag
// `node:fs`/`node:path`/`node:url` into the client bundle and crash the
// route.
import packageJson from '../../package.json' with { type: 'json' };

let cached: string | undefined;

/** The codegen package's own semver, read once from its bundled `package.json`. */
export function codegenVersion(): string {
  if (cached !== undefined) return cached;
  const version: unknown = (packageJson as { version?: unknown }).version;
  cached = typeof version === 'string' && version.length > 0 ? version : '0.0.0';
  return cached;
}
