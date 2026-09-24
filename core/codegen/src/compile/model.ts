// MCPForge — reading Role / Package / Consumer documents for compilation. W0-B8.
//
// These readers are DELIBERATELY tolerant of a document that did not pass the
// Ajv schema: compilation reads the raw parsed YAML, exactly as the W0-B3
// policy rules do (see rules/helpers.ts's note). A compiler that only ran on
// schema-clean documents could be silenced by adding one more structural
// error, and silencing SoD detection is precisely the escalation this task
// exists to make impossible.

import type { IndexedManifest, RepoContext } from '../validate/types.js';

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function manifestsOfKind(
  ctx: RepoContext,
  kind: IndexedManifest['kind'],
): readonly IndexedManifest[] {
  return ctx.manifests.filter((m) => m.kind === kind);
}

/** Every Tool id in the repo, sorted. The universe a role's globs resolve against. */
export function allToolIds(ctx: RepoContext): string[] {
  return manifestsOfKind(ctx, 'Tool')
    .map((m) => m.id)
    .sort();
}

/** One declared SoD conflict, as authored on a Role (02 §4.3). */
export interface SodConflictView {
  readonly index: number;
  readonly conflict: readonly string[];
  /** `warn` | `warn-and-require-exception` | `block`, or whatever the file actually said. */
  readonly disposition: string;
}

/** A `bindingGrant` as authored on a Role or a Consumer (common.schema.json `bindingGrant`). */
export interface BindingGrantView {
  readonly index: number;
  readonly bindingType: string;
  readonly names: readonly string[];
  readonly approvalRef: string;
  readonly approver: string;
  readonly expiresAt: string;
  readonly standingAuthorization?: string;
}

export interface RoleView {
  readonly id: string;
  readonly label: string;
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
  readonly coreTools: readonly string[];
  readonly sensitivityCeiling: string;
  readonly writeAllowed: boolean;
  readonly budgetTokens: number | null;
  readonly mutuallyExclusiveWith: readonly string[];
  readonly segregationOfDuties: readonly SodConflictView[];
  readonly bindingGrants: readonly BindingGrantView[];
}

function readGrants(doc: Record<string, unknown>): BindingGrantView[] {
  const raw = doc['bindingGrants'];
  if (!Array.isArray(raw)) return [];
  const out: BindingGrantView[] = [];
  raw.forEach((g, index) => {
    if (!isRecord(g)) return;
    out.push({
      index,
      bindingType: typeof g['bindingType'] === 'string' ? g['bindingType'] : '',
      names: stringArray(g['names']),
      approvalRef: typeof g['approvalRef'] === 'string' ? g['approvalRef'] : '',
      approver: typeof g['approver'] === 'string' ? g['approver'] : '',
      expiresAt: typeof g['expiresAt'] === 'string' ? g['expiresAt'] : '',
      ...(typeof g['standingAuthorization'] === 'string'
        ? { standingAuthorization: g['standingAuthorization'] }
        : {}),
    });
  });
  return out;
}

export function readRole(m: IndexedManifest): RoleView {
  const doc = m.doc;
  const sod: SodConflictView[] = [];
  const rawSod = doc['segregationOfDuties'];
  if (Array.isArray(rawSod)) {
    rawSod.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      sod.push({
        index,
        conflict: stringArray(entry['conflict']),
        disposition: typeof entry['disposition'] === 'string' ? entry['disposition'] : '',
      });
    });
  }
  return {
    id: m.id,
    label: typeof doc['label'] === 'string' ? doc['label'] : m.id,
    includes: stringArray(doc['includes']),
    excludes: stringArray(doc['excludes']),
    coreTools: stringArray(doc['coreTools']),
    sensitivityCeiling:
      typeof doc['sensitivityCeiling'] === 'string' ? doc['sensitivityCeiling'] : '',
    writeAllowed: doc['writeAllowed'] === true,
    budgetTokens: typeof doc['budgetTokens'] === 'number' ? doc['budgetTokens'] : null,
    mutuallyExclusiveWith: stringArray(doc['mutuallyExclusiveWith']),
    segregationOfDuties: sod,
    bindingGrants: readGrants(doc),
  };
}

export interface PackageView {
  readonly id: string;
  readonly label: string;
  readonly servers: readonly string[];
  readonly roles: readonly string[];
  readonly portal: string;
}

export function readPackage(m: IndexedManifest): PackageView {
  const doc = m.doc;
  return {
    id: m.id,
    label: typeof doc['label'] === 'string' ? doc['label'] : m.id,
    servers: stringArray(doc['servers']),
    roles: stringArray(doc['roles']),
    portal: typeof doc['portal'] === 'string' ? doc['portal'] : '',
  };
}

export interface ConsumerView {
  readonly id: string;
  readonly label: string;
  readonly consumerClass: string;
  readonly status: string;
  readonly expiresAt: string;
  readonly bindingTypes: readonly string[];
  readonly maxSensitivity: string;
  readonly writeAllowed: boolean;
  readonly roles: readonly string[];
  readonly packages: readonly string[];
  readonly limits: Record<string, unknown>;
  readonly humanInTheLoop: boolean;
  readonly networkOrigins: readonly string[];
  readonly bindingGrants: readonly BindingGrantView[];
}

export function readConsumer(m: IndexedManifest): ConsumerView {
  const doc = m.doc;
  const auth = isRecord(doc['authorizations']) ? doc['authorizations'] : {};
  const limits = isRecord(doc['limits']) ? doc['limits'] : {};
  const attestation = isRecord(doc['attestation']) ? doc['attestation'] : {};
  return {
    id: m.id,
    label: typeof doc['label'] === 'string' ? doc['label'] : m.id,
    consumerClass: typeof doc['class'] === 'string' ? doc['class'] : '',
    status: typeof doc['status'] === 'string' ? doc['status'] : '',
    expiresAt: typeof doc['expiresAt'] === 'string' ? doc['expiresAt'] : '',
    bindingTypes: stringArray(auth['bindingTypes']),
    maxSensitivity: typeof auth['maxSensitivity'] === 'string' ? auth['maxSensitivity'] : '',
    // Absent/unreadable `writeAllowed` compiles to FALSE, never true.
    writeAllowed: auth['writeAllowed'] === true,
    roles: stringArray(auth['roles']),
    packages: stringArray(auth['packages']),
    limits: {
      callsPerMinute: typeof limits['callsPerMinute'] === 'number' ? limits['callsPerMinute'] : 0,
      writesPerDay: typeof limits['writesPerDay'] === 'number' ? limits['writesPerDay'] : 0,
      concurrentSessions:
        typeof limits['concurrentSessions'] === 'number' ? limits['concurrentSessions'] : 0,
      ...(typeof limits['operatingWindow'] === 'string'
        ? { operatingWindow: limits['operatingWindow'] }
        : {}),
    },
    // Absent/unreadable attestation compiles to humanInTheLoop: false, which
    // is the RESTRICTIVE direction: 02 §11.2 makes `false` force
    // humanApprovalRequired on every write this consumer attempts.
    humanInTheLoop: attestation['humanInTheLoop'] === true,
    networkOrigins: stringArray(attestation['networkOrigins']),
    bindingGrants: readGrants(doc),
  };
}
