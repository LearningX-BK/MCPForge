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

//
// W0-P23 (W0-P4 §2.1 item 3, owner decision 25 Sep 2026): **every group-keyed
// block is keyed per identity provider first.** "An Entra group object id and an
// OCI IAM group name are different namespaces, so the mapping file is keyed
// `groups: { <providerId>: { <group>: { roles: [...] } } }`." The same reason
// applies, unchanged, to the group-keyed blocks added after that note was
// written (`personas`, `identityAdmins`, `superAdmins`): a flat list there would
// let ANY provider's group of the same name grant the capability. So they are
// keyed by provider id too. A principal's provider is the prefix of its
// issuer-qualified subject (./subject.ts), never a claim. Subject-keyed blocks
// (`subjectOverrides`, `superAdminSubjects`) need no provider key: the subject
// already carries it, and only qualified subjects are accepted there.

import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  holdsQualifiedGroup,
  isProviderId,
  isQualifiedSubject,
  providerIdOfSubject,
} from './subject.js';

// The subject format, re-exported so the CLI (which reaches the gateway only
// through this module) and the API handlers use the one definition.
export {
  holdsQualifiedGroup,
  isQualifiedSubject,
  providerIdOfSubject,
  qualifyGroups,
} from './subject.js';

/** `<providerId> -> <group> -> T`. The provider level is the namespace. */
export type ProviderKeyed<T> = Readonly<Record<string, Readonly<Record<string, T>>>>;
/** `<providerId> -> [group, ...]`. */
export type ProviderGroupLists = Readonly<Record<string, readonly string[]>>;

/** One mapping file's shape, exactly as it round-trips through YAML. */
export interface GroupRoleMappingFile {
  readonly apiVersion: 'mcpforge/v1';
  readonly kind: 'GroupRoleMapping';
  /** The deployment (overlay) this mapping file belongs to. */
  readonly deployment: string;
  /**
   * W0-P23: keyed by provider id, then by that provider's group (a local
   * group name, an AD group DN, an Entra object id — identically). A group
   * present in a provider but absent here grants no roles: an unmapped group is
   * not an error, it is simply not a grant (02 §4.4).
   */
  readonly groups: ProviderKeyed<{ readonly roles: readonly string[] }>;
  /**
   * Keyed by `Principal.subject` — the one place a subject value appears in
   * this file format. Optional: most deployments need none.
   */
  readonly subjectOverrides?: Readonly<Record<string, { readonly roles: readonly string[] }>>;
  /**
   * W0-P5b, W0-P4 §2 and §9 decision 2: which portal personas a group's
   * members may use. Keyed by group, exactly like `groups`, so persona
   * eligibility is reviewed in the same diff as the role grant it rides on.
   *
   * **A persona is a lens, never a grant.** Nothing in the gateway reads this
   * section: scope, policy and authorization are decided from `groups` and
   * `subjectOverrides` alone. The portal reads it to choose which lenses to
   * offer and which portal actions to enable, and the gateway still refuses
   * whatever the human's roles do not allow.
   */
  readonly personas?: ProviderKeyed<{ readonly personas: readonly Persona[] }>;
  /**
   * W0-P28 (owner decision, 30 Sep 2026): the groups whose members may
   * administer LOCAL user accounts (create, disable, enable, regroup, reset a
   * password) through the gateway. Held here so widening who may administer
   * identities is a reviewed diff, exactly like a role grant.
   *
   * Unlike `personas`, this IS read by the gateway: `/api/v1/admin/users`
   * refuses anyone whose groups are not listed. It grants no tool and no role.
   */
  readonly identityAdmins?: ProviderGroupLists;
  /**
   * W0-P31 (owner decision, 30 Sep 2026): the groups whose members are the
   * deployment's SUPER ADMINS. Grants nothing by itself: a super admin's tools
   * come from the `super-admin` role through `groups`, like anyone's. The
   * gateway reads it for the one thing the owner allowed only them: approving
   * their own request, flagged (W0-P32).
   */
  readonly superAdmins?: ProviderGroupLists;
  /**
   * W0-P22 (owner decision, 1 Oct 2026: "A: superAdminSubjects list
   * (Recommended)"): the `Principal.subject` values of the super admins whose
   * SELF-APPROVAL of a definitional change `forge validate` accepts (as a
   * warning, rule `policy.approval-not-self-approved`). Group membership lives
   * in the identity provider, not in git, so validate cannot check
   * `superAdmins:` against an approval record; this list is the git fact it
   * checks instead. Grants nothing at runtime: the gateway does not read it,
   * and a subject here that is not ALSO in a `superAdmins:` group cannot merge.
   * Like `subjectOverrides`, it holds subject values, so `forge identity
   * remap` rewrites it.
   */
  readonly superAdminSubjects?: readonly string[];
}

