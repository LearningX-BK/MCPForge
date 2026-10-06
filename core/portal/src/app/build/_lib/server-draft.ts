// MCPForge — W0-Q3: the pure half of "New module server" (02 §4.1).
//
// A server draft is a `kind: Server` manifest at `manifests/_servers/<id>.server.yaml`
// (the location every committed server and the referential rule's own `next`
// use). The form is the ONLY input and the YAML is derived from it, so the two
// can never disagree. Nothing here writes anywhere: Save draft hands the text to
// the ChangeHost, which puts it on a branch.
//
// The field list is exactly `core/codegen/schema/server.schema.json`'s, which is
// permissive and marked NEEDS_HUMAN for a worked example. This form adds no field
// to it. Steward is required HERE (the task asks for a named owner) though the
// schema leaves it optional; a placeholder is never supplied on the user's behalf.

import { parse, stringify } from 'yaml';

/** The branch prefix a server draft saves under: `forge/build-server-<id>`. */
export const SERVER_BRANCH_PREFIX = 'forge/build-server-';

export const SERVER_MODES = ['A', 'B'] as const;
export type ServerMode = (typeof SERVER_MODES)[number];

export interface ServerForm {
  readonly id: string;
  readonly label: string;
  readonly app: string;
  readonly module: string;
  readonly version: string;
  readonly mode: ServerMode;
  readonly promotionReason: string;
  readonly owner: string;
  readonly steward: string;
}

export const EMPTY_SERVER_FORM: ServerForm = {
  id: '',
  label: '',
  app: '',
  module: '',
  version: '1.0.0',
  mode: 'A',
  promotionReason: '',
  owner: '',
  steward: '',
};

/** 01 §2's split rule, verbatim, shown beside the form. */
export const SPLIT_RULE_TEXT =
  'Server boundary = module, 5–15 tools per server. Split when any two of: more than 15–20 tools · a different auth boundary · a different owning team · a different release cadence · a different data-sensitivity class.';

/** 02 §4.1's promotion conditions: the only reasons for Mode B. */
export const PROMOTION_CONDITIONS = [
  'It needs a runtime the gateway does not have (the Python Oracle worker is always Mode B).',
  'It has a materially different auth boundary.',
  'It carries a different data-sensitivity class needing process isolation.',
  'Its release cadence is genuinely independent and its blast radius on restart is unacceptable.',
  'It is a wrapped-vendor server.',
] as const;

export const serverManifestPath = (id: string): string => `manifests/_servers/${id}.server.yaml`;

export const serverBranchFor = (id: string): string =>
  `${SERVER_BRANCH_PREFIX}${id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;

/** The YAML a form produces. Key order matches the committed servers. */
export function serverYaml(form: ServerForm): string {
  const doc: Record<string, string> = {
    apiVersion: 'mcpforge/v1',
    kind: 'Server',
    id: form.id.trim(),
    label: form.label.trim(),
    app: form.app.trim(),
    module: form.module.trim(),
    version: form.version.trim(),
    mode: form.mode,
  };
  if (form.mode === 'B') doc['promotionReason'] = form.promotionReason.trim();
  doc['owner'] = form.owner.trim();
  doc['steward'] = form.steward.trim();
  return stringify(doc, { lineWidth: 0 });
}

const SLUG = /^[a-z0-9][a-z0-9._-]*$/;
const IDENT = /^[a-z0-9_]+$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface FieldProblem {
  readonly field: keyof ServerForm;
  readonly message: string;
}

/**
 * Cheap, same-keystroke problems. These are a courtesy: the authority is the
 * real `forge validate` in the checks pane (the same schema, plus the policy
 * rules), never a second validator here.
 */
export function formProblems(form: ServerForm): readonly FieldProblem[] {
  const out: FieldProblem[] = [];
  const need = (field: keyof ServerForm, ok: boolean, message: string) => {
    if (!ok) out.push({ field, message });
  };
  need('id', SLUG.test(form.id), 'Use lower-case letters, digits, "-", "_" or ".", starting with a letter or digit.');
  need('label', form.label.trim().length > 0, 'Give the server a human label.');
  need('app', IDENT.test(form.app), 'App is lower-case letters, digits and "_" (for example jde).');
  need('module', IDENT.test(form.module), 'Module is lower-case letters, digits and "_" (for example fin).');
  need('version', SEMVER.test(form.version), 'Use a semantic version such as 1.0.0.');
  need('owner', form.owner.trim().length > 0, 'Name the owning team.');
  need('steward', form.steward.trim().length > 0, 'Name the steward, a person. No placeholder is filled in for you.');
  if (form.mode === 'B') {
    need('promotionReason', form.promotionReason.trim().length > 0, 'Mode B needs one of 02 §4.1\'s promotion conditions, in words.');
  }
  return out;
}

/** A committed server, as the duplicate check needs it. */
export interface ExistingServer {
  readonly id: string;
  readonly label: string;
  readonly app: string;
  readonly module: string;
}

export type BoundaryWarning =
  | { readonly kind: 'same-id'; readonly server: ExistingServer; readonly message: string }
  | { readonly kind: 'same-module'; readonly server: ExistingServer; readonly message: string };

/**
 * "Would this server duplicate an existing module boundary?" A module is the
 * server boundary (01 §2), so a second server for an app + module already served
 * is a boundary duplicate; the same id is a collision, and ids are immutable.
 * A warning, never a block: a legitimate split (a different auth boundary or
 * owning team) is allowed, and the form says what justifies one.
 */
export function boundaryWarnings(
  form: ServerForm,
  existing: readonly ExistingServer[],
): readonly BoundaryWarning[] {
  const out: BoundaryWarning[] = [];
  for (const s of existing) {
    if (form.id.trim() !== '' && s.id === form.id.trim()) {
      out.push({
        kind: 'same-id',
        server: s,
        message: `A server "${s.id}" already exists. Ids are immutable and cannot be reused; to change it, edit its manifest instead.`,
      });
    } else if (form.app.trim() !== '' && s.app === form.app.trim() && s.module === form.module.trim()) {
      out.push({
        kind: 'same-module',
        server: s,
        message: `"${s.id}" already serves ${s.app} · ${s.module}. A module is the server boundary, so add tools to it unless you can name a split-rule input: a different auth boundary, owning team, release cadence or data-sensitivity class.`,
      });
    }
  }
  return out;
}

/** Re-open a saved server draft's manifest in the form. Unknown or missing fields come back empty. */
export function formFromYaml(yaml: string): ServerForm {
  let doc: Record<string, unknown> = {};
  try {
    const parsed = parse(yaml) as unknown;
    if (parsed !== null && typeof parsed === 'object') doc = parsed as Record<string, unknown>;
  } catch {
    // A draft that no longer parses reopens empty rather than throwing.
  }
  const str = (k: string): string => (typeof doc[k] === 'string' ? (doc[k] as string) : '');
  return {
    id: str('id'),
    label: str('label'),
    app: str('app'),
    module: str('module'),
    version: str('version') || EMPTY_SERVER_FORM.version,
    mode: doc['mode'] === 'B' ? 'B' : 'A',
    promotionReason: str('promotionReason'),
    owner: str('owner'),
    steward: str('steward'),
  };
}
