// MCPForge — loading `generated/index/catalogue-index.json` into gateway
// memory at boot (02 §5.4.1: "produced by `forge codegen` and loaded into
// gateway memory at boot"). W0-G1.
//
// Mirrors the boot-time load shape `core/gateway/api/runtime-info.ts`
// establishes: a small, synchronous, no-network read of a build artefact
// into a typed in-memory value, with an honest failure rather than a
// best-effort partial parse when the artefact is missing or malformed (the
// same "never claim more than it knows" discipline
// `core/codegen/src/compile/emit-compiled.ts`'s `provenanceFor` documents for
// an unreadable manifest, applied here to an unreadable — or absent —
// generated artefact instead). Ranking (W0-G2) is the actual consumer of the
// loaded index; this module only proves the load path exists and is correct
// against what `forge codegen` actually emits.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogueIndex, CatalogueIndexEntry, CatalogueIndexFilters } from './types.js';

export class CatalogueIndexLoadError extends Error {
  constructor(
    public readonly filePath: string,
    reason: string,
  ) {
    super(`Failed to load catalogue index from ${filePath}: ${reason}`);
    this.name = 'CatalogueIndexLoadError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function readFilters(raw: unknown, entryId: string): CatalogueIndexFilters {
  if (!isRecord(raw)) {
    throw new Error(`entry "${entryId}" is missing its "filters" object`);
  }
  const required: (keyof CatalogueIndexFilters)[] = [
    'app',
    'module',
    'entity',
    'verb',
    'bindingType',
    'archetype',
    'sensitivity',
    'status',
  ];
  for (const field of required) {
    if (typeof raw[field] !== 'string') {
      throw new Error(`entry "${entryId}" filters.${field} must be a string`);
    }
  }
  if (typeof raw['write'] !== 'boolean') {
    throw new Error(`entry "${entryId}" filters.write must be a boolean`);
  }
  for (const field of ['processTags', 'packageTags', 'roles'] as const) {
    if (!isStringArray(raw[field])) {
      throw new Error(`entry "${entryId}" filters.${field} must be a string array`);
    }
  }
  return {
    app: raw['app'] as string,
    module: raw['module'] as string,
    entity: raw['entity'] as string,
    verb: raw['verb'] as string,
    bindingType: raw['bindingType'] as string,
    archetype: raw['archetype'] as string,
    sensitivity: raw['sensitivity'] as string,
    write: raw['write'] as boolean,
    processTags: raw['processTags'] as string[],
    packageTags: raw['packageTags'] as string[],
    roles: raw['roles'] as string[],
    status: raw['status'] as string,
  };
}

function readEntry(raw: unknown, index: number): CatalogueIndexEntry {
  if (!isRecord(raw)) {
    throw new Error(`tools[${index}] is not an object`);
  }
  const id = raw['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`tools[${index}] is missing a non-empty "id"`);
  }
  const lexicalDocument = raw['lexicalDocument'];
  if (typeof lexicalDocument !== 'string') {
    throw new Error(`entry "${id}" is missing a string "lexicalDocument"`);
  }
  const disambiguation = raw['disambiguation'];
  if (disambiguation !== null && typeof disambiguation !== 'string') {
    throw new Error(`entry "${id}" "disambiguation" must be a string or null`);
  }
  return {
    id,
    filters: readFilters(raw['filters'], id),
    lexicalDocument,
    disambiguation: disambiguation ?? null,
  };
}

/** Repo-relative path to the artefact this loader reads, matching what the emit pipeline writes. */
export const CATALOGUE_INDEX_RELATIVE_PATH = ['generated', 'index', 'catalogue-index.json'] as const;

/**
 * Read `generated/index/catalogue-index.json` from `repoRoot` and return a
 * typed, validated `CatalogueIndex`. Throws `CatalogueIndexLoadError` — never
 * returns an empty or partial index — when the file is absent, is not valid
 * JSON, or does not match the shape `buildCatalogueIndex` produces. Callers
 * needing a boot that tolerates a not-yet-generated repo (e.g. a fresh
 * checkout before the first `forge codegen`) must catch this explicitly,
 * matching the fail-closed discipline the rest of the gateway boot path uses.
 */
export function loadCatalogueIndex(repoRoot: string): CatalogueIndex {
  const filePath = join(repoRoot, ...CATALOGUE_INDEX_RELATIVE_PATH);
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new CatalogueIndexLoadError(
      filePath,
      `file not readable (${err instanceof Error ? err.message : String(err)}). Run \`forge codegen\` first.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CatalogueIndexLoadError(
      filePath,
      `not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  if (!isRecord(parsed) || !Array.isArray(parsed['tools'])) {
    throw new CatalogueIndexLoadError(filePath, 'top-level "tools" array is missing');
  }

  try {
    const tools = parsed['tools'].map((entry, i) => readEntry(entry, i));
    return { tools };
  } catch (err) {
    throw new CatalogueIndexLoadError(
      filePath,
      err instanceof Error ? err.message : String(err),
    );
  }
}