/** 03 §2's three portal personas. Closed: a fourth is a reviewed change. */
export const PERSONAS = ['developer', 'business', 'admin'] as const;
export type Persona = (typeof PERSONAS)[number];

function isPersona(value: unknown): value is Persona {
  return typeof value === 'string' && (PERSONAS as readonly string[]).includes(value);
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

type Read<T> = { readonly ok: true; value: T } | { readonly ok: false; message: string };

function readRoleEntries(value: unknown): Read<Record<string, { roles: string[] }>> {
  if (value === undefined) return { ok: true, value: {} };
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
  return { ok: true, value: entries };
}

function readPersonaEntries(value: unknown): Read<Record<string, { personas: Persona[] }>> {
  if (!isRecord(value))
    return { ok: false, message: 'must be a mapping of group -> { personas: [...] }' };
  const entries: Record<string, { personas: Persona[] }> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw) || !Array.isArray(raw['personas'])) {
      return { ok: false, message: `entry "${key}" must be { personas: [<persona>, ...] }` };
    }
    const unknown = raw['personas'].filter((p) => !isPersona(p));
    if (unknown.length > 0) {
      return {
        ok: false,
        message: `entry "${key}" names ${JSON.stringify(unknown)}; a persona is one of ${PERSONAS.join(', ')}`,
      };
    }
    entries[key] = { personas: [...(raw['personas'] as Persona[])] };
  }
  return { ok: true, value: entries };
}

/**
 * W0-P23 — a block keyed by provider id first. `inner` reads one provider's
 * part. A flat (pre-W0-P23) block is refused with the shape it should have,
 * never guessed into a provider: guessing would put every group in a namespace
 * a reviewer did not choose.
 */
function readProviderKeyed<T>(
  value: unknown,
  shape: string,
  inner: (v: unknown) => Read<T>,
): Read<Record<string, T>> {
  if (value === undefined) return { ok: true, value: {} };
  if (!isRecord(value)) return { ok: false, message: `must be keyed by provider id: ${shape}` };
  const out: Record<string, T> = {};
  for (const [providerId, raw] of Object.entries(value)) {
    if (!isProviderId(providerId)) {
      return {
        ok: false,
        message: `"${providerId}" is not a provider id; since W0-P23 this block is keyed by provider id first: ${shape}`,
      };
    }
    const read = inner(raw);
    if (!read.ok) {
      return {
        ok: false,
        message: `${providerId}: ${read.message} (since W0-P23 the shape is ${shape})`,
      };
    }
    out[providerId] = read.value;
  }
  return { ok: true, value: out };
}

function readRolesForProvider(value: unknown): Read<Record<string, { roles: string[] }>> {
  if (!isRecord(value)) {
    return { ok: false, message: 'must be a mapping of group -> { roles: [...] }' };
  }
  return readRoleEntries(value);
}

function readGroupNames(value: unknown): Read<string[]> {
  const list = value === undefined ? null : readGroupList(value);
  return list === null
    ? { ok: false, message: 'must be a list of non-empty group names' }
    : { ok: true, value: list };
}

