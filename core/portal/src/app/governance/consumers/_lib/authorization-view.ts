// MCPForge — W0-N12: the pure half of the Consumers tab. No fs, no server
// action, so it is directly unit-testable and reusable by the client editor.
//
// Its whole job is to turn the bytes of a compiled
// `generated/consumers/<id>.authorization.json` into the explicit rows 03 §16.2
// asks for, WITHOUT deciding anything the compiler already decided:
//   * `expired` on a grant is read, never recomputed — `grantIsExpired` is
//     fail-closed in the compiler and a second opinion here could disagree
//     with the artefact a reviewer approved;
//   * the standing authorization's `status` and `effective` are read, never
//     re-resolved — `resolveStandingAuthorization` owns that;
//   * the only thing this file COMPUTES is how many days remain, because
//     "within 30 days" is a presentation threshold 03 §16.2 states and the
//     artefact does not carry.
import type {
  AuthorizationListDelta,
  AuthorizationScalarDelta,
  AuthorizationValueRow,
  CompiledConsumerDraft,
  ConsumerSource,
  GrantExpiryView,
  GrantRowView,
  StandingAuthorizationView,
} from '../types';

/** 03 §16.2: "chipped `--status-write` within 30 days of expiry". */
export const EXPIRY_WARNING_DAYS = 30;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function str(record: Record<string, unknown>, key: string): string {
  const v = record[key];
  return typeof v === 'string' ? v : '';
}

