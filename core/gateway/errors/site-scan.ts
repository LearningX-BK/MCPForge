// MCPForge — the enumeration mechanism for W0-E4's done criterion: "a test
// enumerates every error construction site and fails on an empty next."
//
// WHY THIS EXISTS RATHER THAN A HANDFUL OF EXAMPLE ASSERTIONS: a hand-picked
// list of "here are the error paths I checked" stops being true the day
// someone adds an eleventh policy stage or a twelfth predicate. This module
// WALKS the actual source tree and finds every `next:` VALUE assignment for
// itself (never a `next: string` TYPE annotation), so the enumeration grows
// and shrinks with the real codebase rather than with what this task's
// author remembered to list.
//
// FORMAT ASSUMPTION, VERIFIED against the real tree before relying on it: this
// codebase is prettier-formatted with one object property per line, so a
// value assignment's key always starts its own trimmed line (`next: ...,`),
// and a type/interface field annotation always reads `readonly next:
// string;` or `next: string;` — which starts with `readonly ` or is
// immediately followed by the bare type `string` and a `;`, never a `,`. A
// TypeScript AST parse would be more robust to reformatting, but this
// project's own generators (`core/codegen/src/emit/writer.ts`) already
// enforce that every `.ts` artefact goes through the same deterministic
// prettier pass — so "one property per line" is not an assumption this
// scanner makes alone, it is a house style the rest of the toolchain also
// depends on.
//
// TWO KINDS OF SITE, both real, both necessary:
//   - LITERAL: the value is a whole string/template literal, e.g. `next:
//     \`Call forge.find...\`,`. Non-emptiness is checkable from the TEXT
//     ALONE. `${...}` interpolation slots are stripped before checking — a
//     literal is still a dead end if the FIXED text around a non-empty
//     interpolation is itself empty.
//   - COMPUTED: a pass-through or a call, e.g. `next: outcome.next,` or
//     `next: verdict.next ?? defaultWriteNext(verdict.code, call.toolId),`.
//     A computed site's actual emptiness cannot be decided from text alone —
//     `enumeration.test.ts` is required to either (a) prove it statically
//     resolves to a same-file literal constant that is itself a verified
//     LITERAL site, or (b) dynamically drive the real code path and inspect
//     the resulting value. An unclassified computed site fails the
//     enumeration test outright — see that file's ALLOWLIST.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

export type NextSiteKind = 'literal' | 'computed';

export interface NextSite {
  readonly file: string;
  readonly line: number;
  readonly kind: NextSiteKind;
  /** The right-hand-side source text, trailing comma stripped, continuation lines joined by a space. */
  readonly raw: string;
  /** LITERAL sites only: the fixed text with every `${...}` slot removed. */
  readonly literalFixedText?: string;
}

/** Strip every `${...}` interpolation slot from a template-literal body. */
function stripInterpolations(templateBody: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < templateBody.length; i++) {
    const ch = templateBody[i];
    if (depth === 0 && templateBody[i] === '$' && templateBody[i + 1] === '{') {
      depth = 1;
      i++;
      continue;
    }
    if (depth > 0) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      continue;
    }
    out += ch;
  }
  return out;
}

function stripTrailingComma(s: string): string {
  const t = s.trimEnd();
  return t.endsWith(',') ? t.slice(0, -1) : t;
}

function classifyRhs(raw: string): { kind: NextSiteKind; literalFixedText?: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length >= 2) {
    return { kind: 'literal', literalFixedText: stripInterpolations(trimmed.slice(1, -1)) };
  }
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return { kind: 'literal', literalFixedText: trimmed.slice(1, -1) };
  }
  return { kind: 'computed' };
}

/** A trimmed line that is a `next` TYPE annotation, never a value construction site. */
function isTypeAnnotationLine(trimmed: string): boolean {
  return /^(readonly\s+)?next:\s*string(\s*\|\s*null)?\s*;?\s*$/.test(trimmed);
}

/**
 * Pure parsing core, exercised directly by enumeration.test.ts against
 * deliberately-broken fixture strings (never touching the filesystem for
 * that) so "would this catch a violation" has a real, demonstrated answer.
 */
export function extractNextSites(sourceText: string, file: string): NextSite[] {
  const lines = sourceText.split(/\r?\n/);
  const sites: NextSite[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed.startsWith('next:')) continue;
    if (isTypeAnnotationLine(trimmed)) continue;

    const startLine = i + 1;
    let rhs = trimmed.slice('next:'.length).trim();
    let endedWithComma = /,\s*$/.test(trimmed);
    // Multi-line value: prettier breaks a long `??` chain onto its own lines
    // when the key alone doesn't fit (`next:` with nothing after the colon).
    // Accumulate continuation lines until one ends with a terminal comma.
    while (!endedWithComma && i + 1 < lines.length) {
      i++;
      const cont = lines[i]!.trim();
      rhs = rhs.length === 0 ? cont : `${rhs} ${cont}`;
      endedWithComma = /,\s*$/.test(cont);
    }

    const raw = stripTrailingComma(rhs);
    const { kind, literalFixedText } = classifyRhs(raw);
    sites.push(
      literalFixedText === undefined
        ? { file, line: startLine, kind, raw }
        : { file, line: startLine, kind, raw, literalFixedText },
    );
  }

  return sites;
}

const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'build', '.next', '.git', '.forge-build']);

function walkTsFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIR_NAMES.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (extname(name) === '.ts' && !name.endsWith('.d.ts')) out.push(full);
    }
  }
  walk(root);
  return out;
}

export interface ScanOptions {
  /** Roots to walk (absolute, or relative to the process cwd). */
  readonly roots: readonly string[];
  /** Exclude `*.test.ts`/`*.spec.ts` (enumeration wants PRODUCTION sites). Default true. */
  readonly excludeTests?: boolean;
}

/**
 * Walk every `.ts` file under `roots` and return every `next:` construction
 * site found. This is the actual enumeration — not a fixed list — so a stage,
 * predicate or binding-layer executor added after this task lands is picked
 * up automatically the next time the test runs.
 */
export function scanForNextSites(options: ScanOptions): NextSite[] {
  const excludeTests = options.excludeTests ?? true;
  const files = options.roots.flatMap((r) => walkTsFiles(r));
  const sites: NextSite[] = [];
  for (const file of files) {
    if (excludeTests && /\.(test|spec)\.ts$/.test(file)) continue;
    if (file.replace(/\\/g, '/').endsWith('errors/site-scan.ts')) continue; // this file's own doc-comment prose mentions `next:` but constructs no site
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    sites.push(...extractNextSites(text, file));
  }
  return sites;
}
