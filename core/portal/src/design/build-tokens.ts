// MCPForge — the token generator (03 §13.1, §13.4).
//
// Parses tokens.primitives.css and tokens.semantic.css and emits
// tokens.ts: a flat, fully-resolved { light, dark } hex/rgba map for JS
// consumers (the contrast test, chart fallback values, canvas rendering,
// the `forge` CLI's terminal colour output).
//
// tokens.semantic.css is the source of truth for colour (13.1) — this
// script never invents a value, it only resolves `var(--x)` chains down
// to the primitives file. Run with `pnpm --filter @mcpforge/portal run
// build-tokens`; CI verifies the emitted tokens.ts is byte-identical to
// what a second run produces (git diff --exit-code, once this repo is a
// git repo — proven here by hashing across two runs instead, per the
// task brief).
//
// Rule enforced here, not just documented (13.2 rule 2): the system-dark
// media block and the explicit `:root[data-theme="dark"]` block must
// declare an identical set of tokens with identical resolved values, or
// this script throws. That is what keeps the two lists from drifting.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PRIMITIVES_PATH = join(here, 'tokens.primitives.css');
const SEMANTIC_PATH = join(here, 'tokens.semantic.css');
const OUTPUT_PATH = join(here, 'tokens.ts');

type Declarations = Map<string, string>;

/** Extract the `{ ... }` body that immediately follows `marker` in `css`. */
function extractBlock(css: string, marker: string): string {
  const markerIndex = css.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`build-tokens: could not find block starting "${marker}"`);
  }
  const openBrace = css.indexOf('{', markerIndex);
  if (openBrace === -1) {
    throw new Error(`build-tokens: no "{" found after "${marker}"`);
  }
  let depth = 0;
  for (let i = openBrace; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(openBrace + 1, i);
    }
  }
  throw new Error(`build-tokens: unbalanced braces after "${marker}"`);
}

/** Parse `--name: value;` declarations, in source order, from a CSS block body. */
function parseDeclarations(block: string): Declarations {
  const decls: Declarations = new Map();
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block)) !== null) {
    const name = match[1]!;
    const value = match[2]!.trim();
    decls.set(name, value);
  }
  return decls;
}

const VAR_RE = /^var\(--([a-zA-Z0-9-]+)\)$/;

/** Resolve a declaration's value down to a terminal literal (hex / rgba / …). */
function resolve(
  name: string,
  primitives: Declarations,
  semantic: Declarations,
  resolving: Set<string>,
): string {
  const raw = semantic.get(name);
  if (raw === undefined) {
    throw new Error(`build-tokens: semantic token "--${name}" has no declaration`);
  }
  return resolveValue(raw, primitives, semantic, resolving, name);
}

function resolveValue(
  raw: string,
  primitives: Declarations,
  semantic: Declarations,
  resolving: Set<string>,
  originName: string,
): string {
  const m = VAR_RE.exec(raw);
  if (!m) return raw; // terminal literal: hex, rgba(), etc.
  const refName = m[1]!;
  if (resolving.has(refName)) {
    throw new Error(`build-tokens: circular var() reference at "--${refName}"`);
  }
  if (primitives.has(refName)) {
    return resolveValue(
      primitives.get(refName)!,
      primitives,
      semantic,
      new Set([...resolving, refName]),
      originName,
    );
  }
  if (semantic.has(refName)) {
    return resolveValue(
      semantic.get(refName)!,
      primitives,
      semantic,
      new Set([...resolving, refName]),
      originName,
    );
  }
  throw new Error(
    `build-tokens: "--${originName}" references undefined "--${refName}"`,
  );
}

function toCamel(kebab: string): string {
  return kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function buildThemeMap(
  order: readonly string[],
  primitives: Declarations,
  semantic: Declarations,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of order) {
    out[toCamel(name)] = resolve(name, primitives, semantic, new Set());
  }
  return out;
}

function main(): void {
  const primitivesCss = readFileSync(PRIMITIVES_PATH, 'utf8');
  const semanticCss = readFileSync(SEMANTIC_PATH, 'utf8');

  const primitives = parseDeclarations(extractBlock(primitivesCss, ':root {'));

  const lightBlock = parseDeclarations(extractBlock(semanticCss, ':root {'));
  const darkMediaBlock = parseDeclarations(
    extractBlock(semanticCss, ':root:not([data-theme="light"]) {'),
  );
  const darkExplicitBlock = parseDeclarations(
    extractBlock(semanticCss, ':root[data-theme="dark"] {'),
  );

  // 13.2 rule 2: the two dark declarations must be identical, key-for-key
  // and value-for-value (pre-resolution — the raw var() references must
  // match, not merely resolve to the same thing).
  const mediaKeys = [...darkMediaBlock.keys()].sort();
  const explicitKeys = [...darkExplicitBlock.keys()].sort();
  if (JSON.stringify(mediaKeys) !== JSON.stringify(explicitKeys)) {
    throw new Error(
      'build-tokens: system-dark and explicit-dark declare different token sets — 13.2 rule 2 violated',
    );
  }
  for (const key of mediaKeys) {
    if (darkMediaBlock.get(key) !== darkExplicitBlock.get(key)) {
      throw new Error(
        `build-tokens: "--${key}" differs between system-dark and explicit-dark — 13.2 rule 2 violated`,
      );
    }
  }

  const lightOrder = [...lightBlock.keys()];
  const darkOrder = [...darkExplicitBlock.keys()];
  if (JSON.stringify([...lightOrder].sort()) !== JSON.stringify([...darkOrder].sort())) {
    throw new Error('build-tokens: light and dark declare different token sets');
  }

  const light = buildThemeMap(lightOrder, primitives, lightBlock);
  const dark = buildThemeMap(darkOrder, primitives, darkExplicitBlock);

  const renderEntries = (map: Record<string, string>): string =>
    Object.entries(map)
      .map(([key, value]) => `    ${key}: ${JSON.stringify(value)},`)
      .join('\n');

  const output = `// GENERATED by build-tokens.ts — do not edit. CI verifies this file is clean.
// Source: tokens.primitives.css + tokens.semantic.css (03 §13.4).

export const tokens = {
  light: {
${renderEntries(light)}
  },
  dark: {
${renderEntries(dark)}
  },
} as const;

export type ThemeName = keyof typeof tokens;
export type TokenName = keyof typeof tokens.light;
`;

  writeFileSync(OUTPUT_PATH, output, 'utf8');
}

main();
