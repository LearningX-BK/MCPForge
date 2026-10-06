// MCPForge — W0-Q6: the ONE tool-manifest scaffolder. 02 §2.5.
//
// Pure: no filesystem, no clock, so the CLI (`forge new tool`) and the portal's
// `/build/new` call the same function and there is one template, not two. The
// default answers reproduce the starter `/build/new` has always opened with.
//
// What it will never do: write `identity.carries: verified` (non-negotiable 2 —
// only the probe writes that), write a `database` binding with `write: true`
// (non-negotiable 3), or emit a write tool without a complete `writeSafety`
// skeleton (non-negotiable 4). Fields only a human can supply are emitted as
// `REPLACE…` placeholders and listed by name in `humanFields`.

import { VERBS } from '@mcpforge/shared';

export const BINDING_TYPES = ['rest', 'database', 'plsql', 'function', 'wrapped-vendor'] as const;
export type ScaffoldBindingType = (typeof BINDING_TYPES)[number];
export const SENSITIVITIES = [
  'public',
  'internal',
  'confidential',
  'financial',
  'personal',
] as const;
export type ScaffoldSensitivity = (typeof SENSITIVITIES)[number];

export interface NewToolAnswers {
  /** `{app}.{module}.{entity}.{verb}`. Defaults to the placeholder id. */
  readonly id?: string;
  readonly server?: string;
  readonly title?: string;
  readonly bindingType?: ScaffoldBindingType;
  readonly write?: boolean;
  readonly sensitivity?: ScaffoldSensitivity;
  readonly owner?: string;
  readonly technology?: string;
  readonly ref?: string;
}

export interface ScaffoldFailure {
  readonly ok: false;
  readonly message: string;
  readonly next: string;
}

export interface ScaffoldResult {
  readonly ok: true;
  readonly id: string;
  readonly yaml: string;
  /** Repo-relative path the manifest is proposed at. */
  readonly path: string;
  /** Manifest paths only a human may supply; each is still a placeholder in `yaml`. */
  readonly humanFields: readonly string[];
  readonly next: string;
}

const PLACEHOLDER_ID = 'app.module.entity.verb';
const ID_PATTERN = new RegExp(`^([a-z0-9_]+)\\.([a-z0-9_]+)\\.([a-z0-9_]+)\\.(${VERBS.join('|')})$`);
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

const READ_VERBS = new Set<string>([
  'search',
  'get',
  'list',
  'get_status',
  'get_receipt_status',
  'get_approval_status',
  'explain',
  'download',
]);

/** Dry-run strategy per binding type (02 §3.1, §3.5). Never `none`. */
const DRY_RUN: Readonly<Record<ScaffoldBindingType, string>> = {
  rest: 'native',
  database: 'precondition-read', // unreachable: a database write is refused first
  plsql: 'validate-pair',
  function: 'validate-pair',
  'wrapped-vendor': 'precondition-read',
};

function fail(message: string, next: string): ScaffoldFailure {
  return { ok: false, message, next };
}

