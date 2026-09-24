// MCPForge — filesystem discovery and YAML loading for `forge validate`. W0-B2.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ManifestFile } from './types.js';

const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.git']);

/** Recursively collect `.yaml`/`.yml` file paths under `dir`, if it exists. */
function walkYamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      if (SKIP_DIR_NAMES.has(entry)) continue;
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        stack.push(full);
      } else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
        out.push(full);
      }
    }
  }
  return out;
}

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

/** Parse one YAML file into a `ManifestFile`, capturing a parse error instead of throwing. */
export function loadManifestFile(repoRoot: string, absPath: string): ManifestFile {
  const file = toPosix(relative(repoRoot, absPath));
  try {
    const text = readFileSync(absPath, 'utf8');
    const doc: unknown = parseYaml(text);
    return { absPath, file, doc };
  } catch (err) {
    return {
      absPath,
      file,
      doc: undefined,
      parseError: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Every candidate manifest file under the four directories `forge validate`
 * reads: `manifests/**` (Tool + Server), `roles/**`, `packages/**`,
 * `consumers/**` (optional — the directory does not exist until W0-HG-series
 * or a real deployment adds a Consumer record).
 */
export function loadManifestFiles(repoRoot: string): ManifestFile[] {
  const dirs = ['manifests', 'roles', 'packages', 'consumers'].map((d) => join(repoRoot, d));
  const paths = dirs.flatMap((d) => walkYamlFiles(d));
  return paths.sort().map((p) => loadManifestFile(repoRoot, p));
}

/**
 * Enum lookup-list names available under `enums/` (02 §2.2's `enumRef`).
 * Each file's name is its basename without extension, e.g. `enums/iso_currency.yaml`
 * makes `iso_currency` resolvable. A file may also declare `id:` to name itself
 * explicitly; when present that wins, so a differently-named file still resolves.
 */
export function loadEnumNames(repoRoot: string): Set<string> {
  const dir = join(repoRoot, 'enums');
  const names = new Set<string>();
  for (const absPath of walkYamlFiles(dir)) {
    const base = absPath
      .split(/[\\/]/)
      .pop()!
      .replace(/\.ya?ml$/, '');
    names.add(base);
    try {
      const text = readFileSync(absPath, 'utf8');
      const doc: unknown = parseYaml(text);
      const id = (doc as { id?: unknown } | null)?.id;
      if (typeof id === 'string' && id.length > 0) names.add(id);
    } catch {
      // An unreadable enum file names nothing extra; it is not itself a
      // manifest kind, so it is not reported as a validation failure here.
    }
  }
  return names;
}
