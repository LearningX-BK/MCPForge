// MCPForge — the git-held group→role mapping, and the subject-remap that
// walks it. W0-D4, 02 §4.4.
//
// 02 §4.4: "`overlays/<deployment>/mappings/groups-to-roles.yaml` maps AD
// group DNs (or local group names) to MCPForge role ids. This means the role
// grant is reviewable in a pull request rather than buried in a directory,
// and it means the Wave 0 local store and the Wave 1 AD deployment use *the
// same mapping file format*."
//
// That "same format" claim is enforced structurally, not by convention: the
// `groups` map is keyed by a bare string, and nothing in the schema or the
// parser treats `finance-ap-clerks` (a local group name) differently from
// `CN=Finance-AP,OU=Groups,DC=corp,DC=example,DC=com` (an AD group DN). Both
// are just map keys.
//
// A second section, `subjectOverrides`, is the ONLY place in this file format
// where a `Principal.subject` value (identity/types.ts) is written — a named,
// reviewable exception granting roles to one subject directly, independent of
// group membership. It exists because 02 §4.4 item 3 requires something in
// the mapping files for `forge identity remap` to rewrite: "the one thing
// that genuinely changes at swap time is the subject value," and group DNs /
// group names are not subject values — group membership is re-resolved from
// the new IdP, but a per-subject override written against the OLD subject
// would silently stop applying unless something rewrites it to the NEW
// subject. That rewrite is this module's `remapSubjectAcrossMappingFiles`.

import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/** One mapping file's shape, exactly as it round-trips through YAML. */
export interface GroupRoleMappingFile {
  readonly apiVersion: 'mcpforge/v1';
  readonly kind: 'GroupRoleMapping';
  /** The deployment (overlay) this mapping file belongs to. */
  readonly deployment: string;
  /**
   * Keyed by a local group name OR an AD group DN — identically. A group
   * present in this deployment's IdP but absent here grants no roles: an
   * unmapped group is not an error, it is simply not a grant (02 §4.4).
   */
  readonly groups: Readonly<Record<string, { readonly roles: readonly string[] }>>;
  /**
   * Keyed by `Principal.subject` — the one place a subject value appears in
   * this file format. Optional: most deployments need none.
   */
  readonly subjectOverrides?: Readonly<Record<string, { readonly roles: readonly string[] }>>;
}

export interface LoadedMappingFile {
  readonly filePath: string;
  readonly doc: GroupRoleMappingFile;
}

export interface MappingParseError {
  readonly filePath: string;
  readonly message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRoleEntries(
  value: unknown,
):
  | { readonly ok: true; entries: Record<string, { roles: string[] }> }
  | { readonly ok: false; message: string } {
  if (value === undefined) return { ok: true, entries: {} };
  if (!isRecord(value))
    return { ok: false, message: 'must be a mapping of key -> { roles: [...] }' };
  const entries: Record<string, { roles: string[] }> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (
      !isRecord(raw) ||
      !Array.isArray(raw['roles']) ||
      !raw['roles'].every((r) => typeof r === 'string')
    ) {
      return { ok: false, message: `entry "${key}" must be { roles: [<role id>, ...] }` };
    }
    entries[key] = { roles: [...(raw['roles'] as string[])] };
  }
  return { ok: true, entries };
}

/**
 * Parse and structurally validate one mapping file's already-read text.
 * Returns a typed error rather than throwing — CLAUDE.md §2 item 5: every
 * error path this produces carries an actionable `next` at the call site,
 * and a parse failure in ONE mapping file must not abort a remap walking
 * many of them.
 */
export function parseGroupRoleMappingFile(
  filePath: string,
  text: string,
):
  | { readonly ok: true; doc: GroupRoleMappingFile }
  | { readonly ok: false; error: MappingParseError } {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    return { ok: false, error: { filePath, message: `invalid YAML: ${(err as Error).message}` } };
  }
  if (!isRecord(raw)) {
    return { ok: false, error: { filePath, message: 'must be a YAML mapping document' } };
  }
  if (raw['apiVersion'] !== 'mcpforge/v1') {
    return { ok: false, error: { filePath, message: 'apiVersion must be "mcpforge/v1"' } };
  }
  if (raw['kind'] !== 'GroupRoleMapping') {
    return { ok: false, error: { filePath, message: 'kind must be "GroupRoleMapping"' } };
  }
  if (typeof raw['deployment'] !== 'string' || raw['deployment'].length === 0) {
    return { ok: false, error: { filePath, message: 'deployment must be a non-empty string' } };
  }
  const groups = readRoleEntries(raw['groups']);
  if (!groups.ok) {
    return { ok: false, error: { filePath, message: `groups: ${groups.message}` } };
  }
  const subjectOverrides = readRoleEntries(raw['subjectOverrides']);
  if (!subjectOverrides.ok) {
    return {
      ok: false,
      error: { filePath, message: `subjectOverrides: ${subjectOverrides.message}` },
    };
  }
  const doc: GroupRoleMappingFile = {
    apiVersion: 'mcpforge/v1',
    kind: 'GroupRoleMapping',
    deployment: raw['deployment'],
    groups: groups.entries,
    ...(Object.keys(subjectOverrides.entries).length > 0
      ? { subjectOverrides: subjectOverrides.entries }
      : {}),
  };
  return { ok: true, doc };
}