/** Whole days between two ISO dates, `to - from`. */
export function daysBetween(from: string, to: string): number | null {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * The expiry chip for one dated grant.
 *
 * `expired` is the COMPILER's verdict and it wins outright: a grant the
 * compiler calls expired is `--status-danger` even if the date reads as
 * in-future for some reason (an unparseable date compiles to expired, which
 * is the fail-closed direction and must not be softened here). Only when the
 * compiler says the grant is live does the 30-day window get consulted.
 */
export function grantExpiryView(
  expiresAt: string,
  expired: boolean,
  today: string,
): GrantExpiryView {
  const daysRemaining = daysBetween(today, expiresAt);
  if (expired) {
    return {
      state: 'expired',
      daysRemaining,
      token: 'status-danger',
      label: ISO_DATE.test(expiresAt) ? `Expired ${expiresAt}` : 'Expired — no usable expiry',
      srLabel: ISO_DATE.test(expiresAt)
        ? `This grant expired on ${expiresAt}. It authorizes nothing.`
        : 'This grant states no usable expiry date, so it is treated as expired and authorizes nothing.',
    };
  }
  if (daysRemaining === null) {
    return {
      state: 'undated',
      daysRemaining: null,
      token: 'status-neutral',
      label: 'No expiry recorded',
      srLabel: 'No expiry date is recorded for this grant.',
    };
  }
  if (daysRemaining <= EXPIRY_WARNING_DAYS) {
    return {
      state: 'expiring',
      daysRemaining,
      token: 'status-write',
      label: `Expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`,
      srLabel: `This grant expires on ${expiresAt}, in ${daysRemaining} days. Renewal is a fresh approval, not a no-op.`,
    };
  }
  return {
    state: 'live',
    daysRemaining,
    token: 'status-ok',
    label: `Expires ${expiresAt}`,
    srLabel: `This grant is in force until ${expiresAt}, ${daysRemaining} days from now.`,
  };
}

/**
 * The standing-authorization block, as resolved by the compiler. A block whose
 * `effective` is false is chipped as expired regardless of its date: 02
 * §11.4.4's ineffective standing authorization reverts the write to a forced
 * per-call approval, and rendering it as "live" would tell an operator the
 * opposite of what the gateway will do.
 */
export function standingView(raw: unknown, today: string): StandingAuthorizationView | null {
  if (!isRecord(raw)) return null;
  const effective = raw['effective'] === true;
  const expiresAt = str(raw, 'expiresAt');
  return {
    ref: str(raw, 'ref'),
    status: str(raw, 'status'),
    approver: str(raw, 'approver'),
    expiresAt,
    effective,
    expiry: grantExpiryView(expiresAt, !effective, today),
  };
}

/** One compiled `bindingGrants[]` entry as a row. */
export function grantRow(raw: unknown, today: string): GrantRowView | null {
  if (!isRecord(raw)) return null;
  const expiresAt = str(raw, 'expiresAt');
  const expired = raw['expired'] === true;
  return {
    bindingType: str(raw, 'bindingType'),
    names: strings(raw['names']),
    approvalRef: str(raw, 'approvalRef'),
    approver: str(raw, 'approver'),
    expiresAt,
    expired,
    expiry: grantExpiryView(expiresAt, expired, today),
    standing: standingView(raw['standingAuthorization'], today),
  };
}

/** Sorted set difference over two string lists — the same shape `scope-diff` uses. */
export function listDelta(
  field: string,
  base: readonly string[],
  next: readonly string[],
): AuthorizationListDelta {
  const baseSet = new Set(base);
  const nextSet = new Set(next);
  return {
    field,
    values: [...nextSet].sort(),
    added: [...nextSet].filter((v) => !baseSet.has(v)).sort(),
    removed: [...baseSet].filter((v) => !nextSet.has(v)).sort(),
  };
}

interface ParsedArtefact {
  readonly bindingTypes: readonly string[];
  readonly roles: readonly string[];
  readonly packages: readonly string[];
  readonly maxSensitivity: string;
  readonly writeAllowed: boolean;
  readonly effectiveStatus: string;
  readonly humanInTheLoop: boolean;
  readonly networkOrigins: readonly string[];
}

/** The authorization-bearing fields of a compiled artefact. `null` when unparseable. */
export function parseAuthorization(json: string): ParsedArtefact | null {
  if (json.trim() === '') return null;
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(doc)) return null;
  const auth = isRecord(doc['authorizations']) ? doc['authorizations'] : {};
  const attestation = isRecord(doc['attestation']) ? doc['attestation'] : {};
  return {
    bindingTypes: strings(auth['bindingTypes']),
    roles: strings(auth['roles']),
    packages: strings(auth['packages']),
    maxSensitivity: str(auth, 'maxSensitivity'),
    writeAllowed: auth['writeAllowed'] === true,
    effectiveStatus: str(doc, 'effectiveStatus'),
    humanInTheLoop: attestation['humanInTheLoop'] === true,
    networkOrigins: strings(attestation['networkOrigins']),
  };
}

/**
 * The full right-pane view of one compiled artefact, diffed against the
 * merged one. A field the merged artefact does not carry (because the record
 * is new, or was never compiled) is reported as a change FROM the empty value
 * rather than suppressed — 02 §11.2's whole reason for compiling a consumer is
 * that a widening is a diff, and a first registration is the widest one there is.
 */
