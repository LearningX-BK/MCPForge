// MCPForge — the `overlay-purity` CI job. W0-K3, 02 §6.3.
//
// 02 §6.3: "An overlay may contain: `config.yaml` (schema-validated),
// `mappings/*.yaml`, `branding/*` (images, a token file), `secrets.ref`
// (references to a secret store; never secret values). It may only set
// values that the base schema declares." … "An overlay may not contain: any
// `.ts`, `.js`, `.py` or `.sql` file matching `kind: Tool | Server | Role |
// Package`. A CI job (`overlay-purity`) fails the build on any such file."
//
// [P5] EXTENDED by 02 §6.3/§11.5 (Phase 5, 27 Aug 2026): `overlay-purity`
// also performs a CONTENT scan — a high-entropy string, a PEM header, or a
// `password:`/`secret:`/`token:`/`key:` value that is not a `secretRef://`
// URI, anywhere under `overlays/**`, `manifests/**`, `roles/**`,
// `packages/**` or `consumers/**` — fails the build with the file AND line
// named. This is the mechanical form of non-negotiable #8: no secret value
// ever escapes into git.
//
// Two checks, two functions, composed by `runOverlayPurityCheck`:
//
//   1. `checkOverlayFileTypes`  — file-type + declared-schema purity,
//      `overlays/**` only (02 §6.3's original scope).
//   2. `checkForLeakedSecrets`  — the [P5] content scan, across all five
//      directories named above.
//
// Both return a flat list of violations rather than throwing — a single bad
// file must not stop the scan from finding every OTHER bad file in the same
// run; `forge ci` wants the whole picture in one pass, not one violation at a
// time across N re-runs.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { CAP_NAMES } from '@mcpforge/gateway/caps';

export interface OverlayPurityViolation {
  /** Repo-relative, forward-slashed, so a report reads identically on every OS. */
  readonly file: string;
  /** 1-based. Omitted for whole-file violations (wrong extension, forbidden `kind`). */
  readonly line?: number;
  readonly message: string;
}

export interface OverlayPurityReport {
  readonly ok: boolean;
  readonly violations: readonly OverlayPurityViolation[];
  readonly filesScanned: number;
}

const FORBIDDEN_EXTENSIONS = new Set(['.ts', '.js', '.py', '.sql']);
const FORBIDDEN_KINDS = new Set(['Tool', 'Server', 'Role', 'Package']);

/** Directories the [P5] content scan (secrets, never manifests/kinds) walks. Repo-root-relative. */
const CONTENT_SCAN_ROOTS = ['overlays', 'manifests', 'roles', 'packages', 'consumers'] as const;

/** Never descend into these — build output, dependency trees, VCS metadata. */
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.git', '.forge-build']);

/** Extensions read as text for the content scan. Binary/image assets (branding/*) are skipped — they cannot carry a YAML/text secret line. */
const TEXT_EXTENSIONS = new Set(['.yaml', '.yml', '.json', '.md', '.ts', '.txt', '.ref']);