/** Subject-keyed or subject-valued blocks accept only issuer-qualified subjects. */
function unqualified(subjects: readonly string[]): string[] {
  return subjects.filter((s) => !isQualifiedSubject(s));
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
  const bad = (message: string) => ({ ok: false as const, error: { filePath, message } });
  if (!isRecord(raw)) return bad('must be a YAML mapping document');
  if (raw['apiVersion'] !== 'mcpforge/v1') return bad('apiVersion must be "mcpforge/v1"');
  if (raw['kind'] !== 'GroupRoleMapping') return bad('kind must be "GroupRoleMapping"');
  if (typeof raw['deployment'] !== 'string' || raw['deployment'].length === 0) {
    return bad('deployment must be a non-empty string');
  }
  const groups = readProviderKeyed(
    raw['groups'],
    'groups: { <providerId>: { <group>: { roles: [...] } } }',
    readRolesForProvider,
  );
  if (!groups.ok) return bad(`groups: ${groups.message}`);
  const subjectOverrides = readRoleEntries(raw['subjectOverrides']);
  if (!subjectOverrides.ok) return bad(`subjectOverrides: ${subjectOverrides.message}`);
  const badOverrides = unqualified(Object.keys(subjectOverrides.value));
  if (badOverrides.length > 0) {
    return bad(
      `subjectOverrides: ${JSON.stringify(badOverrides)} ${badOverrides.length === 1 ? 'is' : 'are'} not issuer-qualified subjects (<providerId>:<sub>)`,
    );
  }
  const personas = readProviderKeyed(
    raw['personas'],
    'personas: { <providerId>: { <group>: { personas: [...] } } }',
    readPersonaEntries,
  );
  if (!personas.ok) return bad(`personas: ${personas.message}`);
  const identityAdmins = readProviderKeyed(
    raw['identityAdmins'],
    'identityAdmins: { <providerId>: [<group>, ...] }',
    readGroupNames,
  );
  if (!identityAdmins.ok) return bad(`identityAdmins: ${identityAdmins.message}`);
  const superAdmins = readProviderKeyed(
    raw['superAdmins'],
    'superAdmins: { <providerId>: [<group>, ...] }',
    readGroupNames,
  );
  if (!superAdmins.ok) return bad(`superAdmins: ${superAdmins.message}`);
  const superAdminSubjects = readGroupList(raw['superAdminSubjects']);
  if (superAdminSubjects === null) {
    return bad('superAdminSubjects: must be a list of non-empty Principal.subject values');
  }
  const badSubjects = unqualified(superAdminSubjects);
  if (badSubjects.length > 0) {
    return bad(
      `superAdminSubjects: ${JSON.stringify(badSubjects)} ${badSubjects.length === 1 ? 'is' : 'are'} not issuer-qualified subjects (<providerId>:<sub>)`,
    );
  }
  const nonEmpty = (r: Record<string, unknown>): boolean => Object.keys(r).length > 0;
  const doc: GroupRoleMappingFile = {
    apiVersion: 'mcpforge/v1',
    kind: 'GroupRoleMapping',
    deployment: raw['deployment'],
    groups: groups.value,
    ...(nonEmpty(subjectOverrides.value) ? { subjectOverrides: subjectOverrides.value } : {}),
    ...(nonEmpty(personas.value) ? { personas: personas.value } : {}),
    ...(nonEmpty(identityAdmins.value) ? { identityAdmins: identityAdmins.value } : {}),
    ...(nonEmpty(superAdmins.value) ? { superAdmins: superAdmins.value } : {}),
    ...(superAdminSubjects.length === 0 ? {} : { superAdminSubjects }),
  };
  return { ok: true, doc };
}

/** A list of non-empty strings, de-duplicated and sorted; `[]` when absent; `null` when malformed. */
function readGroupList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((g) => typeof g === 'string' && g.length > 0)) {
    return null;
  }
  return [...new Set(value as string[])].sort();
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
  /**
   * W0-P22 — true when `fromSubject` was listed in this file's
   * `superAdminSubjects` and is now `toSubject` there. A file can change for
   * this reason alone (no `subjectOverrides` entry); `roles` is then whatever
   * `toSubject` already held there, usually none.
   */
  readonly superAdminSubjectRewritten: boolean;
}

