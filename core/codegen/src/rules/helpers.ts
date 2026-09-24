// MCPForge — shared helpers for the W0-B3 policy and safety rules.
//
// Every rule in this directory is a `ValidationRule` from the W0-B2 seam
// (core/codegen/src/validate/types.ts) and reports the identical
// {ruleId, file, path, message, fix} quartet. Nothing here re-implements
// structural validation: the rules read the RAW parsed document so that a
// manifest which also fails the Ajv schema still gets its policy verdict —
// a policy rule that only fires on schema-clean documents would be silently
// skippable by adding one more structural error, which is a bypass.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { IndexedManifest, RepoContext, ValidationFailure } from '../validate/types.js';

/** Build one failure in the shape `forge validate --json` reports. */
export function fail(
  ruleId: string,
  file: string,
  path: string,
  message: string,
  fix: string,
): ValidationFailure {
  return { ruleId, file, path, message, fix };
}

/** Read a nested value without throwing on a missing or non-object level. */
export function get(doc: unknown, ...path: string[]): unknown {
  let cur: unknown = doc;
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every Tool manifest in the repo, schema-clean or not. */
export function tools(ctx: RepoContext): readonly IndexedManifest[] {
  return ctx.manifests.filter((m) => m.kind === 'Tool');
}

export function manifestsOfKind(
  ctx: RepoContext,
  kind: IndexedManifest['kind'],
): readonly IndexedManifest[] {
  return ctx.manifests.filter((m) => m.kind === kind);
}

/** Word count for the agent-facing copy budgets of 03 §10.3. */
export function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/** Recursively walk every YAML file under `dir`, if it exists. */
export function walkYamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) stack.push(full);
      else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) out.push(full);
    }
  }
  return out;
}

/** Parse a YAML file, returning `undefined` rather than throwing. */
export function readYaml(absPath: string): unknown {
  try {
    return parseYaml(readFileSync(absPath, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}