export function buildCompiledView(
  consumerId: string,
  artefactJson: string,
  mergedArtefactJson: string,
  today: string,
): Omit<CompiledConsumerDraft, 'error'> | null {
  let doc: unknown;
  try {
    doc = JSON.parse(artefactJson);
  } catch {
    return null;
  }
  if (!isRecord(doc)) return null;
  const auth = isRecord(doc['authorizations']) ? doc['authorizations'] : {};
  const attestation = isRecord(doc['attestation']) ? doc['attestation'] : {};
  const limitsRaw = isRecord(doc['limits']) ? doc['limits'] : {};
  const merged = parseAuthorization(mergedArtefactJson);

  const bindingTypes = strings(auth['bindingTypes']);
  const roles = strings(auth['roles']);
  const packages = strings(auth['packages']);
  const networkOrigins = strings(attestation['networkOrigins']);
  const maxSensitivity = str(auth, 'maxSensitivity');
  const writeAllowed = auth['writeAllowed'] === true;
  const humanInTheLoop = attestation['humanInTheLoop'] === true;
  const effectiveStatus = str(doc, 'effectiveStatus');

  const limits: AuthorizationValueRow[] = Object.keys(limitsRaw)
    .sort()
    .map((field) => ({ field, value: String(limitsRaw[field]) }));

  const listDeltas: AuthorizationListDelta[] = [
    listDelta('bindingTypes', merged?.bindingTypes ?? [], bindingTypes),
    listDelta('roles', merged?.roles ?? [], roles),
    listDelta('packages', merged?.packages ?? [], packages),
    listDelta('networkOrigins', merged?.networkOrigins ?? [], networkOrigins),
  ];

  const scalar = (field: string, before: string, after: string): AuthorizationScalarDelta | null =>
    before === after ? null : { field, before, after };
  const scalarDeltas = [
    scalar('maxSensitivity', merged?.maxSensitivity ?? '', maxSensitivity),
    scalar('writeAllowed', String(merged?.writeAllowed ?? false), String(writeAllowed)),
    scalar('effectiveStatus', merged?.effectiveStatus ?? '', effectiveStatus),
    scalar(
      'attestation.humanInTheLoop',
      String(merged?.humanInTheLoop ?? false),
      String(humanInTheLoop),
    ),
  ].filter((d): d is AuthorizationScalarDelta => d !== null);

  const grants = (Array.isArray(doc['bindingGrants']) ? doc['bindingGrants'] : [])
    .map((g) => grantRow(g, today))
    .filter((g): g is GrantRowView => g !== null);

  return {
    consumerId,
    artefactJson,
    label: str(doc, 'label'),
    consumerClass: str(doc, 'class'),
    status: str(doc, 'status'),
    effectiveStatus,
    expiresAt: str(doc, 'expiresAt'),
    expired: doc['expired'] === true,
    bindingTypes,
    maxSensitivity,
    writeAllowed,
    roles,
    packages,
    limits,
    humanInTheLoop,
    networkOrigins,
    grants,
    listDeltas,
    scalarDeltas,
  };
}

/**
 * The files a change proposal carries for one consumer edit.
 *
 * THIS IS THE done: CRITERION MADE LITERAL, exactly as `scope-diff.ts`'s
 * `proposalFiles` is for a role: the proposal is
 * `{ consumers/<id>.consumer.yaml, generated/consumers/<id>.authorization.json }`
 * and the second file's bytes are what the REAL compiler wrote during the live
 * compile — never a summary, never a hand-built JSON. So the proposal's diff
 * IS the compiled authorization artefact.
 */
export function proposalFiles(
  source: Pick<ConsumerSource, 'path' | 'artefactPath'>,
  yamlText: string,
  draft: Pick<CompiledConsumerDraft, 'artefactJson' | 'error'> | undefined,
): Readonly<Record<string, string>> {
  if (draft === undefined || draft.error !== undefined) return {};
  return {
    [source.path]: yamlText,
    [source.artefactPath]: draft.artefactJson,
  };
}

/** True when this edit is proposable: it compiled, and it changed something. */
export function canProposeEdit(
  source: Pick<ConsumerSource, 'yamlText' | 'isNew'>,
  yamlText: string,
  draft: Pick<CompiledConsumerDraft, 'artefactJson' | 'error'> | undefined,
): boolean {
  if (draft === undefined || draft.error !== undefined) return false;
  if (source.isNew) return yamlText.trim() !== '';
  return yamlText.trim() !== source.yamlText.trim();
}

/**
 * Grants an operator must act on first: expired, then expiring, then the rest.
 * Within a state, deterministic by binding type and approval ref.
 */
export function sortGrants(grants: readonly GrantRowView[]): readonly GrantRowView[] {
  const rank = (g: GrantRowView) =>
    g.expiry.state === 'expired' ? 0 : g.expiry.state === 'expiring' ? 1 : 2;
  return [...grants].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.bindingType.localeCompare(b.bindingType) ||
      a.approvalRef.localeCompare(b.approvalRef),
  );
}