/**
 * Rewrite every `subjectOverrides` entry keyed `fromSubject` to `toSubject`,
 * across every mapping file found under `root`, and (W0-P22) every
 * `superAdminSubjects` entry equal to `fromSubject`. Files with no matching entry
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
  // W0-P23: a mapping file holds only issuer-qualified subjects, so writing an
  // unqualified one would produce a file the gateway refuses to start on.
  if (!isQualifiedSubject(toSubject)) {
    throw new Error(
      `"${toSubject}" is not an issuer-qualified subject (<providerId>:<sub>); a mapping file accepts no other.`,
    );
  }
  const { loaded, errors } = loadMappingFiles(root);
  const changed: RemapChangedRow[] = [];

  for (const { filePath, doc } of loaded) {
    const overrides = doc.subjectOverrides;
    const inOverrides =
      overrides !== undefined && Object.prototype.hasOwnProperty.call(overrides, fromSubject);
    // W0-P22 — `superAdminSubjects` holds subject values too; a remap that
    // skipped it would silently take the super admin's self-approval away.
    const superAdminSubjectRewritten = (doc.superAdminSubjects ?? []).includes(fromSubject);
    if (!inOverrides && !superAdminSubjectRewritten) continue;

    let nextOverrides: Record<string, { roles: string[] }> | undefined;
    let roles: string[];
    let mergedWithExisting = false;
    if (inOverrides) {
      const fromEntry = overrides[fromSubject]!;
      const existingToEntry = overrides[toSubject];
      mergedWithExisting = existingToEntry !== undefined;
      roles =
        existingToEntry !== undefined
          ? mergeRoles(existingToEntry.roles, fromEntry.roles)
          : [...fromEntry.roles].sort();

      nextOverrides = {};
      for (const [subject, entry] of Object.entries(overrides)) {
        if (subject === fromSubject) continue;
        nextOverrides[subject] = subject === toSubject ? { roles } : { roles: [...entry.roles] };
      }
      if (!(toSubject in nextOverrides)) {
        nextOverrides[toSubject] = { roles };
      }
    } else {
      roles = [...(overrides?.[toSubject]?.roles ?? [])].sort();
    }

    const nextSuperAdminSubjects =
      doc.superAdminSubjects === undefined
        ? undefined
        : [
            ...new Set(doc.superAdminSubjects.map((s) => (s === fromSubject ? toSubject : s))),
          ].sort();

    const nextDoc: GroupRoleMappingFile = {
      apiVersion: doc.apiVersion,
      kind: doc.kind,
      deployment: doc.deployment,
      groups: doc.groups,
      ...(nextOverrides !== undefined
        ? { subjectOverrides: nextOverrides }
        : overrides === undefined
          ? {}
          : { subjectOverrides: overrides }),
      ...(doc.personas === undefined ? {} : { personas: doc.personas }),
      ...(doc.identityAdmins === undefined ? {} : { identityAdmins: doc.identityAdmins }),
      ...(doc.superAdmins === undefined ? {} : { superAdmins: doc.superAdmins }),
      ...(nextSuperAdminSubjects === undefined
        ? {}
        : { superAdminSubjects: nextSuperAdminSubjects }),
    };
    writeFileSync(filePath, serializeGroupRoleMappingFile(nextDoc), 'utf-8');

    changed.push({
      filePath,
      fromSubject,
      toSubject,
      roles,
      mergedWithExisting,
      superAdminSubjectRewritten,
    });
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
    // W0-P5b — kept on a rewrite. A remap that dropped this block would
    // silently take every persona away from every group.
    ...(doc.personas !== undefined && Object.keys(doc.personas).length > 0
      ? { personas: doc.personas }
      : {}),
    // W0-P28 — kept on a rewrite, for the same reason: dropping it would take
    // user administration away from everyone.
    ...(doc.identityAdmins !== undefined && Object.keys(doc.identityAdmins).length > 0
      ? { identityAdmins: doc.identityAdmins }
      : {}),
    // W0-P31 — kept on a rewrite.
    ...(doc.superAdmins !== undefined && Object.keys(doc.superAdmins).length > 0
      ? { superAdmins: doc.superAdmins }
      : {}),
    // W0-P22 — kept on a rewrite (and rewritten by a remap).
    ...(doc.superAdminSubjects !== undefined && doc.superAdminSubjects.length > 0
      ? { superAdminSubjects: doc.superAdminSubjects }
      : {}),
  };
  return `${stringifyYaml(ordered, { indent: 2, sortMapEntries: false })}`;
}

// --- W0-P15: the gateway's read side -----------------------------------------
//
// Moved here from `core/cli/src/lib/` so the gateway owns the ONE reader (the
// CLI re-exports it; nothing is duplicated). What follows is the resolution the
// session needs at step [3]: a principal's groups (and, as a named exception,
// its subject) -> the roles it holds, from the git-held mapping of THIS
// deployment only.

/** Why a deployment's mapping could not be used. The gateway refuses to start on it. */
export class GroupRoleMappingUnavailable extends Error {
  readonly problems: readonly string[];
  constructor(deployment: string, problems: readonly string[]) {
    super(
      `The group->role mapping for deployment "${deployment}" cannot be used:\n  ${problems.join('\n  ')}`,
    );
    this.name = 'GroupRoleMappingUnavailable';
    this.problems = problems;
  }
}