function toRepoRelative(repoRoot: string, absPath: string): string {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

function walkFiles(dir: string): string[] {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      files.push(...walkFiles(path.join(dir, entry.name)));
    } else if (entry.isFile()) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Declared-key schemas for the overlay file kinds this codebase actually
 * defines today (`core/gateway/caps/overlay.ts`'s `Caps`,
 * `core/cli/src/lib/group-role-mapping.ts`'s `GroupRoleMapping`). 02 §6.3
 * says an overlay "may only set values that the base schema declares" — for
 * any OTHER overlay YAML (a `config.yaml` with no recognised `kind`, a
 * branding token file), there is no base schema in this repo yet to check
 * undeclared keys against, so this function only rejects a forbidden `kind`
 * for those and leaves key-level validation to whichever task defines that
 * schema. This is a deliberate, narrower judgment call, not a gap in the
 * two schemas that do exist.
 */
function checkDeclaredKeys(doc: Record<string, unknown>): string | null {
  const kind = doc['kind'];
  if (kind === 'Caps') {
    const allowedTop = new Set(['apiVersion', 'kind', 'deployment', 'caps']);
    for (const key of Object.keys(doc)) {
      if (!allowedTop.has(key)) return `top-level key "${key}" is not part of the Caps overlay schema`;
    }
    const caps = doc['caps'];
    if (caps !== undefined) {
      if (!isRecord(caps)) return '"caps" must be a mapping of cap name -> number';
      for (const key of Object.keys(caps)) {
        if (!(CAP_NAMES as readonly string[]).includes(key)) {
          return `caps.${key} is not one of the six overlay-settable caps: ${CAP_NAMES.join(', ')}`;
        }
      }
    }
    return null;
  }
  if (kind === 'GroupRoleMapping') {
    const allowedTop = new Set(['apiVersion', 'kind', 'deployment', 'groups', 'subjectOverrides']);
    for (const key of Object.keys(doc)) {
      if (!allowedTop.has(key))
        return `top-level key "${key}" is not part of the GroupRoleMapping overlay schema`;
    }
    for (const section of ['groups', 'subjectOverrides'] as const) {
      const value = doc[section];
      if (value === undefined) continue;
      if (!isRecord(value)) return `"${section}" must be a mapping`;
      for (const [entryKey, entry] of Object.entries(value)) {
        if (!isRecord(entry) || !Array.isArray(entry['roles'])) {
          return `${section}.${entryKey} must be { roles: [...] } — no other key is declared`;
        }
        for (const entryOwnKey of Object.keys(entry)) {
          if (entryOwnKey !== 'roles')
            return `${section}.${entryKey}.${entryOwnKey} is not part of the GroupRoleMapping overlay schema`;
        }
      }
    }
    return null;
  }
  return null;
}

/**
 * 02 §6.3's original overlay-purity check: no code, no manifest/server/
 * role/package definition, anywhere under `overlays/**`. Also enforces the
 * declared-key half of "may only set values the base schema declares" for
 * the two overlay kinds this repo's runtime actually reads (Caps,
 * GroupRoleMapping) — see `checkDeclaredKeys`'s header for the scope of
 * that half.
 */
export function checkOverlayFileTypes(repoRoot: string): OverlayPurityViolation[] {
  const overlaysDir = path.join(repoRoot, 'overlays');
  const violations: OverlayPurityViolation[] = [];

  for (const absPath of walkFiles(overlaysDir)) {
    const relPath = toRepoRelative(repoRoot, absPath);
    const ext = path.extname(absPath).toLowerCase();

    if (FORBIDDEN_EXTENSIONS.has(ext)) {
      violations.push({
        file: relPath,
        message: `overlays/** may not contain a "${ext}" file — overlays are values only, never code (02 §6.3).`,
      });
      continue;
    }

    if (ext !== '.yaml' && ext !== '.yml') continue;

    let text: string;
    try {
      text = readFileSync(absPath, 'utf-8');
    } catch (err) {
      violations.push({ file: relPath, message: `could not read file: ${(err as Error).message}` });
      continue;
    }

    let raw: unknown;
    try {
      raw = parseYaml(text);
    } catch (err) {
      violations.push({ file: relPath, message: `invalid YAML: ${(err as Error).message}` });
      continue;
    }
    if (!isRecord(raw)) continue; // an empty or scalar YAML file carries no kind — nothing to check.

    const kind = raw['kind'];
    if (typeof kind === 'string' && FORBIDDEN_KINDS.has(kind)) {
      violations.push({
        file: relPath,
        message: `overlays/** may not contain a "kind: ${kind}" definition — that belongs in manifests/, roles/ or packages/, never in an overlay (02 §6.3).`,
      });
      continue;
    }

    const keyViolation = checkDeclaredKeys(raw);
    if (keyViolation) {
      violations.push({ file: relPath, message: keyViolation });
    }
  }

  return violations;
}

const PEM_HEADER = /-----BEGIN [A-Z0-9 ]+-----/;
/** The four literal key names 02 §11.5/[P5] names verbatim. Matched as the WHOLE yaml key so `secretRef:` and `apiKeyLookup:` — legitimate field names that merely contain these words — are not flagged. */
const SECRET_KEY_LINE = /^\s*(?:-\s*)?["']?(password|secret|token|key)["']?\s*:\s*(.+?)\s*$/i;
/** A run of base64-alphabet characters, long enough and varied enough to be a credential rather than a word, a path, or a comment divider. */
const HIGH_ENTROPY_CANDIDATE = /[A-Za-z0-9+/=]{32,}/g;
const SECRET_REF_PREFIX = 'secretref://';

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function stripQuotesAndComment(value: string): string {
  let v = value.trim();
  const hashIdx = v.indexOf(' #');
  if (hashIdx >= 0) v = v.slice(0, hashIdx).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

function scanLineForLeaks(line: string): string | null {
  if (PEM_HEADER.test(line)) {
    return 'contains a PEM header (a private key or certificate value) — store it via a secretRef:// reference, never inline.';
  }

  const keyMatch = SECRET_KEY_LINE.exec(line);
  if (keyMatch) {
    const value = stripQuotesAndComment(keyMatch[2] ?? '');
    if (value.length > 0 && !value.toLowerCase().startsWith(SECRET_REF_PREFIX)) {
      return `"${keyMatch[1]}:" carries a literal value instead of a secretRef:// URI — no secret value may appear in git (non-negotiable #8).`;
    }
    // A bare secretRef:// value on a recognised secret-named key is fine —
    // fall through to the high-entropy scan for the REST of the line only
    // when the value itself wasn't already cleared.
    if (value.toLowerCase().startsWith(SECRET_REF_PREFIX)) return null;
  }

  for (const match of line.matchAll(HIGH_ENTROPY_CANDIDATE)) {
    const candidate = match[0];
    if (candidate.toLowerCase().startsWith(SECRET_REF_PREFIX)) continue;
    if (shannonEntropy(candidate) > 4.0) {
      return `contains a high-entropy string (${candidate.length} chars) that looks like a credential, not a secretRef:// reference.`;
    }
  }

  return null;
}

/**
 * [P5] the content scan (02 §11.5): any PEM header, any literal
 * `password:`/`secret:`/`token:`/`key:` value that is not `secretRef://`, or
 * any other high-entropy string, anywhere under the five named roots. Line
 * numbers are 1-based, matching every editor and every `git diff`.
 */
export function checkForLeakedSecrets(repoRoot: string): OverlayPurityViolation[] {
  const violations: OverlayPurityViolation[] = [];

  for (const root of CONTENT_SCAN_ROOTS) {
    const rootDir = path.join(repoRoot, root);
    let rootStat: import('node:fs').Stats;
    try {
      rootStat = statSync(rootDir);
    } catch {
      continue;
    }
    if (!rootStat.isDirectory()) continue;

    for (const absPath of walkFiles(rootDir)) {
      const ext = path.extname(absPath).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;

      const relPath = toRepoRelative(repoRoot, absPath);
      let text: string;
      try {
        text = readFileSync(absPath, 'utf-8');
      } catch {
        continue; // not readable as text (e.g. a binary branding asset with a misleading extension) — nothing to scan.
      }

      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const message = scanLineForLeaks(lines[i]!);
        if (message) {
          violations.push({ file: relPath, line: i + 1, message });
        }
      }
    }
  }

  return violations;
}

/** Every file the two scans actually opened, for the report's "N files scanned" line. */
function countScannedFiles(repoRoot: string): number {
  const overlaysFiles = walkFiles(path.join(repoRoot, 'overlays'));
  const contentFiles = CONTENT_SCAN_ROOTS.flatMap((root) => walkFiles(path.join(repoRoot, root)));
  return new Set([...overlaysFiles, ...contentFiles]).size;
}

/**
 * The full `overlay-purity` CI job: file-type/declared-schema purity over
 * `overlays/**`, plus the [P5] content scan over all five roots. Composed
 * here as the one entry point `tools/ci/src/stages.ts` (stage 5) calls.
 */
export function runOverlayPurityCheck(repoRoot: string): OverlayPurityReport {
  const violations = [...checkOverlayFileTypes(repoRoot), ...checkForLeakedSecrets(repoRoot)];
  return {
    ok: violations.length === 0,
    violations,
    filesScanned: countScannedFiles(repoRoot),
  };
}

export function formatOverlayPurityReport(report: OverlayPurityReport): string {
  if (report.ok) {
    return `overlay-purity: OK — ${report.filesScanned} file(s) scanned, no violations.`;
  }
  const lines = [`overlay-purity: FAILED — ${report.violations.length} violation(s):`];
  for (const v of report.violations) {
    const location = v.line !== undefined ? `${v.file}:${v.line}` : v.file;
    lines.push(`  ${location} — ${v.message}`);
  }
  return lines.join('\n');
}