/** Recursively find every `mappings/*.yaml` / `*.yml` file under `root` (default `overlays/`). */
export function findMappingFiles(root: string): string[] {
  const found: string[] = [];
  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (
        path.basename(dir) === 'mappings' &&
        (name.endsWith('.yaml') || name.endsWith('.yml'))
      ) {
        found.push(full);
      }
    }
  }
  walk(root);
  return found.sort();
}

/** Load and parse every mapping file found under `root`. */
export function loadMappingFiles(root: string): {
  readonly loaded: readonly LoadedMappingFile[];
  readonly errors: readonly MappingParseError[];
} {
  const loaded: LoadedMappingFile[] = [];
  const errors: MappingParseError[] = [];
  for (const filePath of findMappingFiles(root)) {
    const text = readFileSync(filePath, 'utf-8');
    const result = parseGroupRoleMappingFile(filePath, text);
    if (result.ok) {
      loaded.push({ filePath, doc: result.doc });
    } else {
      errors.push(result.error);
    }
  }
  return { loaded, errors };
}

/** Sorted, de-duplicated role id union — deterministic so a rewrite diffs cleanly. */
function mergeRoles(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].sort();
}

export interface RemapChangedRow {
  readonly filePath: string;
  readonly fromSubject: string;
  readonly toSubject: string;
  /** Roles now granted at `toSubject` after the merge, sorted. */
  readonly roles: readonly string[];
  /**
   * True when `toSubject` already had its own `subjectOverrides` entry and
   * this remap merged `fromSubject`'s roles into it rather than renaming a
   * bare key — the row a human reviewing the diff most needs called out.
   */
  readonly mergedWithExisting: boolean;
}

/**
 * Rewrite every `subjectOverrides` entry keyed `fromSubject` to `toSubject`,
 * across every mapping file found under `root`. Files with no matching entry
 * are left untouched (not even rewritten byte-for-byte) so a `git diff` shows
 * only the deployments actually affected — 02 §4.4 item 3's "the one thing
 * that genuinely changes at swap time is the subject value" only ever touches
 * the file that names that subject.
 *
 * Returns one `RemapChangedRow` per file changed, plus any parse errors hit
 * along the way (never thrown, so one broken file does not stop the walk).
 */
export function remapSubjectAcrossMappingFiles(
  root: string,
  fromSubject: string,
  toSubject: string,
): { readonly changed: readonly RemapChangedRow[]; readonly errors: readonly MappingParseError[] } {
  const { loaded, errors } = loadMappingFiles(root);
  const changed: RemapChangedRow[] = [];

  for (const { filePath, doc } of loaded) {
    const overrides = doc.subjectOverrides;
    if (overrides === undefined || !(fromSubject in overrides)) continue;

    const fromEntry = overrides[fromSubject]!;
    const existingToEntry = overrides[toSubject];
    const mergedWithExisting = existingToEntry !== undefined;
    const roles = mergedWithExisting
      ? mergeRoles(existingToEntry.roles, fromEntry.roles)
      : [...fromEntry.roles].sort();

    const nextOverrides: Record<string, { roles: string[] }> = {};
    for (const [subject, entry] of Object.entries(overrides)) {
      if (subject === fromSubject) continue;
      nextOverrides[subject] = subject === toSubject ? { roles } : { roles: [...entry.roles] };
    }
    if (!(toSubject in nextOverrides)) {
      nextOverrides[toSubject] = { roles };
    }

    const nextDoc: GroupRoleMappingFile = {
      apiVersion: doc.apiVersion,
      kind: doc.kind,
      deployment: doc.deployment,
      groups: doc.groups,
      subjectOverrides: nextOverrides,
    };
    writeFileSync(filePath, serializeGroupRoleMappingFile(nextDoc), 'utf-8');

    changed.push({ filePath, fromSubject, toSubject, roles, mergedWithExisting });
  }

  return { changed, errors };
}

/** Stable, Prettier-friendly YAML serialisation so a remap's diff is minimal. */
export function serializeGroupRoleMappingFile(doc: GroupRoleMappingFile): string {
  const ordered: Record<string, unknown> = {
    apiVersion: doc.apiVersion,
    kind: doc.kind,
    deployment: doc.deployment,
    groups: doc.groups,
    ...(doc.subjectOverrides !== undefined && Object.keys(doc.subjectOverrides).length > 0
      ? { subjectOverrides: doc.subjectOverrides }
      : {}),
  };
  return `${stringifyYaml(ordered, { indent: 2, sortMapEntries: false })}`;
}
