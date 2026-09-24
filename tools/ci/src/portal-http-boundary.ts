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
// unconditionally, with no allowlist entry able to admit one.

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

const IMPORT_RE =
  /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]@mcpforge\/gateway(\/[a-zA-Z-]+)?['"]/g;

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
        const allowedForSubpath = ALLOWED_RUNTIME_IMPORTS[subpath];

        if (subpath === '' || allowedForSubpath === undefined) {
          violations.push({
            file: relPath,
            specifier: name,
            subpath: subpath || '(barrel)',
            reason:
              subpath === ''
                ? 'runtime import from the @mcpforge/gateway barrel itself — the portal may only take types from it, or the small allowlisted pure helpers from a specific subpath (never the barrel).'
                : `runtime import from @mcpforge/gateway/${subpath}, which is not one of the allowlisted pure/no-I/O subpaths (store, secrets, caps, scope) — this subpath carries live gateway state and must be reached over HTTP, not in-process.`,
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
    ...report.violations.map((v) => `  ${v.file}: \`${v.specifier}\` from @mcpforge/gateway/${v.subpath} — ${v.reason}`),
  ].join('\n');
}
