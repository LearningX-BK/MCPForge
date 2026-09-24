// MCPForge — the static half of R8 / 02 §6.5's headless-mode constraint:
// "the portal must read the gateway's data through the same HTTP/API
// surface an external client would, never through in-process access to
// gateway internals. If the portal can only work by reaching inside the
// gateway, headless mode is a fiction."
//
// This scans every portal source file for imports of `@mcpforge/gateway`
// (any subpath). A TYPE-ONLY import (`import type { X }`, or an inline
// `{ type X }` specifier) is always allowed — it is erased at compile time,
// so it can never carry a portal process into the gateway's live state, and
// it is how `find-client.ts` and the `environments`/`governance` route types
// stay pinned to the real wire contract without a hand-duplicated shape
// (see those files' own header comments).
//
// A VALUE (runtime) import is allowed only when BOTH:
//   (a) it names one of the small, curated, side-effect-free helpers in
//       `ALLOWED_RUNTIME_IMPORTS` below — pure functions/constants that take
//       already-in-hand data and format or compute over it (never open a
//       store connection, never touch `core/gateway/store/**`'s driver
//       layer, never call the MCP transport, the policy chain, identity
//       resolution or a live consumer registry); and
//   (b) the subpath it comes from is one of the ones that group holds.
//
// Every other subpath — `/transport`, `/policy`, `/identity`, `/consumer`,
// `/meta`, `/anomaly` — and the bare `@mcpforge/gateway` barrel itself is
// where the gateway's live session state, policy enforcement, identity
// resolution and call execution actually live; a runtime import from any of
// those is exactly "reaching inside the gateway" and fails this check
// unconditionally, with no allowlist entry able to admit one. (W0-P7: the
// narrow `/consumer/records` entry is a different subpath from the
// `/consumer` barrel and is allowlisted per symbol below. The barrel itself
// stays refused.)
//
// Also refused, since W0-P7, because they cannot be checked per symbol:
// `import * as`, default imports, `export * from`, bare side-effect imports
// and dynamic `import()` of any gateway module. Nested subpaths
// (`/store/server`, `/secrets/server`) are matched too; they were previously
// invisible to this check.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** subpath (after `@mcpforge/gateway/`) -> the runtime specifiers a portal file may import from it. */
const ALLOWED_RUNTIME_IMPORTS: Readonly<Record<string, ReadonlySet<string>>> = {
  store: new Set(['describeStore']),
  secrets: new Set(['rotationStatusFor', 'secretRef']),
  // `loadCapsOverlayFile` reads a git-tracked `overlays/<deployment>/caps.yaml`
  // straight off disk — the same config file the gateway itself reads at
  // startup, not the gateway's live runtime state. It never needs the
  // gateway process to be running (it works identically whether the gateway
  // is up, down, or headless), so this is the same "definitions are git"
  // pattern as reading a manifest directly, not an in-process reach into a
  // live gateway (`core/portal/src/app/governance/_lib/policy.ts`).
  caps: new Set(['CAP_NAMES', 'HARD_CEILINGS', 'resolveEffectiveCaps', 'loadCapsOverlayFile']),
  scope: new Set(['KILL_SCOPES']),
  // W0-P7. The read-only half of the consumer module (`core/gateway/consumer/records.ts`),
  // never the `consumer` barrel, which also carries credential issuance and the
  // proposal writer. `loadConsumerRegistry` reads `consumers/**` from git: a
  // DEFINITIONAL read, which W0-P2 §7 (owner decision, 25 Sep 2026) keeps on
  // git rather than on `/api/v1/**`. The portal shares the gateway's parser so
  // it holds no second opinion about which registrations are live (02 §11.2).
  // The other five are pure date/scaffold/render helpers. `records.test.ts`
  // proves `credential.ts`/`proposal.ts` are unreachable from this entry.
  'consumer/records': new Set([
    'loadConsumerRegistry',
    'scaffoldConsumerRecord',
    'renderConsumerRecord',
    'effectiveStatus',
    'isoToday',
    'addDays',
    'DEFAULT_REGISTRATION_DAYS',
  ]),
};

/**
 * Value imports admitted ONLY in `*.test.ts(x)` files. R8 governs the portal's
 * RUNTIME process; a Vitest file runs on Node in the test runner and never
 * ships in the portal build. An entry here is still per symbol and must say
 * why the test needs the real value rather than a restatement.
 */
const ALLOWED_TEST_ONLY_IMPORTS: Readonly<Record<string, ReadonlySet<string>>> = {
  // W0-P7. `activity/consumers/detector-defaults.test.ts` pins the client
  // fixture's restated detector defaults against the real constants so the two
  // cannot drift (W0-N13). The client restates them precisely because
  // `anomaly/config.ts` reaches `node:fs`. Deleting the pin would be less safe,
  // not more.
  anomaly: new Set(['DETECTOR_DEFAULTS', 'DETECTOR_IDS']),
};

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'build']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

export interface BoundaryViolation {
  readonly file: string;
  readonly specifier: string;
  readonly subpath: string;
  readonly reason: string;
}

export interface BoundaryReport {
  readonly ok: boolean;
  readonly filesScanned: number;
  readonly violations: readonly BoundaryViolation[];
}

function listSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      listSourceFiles(full, out);
      continue;
    }
    if ([...SOURCE_EXTENSIONS].some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
}

// Named imports AND named re-exports (`export { x } from`), with nested
// subpaths (`/store/server`, `/consumer/records`). Before W0-P7 the subpath
// group was one segment deep, so an import of `@mcpforge/gateway/store/server`
// (the store driver) matched nothing and passed unseen.
const IMPORT_RE =
  /(?:import|export)\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]@mcpforge\/gateway((?:\/[a-zA-Z-]+)*)['"]/g;

// Every OTHER way to reach a gateway module at runtime, none of which can be
// checked per symbol: `import * as X`, a default import, `export * from`, a
// bare side-effect import, and dynamic `import()`. Each is a violation unless
// it is type-only (`import type * as X` / `export type * from`).
const OPAQUE_IMPORT_RE =
  /(?:\bimport\s+(?!type\s)(?:\*\s+as\s+\w+|\w+(?:\s*,\s*\*\s+as\s+\w+)?)\s+from\s+|\bexport\s+(?!type\s)\*(?:\s+as\s+\w+)?\s+from\s+|\bimport\s+|\bimport\s*\(\s*)['"](@mcpforge\/gateway(?:\/[a-zA-Z-]+)*)['"]/g;

function isTestFile(relPath: string): boolean {
  return /\.test\.tsx?$/.test(relPath);
}

/**
 * Runs the check over `core/portal/src` under the given repo root. Pure and
 * read-only — no fixture, no mock; it reads the real portal source tree.
 */
export function checkPortalHttpBoundary(repoRoot: string): BoundaryReport {
  const portalSrc = join(repoRoot, 'core', 'portal', 'src');
  const files: string[] = [];
  listSourceFiles(portalSrc, files);

  const violations: BoundaryViolation[] = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const relPath = relative(repoRoot, file).split('\\').join('/');

    for (const match of text.matchAll(OPAQUE_IMPORT_RE)) {
      const specifier = match[1] ?? '@mcpforge/gateway';
      const subpath = specifier.replace(/^@mcpforge\/gateway\/?/, '');
      violations.push({
        file: relPath,
        specifier: '*',
        subpath: subpath || '(barrel)',
        reason:
          'namespace, default, side-effect, `export *` or dynamic import of a gateway module — it cannot be checked per symbol, so it is refused. Import the named allowlisted helpers, or use `import type`.',
      });
    }

    for (const match of text.matchAll(IMPORT_RE)) {
      const [, wholeTypeOnly, specifierList, subpathRaw] = match;
      const subpath = (subpathRaw ?? '').replace(/^\//, '');

      const specifiers = (specifierList ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => {
          // `Foo as Bar` / `type Foo as Bar` — the local alias never matters,
          // only the exported name, which is what ALLOWED_RUNTIME_IMPORTS
          // keys against.
          const [exported] = s.split(/\s+as\s+/);
          return (exported ?? '').trim();
        });

      for (const spec of specifiers) {
        const isInlineType = spec.startsWith('type ');
        if (wholeTypeOnly || isInlineType) continue; // erased at compile time — never a runtime coupling

        const name = isInlineType ? spec.slice('type '.length).trim() : spec;
        if (isTestFile(relPath) && ALLOWED_TEST_ONLY_IMPORTS[subpath]?.has(name)) continue;
        const allowedForSubpath = ALLOWED_RUNTIME_IMPORTS[subpath];

        if (subpath === '' || allowedForSubpath === undefined) {
          violations.push({
            file: relPath,
            specifier: name,
            subpath: subpath || '(barrel)',
            reason:
              subpath === ''
                ? 'runtime import from the @mcpforge/gateway barrel itself — the portal may only take types from it, or the small allowlisted pure helpers from a specific subpath (never the barrel).'
                : `runtime import from @mcpforge/gateway/${subpath}, which is not one of the allowlisted pure/no-I/O subpaths (${Object.keys(ALLOWED_RUNTIME_IMPORTS).join(', ')}) — this subpath carries live gateway state and must be reached over HTTP, not in-process.`,
          });
          continue;
        }

        if (!allowedForSubpath.has(name)) {
          violations.push({
            file: relPath,
            specifier: name,
            subpath,
            reason: `\`${name}\` is not in the curated allowlist for @mcpforge/gateway/${subpath}. If this is genuinely a pure, side-effect-free helper, add it to ALLOWED_RUNTIME_IMPORTS in tools/ci/src/portal-http-boundary.ts with a one-line justification; if it touches live gateway state, it must be reached over HTTP instead.`,
          });
        }
      }
    }
  }

  return { ok: violations.length === 0, filesScanned: files.length, violations };
}

export function formatBoundaryReport(report: BoundaryReport): string {
  if (report.ok) {
    return `Scanned ${report.filesScanned} portal source file(s): every @mcpforge/gateway import is either type-only or an allowlisted pure helper. No in-process reach into gateway internals.`;
  }
  return [
    `${report.violations.length} portal-to-gateway HTTP-boundary violation(s) across ${report.filesScanned} file(s) scanned:`,
    ...report.violations.map(
      (v) => `  ${v.file}: \`${v.specifier}\` from @mcpforge/gateway/${v.subpath} — ${v.reason}`,
    ),
  ].join('\n');
}
