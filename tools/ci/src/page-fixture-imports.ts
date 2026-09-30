// MCPForge — W0-P3c: no portal page renders fixture data.
//
// W0-P2 §4(d): the fixtures survive "as the test and component-development
// source only ... never imported by a `page.tsx`. A lint rule or a
// `portal-http-boundary`-style check should assert that no `page.tsx` imports
// a `fixtures.ts` ... or the fixtures will quietly creep back." This is that
// check.
//
// It follows imports, not just a page's own import lines. A page that imports
// a loader that imports `fixtures.ts` renders fixture data exactly as surely
// as one that imports it directly; checking only the first hop would pass
// while the screen still showed invented rows.
//
// ENTRY POINTS: every App Router module that renders a route: `page.tsx`,
// `layout.tsx`, `default.tsx`, `template.tsx`, `not-found.tsx`, `error.tsx`,
// `loading.tsx` under `core/portal/src/app`.
//
// FOLLOWED: relative imports and `@/` (the portal's `src/` alias), value
// imports and value re-exports only. `import type` / `export type` are erased
// at compile time and carry no data, so they are not followed. Package
// imports (`@mcpforge/*`, `react`, …) are not followed: this is about the
// portal's own fixture modules.
//
// A FIXTURE is a file named `fixtures.ts(x)`, `test-fixture(s).ts(x)` or
// `*.fixtures.ts(x)`.
//
// ALLOWLIST: a known remaining path, named with the task that removes it.
// An entry is an exact `from -> to` edge. The allowlist is checked for
// staleness too: an entry that no longer matches any edge fails, so it cannot
// outlive the fix it waits for.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/** `from -> to` edges (paths relative to `core/portal/src`) that are known and owned. */
export const ALLOWED_FIXTURE_EDGES: Readonly<Record<string, string>> = {
  // W0-P3e. The Catalog's `CatalogTool` mixes git facts (the manifest) with
  // runtime ones (probe status, identity carriage, 30-day consumption), so
  // moving it off its fixture needs `/api/v1` as well as git. Filed as its
  // own task in W0-P3c rather than half-done here.
  'app/catalog/load-tool.ts -> app/catalog/fixtures.ts':
    'W0-P3e: the Catalog onto git (manifests) and /api/v1 (probe status, consumption).',
};

const ENTRY_FILES = new Set([
  'page.tsx',
  'layout.tsx',
  'default.tsx',
  'template.tsx',
  'not-found.tsx',
  'error.tsx',
  'loading.tsx',
]);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next']);
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

export function isFixtureFile(relPath: string): boolean {
  const base = relPath.split('/').pop() ?? '';
  return /^(fixtures|test-fixtures?)\.tsx?$/.test(base) || /\.fixtures\.tsx?$/.test(base);
}

function isTestFile(relPath: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(relPath);
}

function listEntries(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listEntries(full, out);
    else if (ENTRY_FILES.has(entry)) out.push(full);
  }
}

// Value imports and re-exports with a string specifier. `import type` and
// `export type` are excluded; an inline `{ type X }` list that is ALL types is
// excluded below.
const STATIC_RE =
  /(?:^|[\n;])\s*(?:import|export)\s+(?!type[\s{])(?:([^'";]*?)\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function onlyTypes(clause: string | undefined): boolean {
  if (clause === undefined) return false;
  const brace = /^\{([^}]*)\}$/.exec(clause.trim());
  if (brace === null) return false;
  const names = (brace[1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return names.length > 0 && names.every((s) => s.startsWith('type '));
}

function resolveSpecifier(srcRoot: string, fromFile: string, spec: string): string | undefined {
  let base: string;
  if (spec.startsWith('@/')) base = join(srcRoot, spec.slice(2));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = join(dirname(fromFile), spec);
  else return undefined;
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function valueImports(srcRoot: string, file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of text.matchAll(STATIC_RE)) {
    if (onlyTypes(m[1])) continue;
    const resolved = resolveSpecifier(srcRoot, file, m[2] ?? '');
    if (resolved !== undefined) out.push(resolved);
  }
  for (const m of text.matchAll(DYNAMIC_RE)) {
    const resolved = resolveSpecifier(srcRoot, file, m[1] ?? '');
    if (resolved !== undefined) out.push(resolved);
  }
  return out;
}

export interface FixtureImportViolation {
  /** The route entry point, relative to `core/portal/src`. */
  readonly entry: string;
  /** entry -> … -> fixture, each relative to `core/portal/src`. */
  readonly chain: readonly string[];
}

export interface FixtureImportReport {
  readonly ok: boolean;
  readonly entriesScanned: number;
  readonly violations: readonly FixtureImportViolation[];
  /** Allowlisted edges that no longer occur anywhere: stale, and a failure. */
  readonly staleAllowances: readonly string[];
}

export function checkPageFixtureImports(
  repoRoot: string,
  allowed: Readonly<Record<string, string>> = ALLOWED_FIXTURE_EDGES,
): FixtureImportReport {
  const srcRoot = join(repoRoot, 'core', 'portal', 'src');
  const rel = (abs: string): string => relative(srcRoot, abs).split('\\').join('/');
  const entries: string[] = [];
  listEntries(join(srcRoot, 'app'), entries);

  const importsOf = new Map<string, string[]>();
  const edgesSeen = new Set<string>();
  const violations: FixtureImportViolation[] = [];

  for (const entry of entries.sort()) {
    // Breadth-first, remembering how each file was reached, so a violation
    // names the whole path a reviewer has to cut.
    const parent = new Map<string, string | null>([[entry, null]]);
    const queue = [entry];
    const reported = new Set<string>();
    while (queue.length > 0) {
      const file = queue.shift()!;
      let next = importsOf.get(file);
      if (next === undefined) {
        next = valueImports(srcRoot, file).filter((f) => !isTestFile(rel(f)));
        importsOf.set(file, next);
      }
      for (const target of next) {
        const edge = `${rel(file)} -> ${rel(target)}`;
        if (isFixtureFile(rel(target))) {
          edgesSeen.add(edge);
          if (allowed[edge] !== undefined || reported.has(target)) continue;
          reported.add(target);
          const chain = [rel(target)];
          for (let at: string | null = file; at !== null; at = parent.get(at) ?? null)
            chain.unshift(rel(at));
          violations.push({ entry: rel(entry), chain });
          continue;
        }
        if (!parent.has(target)) {
          parent.set(target, file);
          queue.push(target);
        }
      }
    }
  }

  const staleAllowances = Object.keys(allowed).filter((edge) => !edgesSeen.has(edge));
  return {
    ok: violations.length === 0 && staleAllowances.length === 0,
    entriesScanned: entries.length,
    violations,
    staleAllowances,
  };
}

export function formatFixtureImportReport(report: FixtureImportReport): string {
  if (report.ok) {
    return `Scanned ${report.entriesScanned} route entry point(s): none reaches a fixture module except the ${Object.keys(ALLOWED_FIXTURE_EDGES).length} allowlisted, owned edge(s).`;
  }
  return [
    ...report.violations.map(
      (v) =>
        `  ${v.entry} renders fixture data: ${v.chain.join(' -> ')}. Read the real source (git, the ChangeHost, or /api/v1) in the page, and keep the fixture for tests only.`,
    ),
    ...report.staleAllowances.map(
      (edge) =>
        `  stale allowlist entry "${edge}": it no longer occurs. Delete it from ALLOWED_FIXTURE_EDGES in tools/ci/src/page-fixture-imports.ts.`,
    ),
  ].join('\n');
}
