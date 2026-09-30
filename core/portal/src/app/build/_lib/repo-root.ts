// MCPForge — W0-J14: locate the MCPForge repo root from a running portal
// process. Server-only (`node:fs`).
//
// JUDGMENT CALL: neither `core/codegen` nor any other package exports a
// "find the repo root" helper — `core/codegen/src/emit/version.ts`'s
// `codegenVersion()` instead walks up from `import.meta.url`, which only
// works because that module's own file never moves relative to its
// package.json. A Next.js server action is bundled and its `import.meta.url`
// is not a reliable filesystem path once Next has compiled it, so this
// walks up from `process.cwd()` instead, looking for the one file that names
// the monorepo root unambiguously: `pnpm-workspace.yaml` (CLAUDE.md §4 shows
// it as a top-level, repo-root-only file). Every script that can run this
// code (`next dev`/`next build`/`vitest`) is invoked with its cwd at
// `core/portal`, two levels below the root, so this is not a guess dressed
// up as a search — it is the same assumption `core/portal/package.json`'s
// own scripts already make, made explicit and defensive against depth.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Test-only override: `MCPFORGE_PORTAL_REPO_ROOT` lets a suite point every
 * caller of `resolveRepoRoot()` at a throwaway fixture root instead of this
 * process's real cwd-derived one — used by
 * `lib/change-host/local-git-actions.test.ts` so the sandbox-seeding test
 * never touches the actual repo. Unset in every real run.
 */
export function resolveRepoRoot(startDir: string = process.cwd()): string {
  const override = process.env['MCPFORGE_PORTAL_REPO_ROOT'];
  if (override !== undefined && override.length > 0) return override;
  // W0-P33a — the DEFINITIONS root. On the VM the definitions are a git clone
  // mounted beside the code (docs/build-plan/w0-p33-portal-merge.md §2.1);
  // every caller of this function reads definitions, so it follows them.
  const definitions = process.env['MCPFORGE_DEFINITIONS_ROOT'];
  if (definitions !== undefined && definitions.length > 0) return definitions;
  return resolveRuntimeRoot(startDir);
}

/**
 * W0-P33a — the INSTALL root: the code, and `.mcpforge/` (the portal's consumer
 * key, the change-host sandbox). Never moved by `MCPFORGE_DEFINITIONS_ROOT`,
 * because runtime state is not a definition and must not land in the clone.
 */
export function resolveRuntimeRoot(startDir: string = process.cwd()): string {
  const override = process.env['MCPFORGE_PORTAL_REPO_ROOT'];
  if (override !== undefined && override.length > 0) return override;
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Falls back to the two-levels-up default rather than throwing — a
  // missing pnpm-workspace.yaml in a stripped test sandbox should not crash
  // the whole check; the caller's `validateRepo` call will simply find no
  // manifests and report accordingly.
  return join(startDir, '..', '..');
}
