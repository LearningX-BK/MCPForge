// MCPForge — the deterministic file writer. W0-B4.
//
// The generic, reusable piece every real per-artefact generator (W0-B6
// onward) writes through: sorted object keys, prettier-formatted output
// matching the repo's own `.prettierrc`, no timestamps, no random ids, LF
// line endings. Two runs against an unchanged manifest tree must produce
// byte-identical files — this module is where that property is enforced,
// once, so no future codegen template has to re-derive it.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

/**
 * Recursively sort every plain object's keys, depth-first. Arrays keep their
 * order (array order is meaningful data, not a formatting accident); only
 * object key order — which JSON.stringify would otherwise leave as
 * insertion order — is normalised.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => sortKeysDeep(v));
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      out[key] = sortKeysDeep(input[key]);
    }
    return out;
  }
  return value;
}

let cachedPrettierConfig: prettier.Options | undefined;

/**
 * The repo's own `.prettierrc`, read once via `prettier.resolveConfig` so
 * this module never hand-duplicates the formatting rules declared there
 * (CLAUDE.md's "the one hand-written thing should never be duplicated"
 * discipline, applied to config rather than code).
 */
async function repoPrettierConfig(repoRoot: string): Promise<prettier.Options> {
  if (cachedPrettierConfig) return cachedPrettierConfig;
  const resolved = await prettier.resolveConfig(join(repoRoot, 'generated', '_probe.ts'));
  cachedPrettierConfig = resolved ?? {};
  return cachedPrettierConfig;
}

function here(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/** `core/codegen/src/emit` -> repo root, four levels up. Used only as a resolveConfig fallback. */
function packageRepoRootGuess(): string {
  return join(here(), '..', '..', '..', '..');
}

/**
 * Format a JSON-serializable value deterministically: keys sorted at every
 * depth, then run through the repo's own prettier config for the `json`
 * parser, ending in exactly one trailing newline.
 */
export async function serializeJsonDeterministic(
  value: unknown,
  repoRoot?: string,
): Promise<string> {
  const sorted = sortKeysDeep(value);
  const raw = `${JSON.stringify(sorted, null, 2)}\n`;
  const config = await repoPrettierConfig(repoRoot ?? packageRepoRootGuess());
  return prettier.format(raw, { ...config, parser: 'json' });
}

/** Format TypeScript/JavaScript source deterministically via the repo's own prettier config. */
export async function formatTsDeterministic(
  source: string,
  repoRoot?: string,
): Promise<string> {
  const config = await repoPrettierConfig(repoRoot ?? packageRepoRootGuess());
  return prettier.format(source, { ...config, parser: 'typescript' });
}

/**
 * Write one generated file's final bytes to disk. `content` must already be
 * the fully-formatted, final string — this function does no formatting of
 * its own; it only makes sure the parent directory exists and writes with a
 * fixed `utf8` encoding, so the same `(path, content)` pair always produces
 * the same bytes on disk regardless of what did or didn't already exist
 * there (the "delete generated/ and regenerate" invariant).
 */
export function writeGeneratedFile(absPath: string, content: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, 'utf8');
}

/** One (path, content) pair the deterministic writer will place on disk. */
export interface GeneratedFile {
  /** Absolute path. */
  readonly absPath: string;
  /** Final, already-formatted file content. */
  readonly content: string;
}

/** Write every generated file in a batch. Order does not affect the result — each write is independent and idempotent. */
export function writeGeneratedFiles(files: readonly GeneratedFile[]): void {
  for (const file of files) {
    writeGeneratedFile(file.absPath, file.content);
  }
}

/** Read a file back as `utf8`, for tests proving byte-identical regeneration. */
export function readGeneratedFile(absPath: string): string {
  return readFileSync(absPath, 'utf8');
}