export function scaffoldTool(answers: NewToolAnswers = {}): ScaffoldResult | ScaffoldFailure {
  const id = answers.id ?? PLACEHOLDER_ID;
  const parts =
    id === PLACEHOLDER_ID ? [id, 'app', 'module', 'entity', 'get'] : ID_PATTERN.exec(id);
  if (parts === null) {
    return fail(
      `"${id}" is not a valid tool id. Ids are {app}.{module}.{entity}.{verb}, lower snake, and the verb comes from the closed list.`,
      `Pass --id <app>.<module>.<entity>.<verb> with a verb from: ${VERBS.join(', ')}.`,
    );
  }
  const [, app, module, entity, verb] = parts as unknown as [string, string, string, string, string];

  const bindingType = answers.bindingType ?? 'rest';
  if (!BINDING_TYPES.includes(bindingType)) {
    return fail(
      `Unknown binding type "${String(bindingType)}".`,
      `Pass --binding-type as one of: ${BINDING_TYPES.join(', ')}.`,
    );
  }
  const sensitivity = answers.sensitivity ?? 'internal';
  if (!SENSITIVITIES.includes(sensitivity)) {
    return fail(
      `Unknown sensitivity "${String(sensitivity)}".`,
      `Pass --sensitivity as one of: ${SENSITIVITIES.join(', ')}.`,
    );
  }
  if (answers.server !== undefined && !SLUG.test(answers.server)) {
    return fail(
      `"${answers.server}" is not a valid server id.`,
      'Pass --server with an id from manifests/_servers/, or register one with "New module server" on the Build page.',
    );
  }
  const write = answers.write ?? false;
  if (write && bindingType === 'database') {
    return fail(
      '`database` bindings are read-only by policy (CLAUDE.md non-negotiable 3); write: true with binding.type: database is rejected.',
      'Scaffold this tool with --binding-type plsql (a wrapper package, never raw DML) or --binding-type rest, or drop --write.',
    );
  }
  if (write && READ_VERBS.has(verb)) {
    return fail(
      `Verb "${verb}" is a read verb and cannot be a write tool.`,
      'Choose a write verb (create, update, cancel, submit, approve, release, run_process, simulate, reconcile, resolve) or drop --write.',
    );
  }

  const humanFields: string[] = [];
  const human = (path: string, value: string): string => {
    humanFields.push(path);
    return value;
  };
  const q = (s: string): string => JSON.stringify(s);

  const title = answers.title ?? human('title', 'REPLACE ME');
  const server = answers.server ?? human('server', 'REPLACE_ME');
  const purpose = human('purpose', 'REPLACE — what this tool does, verb-first, at most 14 words.');
  const functionalArea = human('functionalArea', 'REPLACE ME');
  const technology = answers.technology ?? human('binding.technology', 'REPLACE ME');
  const ref = answers.ref ?? human('binding.ref', 'REPLACE_ME');
  const summary = human('output.summaryTemplate', 'REPLACE ME');
  const owner = answers.owner ?? human('governance.owner', 'REPLACE ME');
  const steward = human('governance.steward', '<named person, filled at intake>');
  const intentsFile = human('eval.intentsFile', 'evals/REPLACE_ME/intents.yaml');

  const lines: string[] = [
    'apiVersion: mcpforge/v1',
    'kind: Tool',
    `id: ${id}`,
    'version: 1.0.0',
    `server: ${server}`,
    `title: ${title}`,
    '',
    `purpose: ${purpose}`,
  ];
  if (write) {
    lines.push(
      `disambiguation: ${q(human('disambiguation', 'REPLACE — name the sibling tools this is NOT, and what to call instead.'))}`,
    );
  }
  lines.push(
    'archetype: transactional',
    `verb: ${verb}`,
    `entity: ${entity}`,
    `app: ${app}`,
    `module: ${module}`,
    `functionalArea: ${functionalArea}`,
    `sensitivity: ${sensitivity}`,
    `write: ${String(write)}`,
    '',
    'binding:',
    `  type: ${bindingType}`,
    `  technology: ${technology}`,
    `  ref: ${ref}`,
    '  identity:',
    '    carries: unverified',
    '    probe: MCPFORGE_PROBE_WHOAMI',
    '    onServiceAccount: block',
    `    echoOn: ${write ? 'write' : 'never'}`,
    '',
    'input: []',
    '',
    'output:',
    `  summaryTemplate: ${q(summary)}`,
    '  resultKeys: []',
  );

  if (write) {
    const strategy = DRY_RUN[bindingType];
    const approval = strategy === 'precondition-read' && sensitivity === 'financial';
    const dryRunRef = human('writeSafety.dryRun.ref', 'REPLACE_ME');
    const planTemplate = human(
      'writeSafety.confirm.planTemplate',
      'REPLACE — name the system, the object, the amounts and the business consequence in plain words.',
    );
    const reversalTool = human('writeSafety.reversal.tool', 'REPLACE_ME');
    humanFields.push(
      'writeSafety.reversal.argMap',
      'writeSafety.reversal.preconditions',
      'output.resultKeys',
    );
    lines.push(
      '',
      'writeSafety:',
      '  dryRun:',
      `    strategy: ${strategy}`,
      ...(strategy === 'native' ? [] : [`    ref: ${dryRunRef}`]),
      '  confirm:',
      '    required: true',
      '    tokenTtlSeconds: 300',
      `    planTemplate: ${q(planTemplate)}`,
      `  humanApprovalRequired: ${String(approval)}`,
      '  reversal:',
      '    class: compensating-tool',
      `    tool: ${reversalTool}`,
      '    argMap: {}',
      '    windowHours: 24',
      '    preconditions: REPLACE ME',
      '  idempotency: { scopeHours: 24 }',
      '  guardrails: []',
    );
  }

  lines.push(
    '',
    'governance:',
    '  reviewPath: standard',
    `  owner: ${owner}`,
    `  steward: ${steward}`,
    '',
    'eval:',
    `  intentsFile: ${intentsFile}`,
    '  minIntents: 10',
    '',
  );
  humanFields.push('input');

  return {
    ok: true,
    id,
    yaml: lines.join('\n'),
    path: `manifests/${app}/${module}/${entity}.${verb}.tool.yaml`,
    humanFields,
    next:
      `Fill the ${humanFields.length} human-supplied field(s) named above, have the module steward author the eval intents ` +
      `(at least 10, in ${intentsFile}), then run "forge validate" before proposing.`,
  };
}