/**
 * Every mapping file under `overlays/<deployment>/mappings/` whose own
 * `deployment` field names this deployment. Fails closed: any parse error in
 * that directory, a file claiming a different deployment, or no mapping file at
 * all refuses, because a gateway that silently dropped a mapping file would be
 * serving a narrower OR a wider grant than the one a reviewer approved.
 */
export function loadDeploymentGroupRoleMapping(
  overlaysRoot: string,
  deployment: string,
): readonly GroupRoleMappingFile[] {
  const dir = path.join(overlaysRoot, deployment);
  const { loaded, errors } = loadMappingFiles(dir);
  const problems = errors.map((e) => `${e.filePath}: ${e.message}`);
  for (const file of loaded) {
    if (file.doc.deployment !== deployment) {
      problems.push(
        `${file.filePath}: declares deployment "${file.doc.deployment}", but it lives under overlays/${deployment}/`,
      );
    }
  }
  if (loaded.length === 0 && errors.length === 0) {
    problems.push(`no GroupRoleMapping file under ${path.join(dir, 'mappings')}`);
  }
  if (problems.length > 0) throw new GroupRoleMappingUnavailable(deployment, problems);
  return loaded.map((f) => f.doc);
}

/** A principal as the mapping needs it: its issuer-qualified subject and its groups. */
export interface MappingMember {
  readonly subject: string;
  readonly groups: readonly string[];
}

/** Own-property lookup only: a key named "constructor" or "__proto__" must not reach Object.prototype. */
function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record !== undefined && Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

/**
 * The roles a principal holds: the union of its mapped groups' roles plus its
 * own `subjectOverrides` entry, sorted. Groups are looked up ONLY under the
 * provider its subject is qualified with (W0-P23); an unqualified subject holds
 * no group grant. An unmapped group grants nothing and is not an error (02
 * §4.4). These are the HUMAN's roles; the consumer's own roles intersect with
 * them later, in scope resolution, and never union.
 */
export function rolesForPrincipal(
  mapping: readonly GroupRoleMappingFile[],
  principal: MappingMember,
): readonly string[] {
  const providerId = providerIdOfSubject(principal.subject);
  const roles = new Set<string>();
  for (const doc of mapping) {
    const providerGroups = providerId === null ? undefined : own(doc.groups, providerId);
    for (const group of principal.groups) {
      for (const role of own(providerGroups, group)?.roles ?? []) roles.add(role);
    }
    for (const role of own(doc.subjectOverrides, principal.subject)?.roles ?? []) roles.add(role);
  }
  return [...roles].sort();
}

/**
 * W0-P5b — the personas a principal may use in the portal: the union over its
 * groups' `personas:` entries under its own provider, in `PERSONAS` order. An
 * unmapped group offers no persona and is not an error; a principal with none
 * still signs in and sees every page (W0-P4 §2). **Never an input to
 * authorization** (see the `personas` field above).
 */
export function personasForPrincipal(
  mapping: readonly GroupRoleMappingFile[],
  principal: MappingMember,
): readonly Persona[] {
  const providerId = providerIdOfSubject(principal.subject);
  const held = new Set<Persona>();
  if (providerId === null) return [];
  for (const doc of mapping) {
    const personas = own(doc.personas, providerId);
    for (const group of principal.groups) {
      for (const persona of own(personas, group)?.personas ?? []) held.add(persona);
    }
  }
  return PERSONAS.filter((p) => held.has(p));
}

/** `<providerId>:<group>` for every group a provider-keyed list names, sorted. */
function qualifiedUnion(
  mapping: readonly GroupRoleMappingFile[],
  pick: (doc: GroupRoleMappingFile) => ProviderGroupLists | undefined,
): readonly string[] {
  const out = new Set<string>();
  for (const doc of mapping) {
    for (const [providerId, groups] of Object.entries(pick(doc) ?? {})) {
      for (const g of groups) out.add(`${providerId}:${g}`);
    }
  }
  return [...out].sort();
}

/** The bare groups a provider-keyed list names for ONE provider, sorted. */
function forProvider(
  mapping: readonly GroupRoleMappingFile[],
  providerId: string,
  pick: (doc: GroupRoleMappingFile) => ProviderGroupLists | undefined,
): readonly string[] {
  const out = new Set<string>();
  for (const doc of mapping) for (const g of own(pick(doc), providerId) ?? []) out.add(g);
  return [...out].sort();
}

/**
 * W0-P28 — the groups that may administer local users in this deployment, as
 * `<providerId>:<group>` (W0-P23), the union of every mapping file's
 * `identityAdmins`, sorted. Empty means nobody may, the fail-closed default.
 */
export function identityAdminGroups(mapping: readonly GroupRoleMappingFile[]): readonly string[] {
  return qualifiedUnion(mapping, (d) => d.identityAdmins);
}

/** W0-P23 — the identity-admin groups of ONE provider, bare (e.g. the local groups). */
export function identityAdminGroupsFor(
  mapping: readonly GroupRoleMappingFile[],
  providerId: string,
): readonly string[] {
  return forProvider(mapping, providerId, (d) => d.identityAdmins);
}

/** W0-P28 — true when the member holds an identity-admin group of ITS OWN provider. */
export function isIdentityAdmin(
  mapping: readonly GroupRoleMappingFile[],
  member: MappingMember,
): boolean {
  return holdsQualifiedGroup(member, identityAdminGroups(mapping));
}

/**
 * W0-P31 — the groups whose members are super admins in this deployment, as
 * `<providerId>:<group>` (W0-P23), the union of every mapping file's
 * `superAdmins`, sorted. Empty means nobody is.
 */
export function superAdminGroups(mapping: readonly GroupRoleMappingFile[]): readonly string[] {
  return qualifiedUnion(mapping, (d) => d.superAdmins);
}

/** W0-P31 — true when the member holds a super-admin group of ITS OWN provider. */
export function isSuperAdmin(
  mapping: readonly GroupRoleMappingFile[],
  member: MappingMember,
): boolean {
  return holdsQualifiedGroup(member, superAdminGroups(mapping));
}

/** W0-P23 — every group ONE provider's part of the `groups:` block maps, bare, sorted. */
export function mappedGroupsFor(
  mapping: readonly GroupRoleMappingFile[],
  providerId: string,
): readonly string[] {
  const out = new Set<string>();
  for (const doc of mapping)
    for (const g of Object.keys(own(doc.groups, providerId) ?? {})) out.add(g);
  return [...out].sort();
}

/**
 * W0-P23 — every provider id the mapping names in any provider-keyed block, or
 * in the prefix of a subject it names, sorted. A provider here that the
 * deployment does not configure grants nobody anything; the gateway reports it.
 */
export function mappedProviderIds(mapping: readonly GroupRoleMappingFile[]): readonly string[] {
  const out = new Set<string>();
  for (const doc of mapping) {
    for (const block of [doc.groups, doc.personas, doc.identityAdmins, doc.superAdmins]) {
      for (const id of Object.keys(block ?? {})) out.add(id);
    }
    for (const s of [
      ...Object.keys(doc.subjectOverrides ?? {}),
      ...(doc.superAdminSubjects ?? []),
    ]) {
      const id = providerIdOfSubject(s);
      if (id !== null) out.add(id);
    }
  }
  return [...out].sort();
}
