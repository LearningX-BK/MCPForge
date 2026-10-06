// MCPForge — `forge new tool`. W0-Q6, 02 §2.5.
//
//   forge new tool --id <app.module.entity.verb> [--server <id>] [--binding-type <t>]
//                  [--write] [--sensitivity <s>] [--title <t>] [--owner <team>]
//                  [--technology <t>] [--ref <r>] [--answers <file>] [--by <subject>]
//                  [--root <dir>] [--json]
//
// Answers come from flags or `--answers <file>` (JSON or YAML; flags win) — never
// an interactive prompt, so the build lane and CI can drive it.
//
// The scaffold is STAGED, not written: it lands under
// `.mcpforge/proposals/<id>/files/manifests/...` with a `proposal.json`, exactly
// like the consumer registry's proposals, and `manifests/` is never touched
// (the portal writes to git through the change flow, not the working tree).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { findRepoRoot } from '@mcpforge/ci';
import { parse as parseYaml } from 'yaml';
import {
  scaffoldTool,
  type NewToolAnswers,
  type ScaffoldBindingType,
  type ScaffoldSensitivity,
} from './new-tool-scaffold.js';

export interface NewToolOptions {
  readonly json: boolean;
  readonly id?: string;
  readonly server?: string;
  readonly title?: string;
  readonly bindingType?: string;
  readonly write?: boolean;
  readonly sensitivity?: string;
  readonly owner?: string;
  readonly technology?: string;
  readonly ref?: string;
  readonly answers?: string;
  readonly by?: string;
  readonly root?: string;
}

const USAGE_EXIT_CODE = 64;

function emitError(message: string, next: string, json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: false, code: 'INPUT_INVALID', message, next })}\n`);
  } else {
    process.stderr.write(`forge: new tool — ${message}\n`);
    process.stderr.write(`forge: next — ${next}\n`);
  }
  return USAGE_EXIT_CODE;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Drops undefined keys, so `exactOptionalPropertyTypes` holds and flags only override what they set. */
function defined<T extends object>(o: { [K in keyof T]?: T[K] | undefined }): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function readAnswersFile(path: string): NewToolAnswers | string {
  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(path, 'utf8'));
  } catch (e) {
    return `Cannot read answers file ${path}: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return `Answers file ${path} must be a JSON or YAML mapping.`;
  }
  const r = doc as Record<string, unknown>;
  return defined<NewToolAnswers>({
    id: str(r['id']),
    server: str(r['server']),
    title: str(r['title']),
    bindingType: str(r['bindingType']) as ScaffoldBindingType | undefined,
    write: typeof r['write'] === 'boolean' ? r['write'] : undefined,
    sensitivity: str(r['sensitivity']) as ScaffoldSensitivity | undefined,
    owner: str(r['owner']),
    technology: str(r['technology']),
    ref: str(r['ref']),
  });
}

export function runNewToolCommand(opts: NewToolOptions): number {
  const fromFile = opts.answers === undefined ? {} : readAnswersFile(opts.answers);
  if (typeof fromFile === 'string') {
    return emitError(fromFile, 'Pass a readable JSON or YAML mapping to --answers, or use flags.', opts.json);
  }
  const answers: NewToolAnswers = {
    ...defined(fromFile),
    ...defined<NewToolAnswers>({
      id: opts.id,
      server: opts.server,
      title: opts.title,
      bindingType: opts.bindingType as ScaffoldBindingType | undefined,
      write: opts.write === true ? true : undefined,
      sensitivity: opts.sensitivity as ScaffoldSensitivity | undefined,
      owner: opts.owner,
      technology: opts.technology,
      ref: opts.ref,
    }),
  };
  if (answers.id === undefined) {
    return emitError(
      'A tool id is required.',
      'Run "forge new tool --id <app>.<module>.<entity>.<verb> [--write] [--binding-type rest|database|plsql|function|wrapped-vendor] [--server <id>]".',
      opts.json,
    );
  }

  const scaffold = scaffoldTool(answers);
  if (!scaffold.ok) return emitError(scaffold.message, scaffold.next, opts.json);

  const repoRoot = opts.root ?? findRepoRoot();
  if (existsSync(join(repoRoot, scaffold.path))) {
    return emitError(
      `${scaffold.path} already exists. Tool ids are immutable and a scaffold never overwrites a manifest.`,
      `Edit the existing manifest through a draft, or choose a different entity/verb. A rename is a retire-and-create pair.`,
      opts.json,
    );
  }

  const proposalId = `new-tool-${scaffold.id.replace(/\./g, '-')}`;
  const directory = join(repoRoot, '.mcpforge', 'proposals', proposalId);
  const stagedPath = join(directory, 'files', ...scaffold.path.split('/'));
  mkdirSync(dirname(stagedPath), { recursive: true });
  writeFileSync(stagedPath, scaffold.yaml, 'utf8');
  writeFileSync(
    join(directory, 'proposal.json'),
    `${JSON.stringify(
      {
        proposalId,
        kind: 'new-tool',
        toolId: scaffold.id,
        summary: `Scaffold ${scaffold.id}`,
        requestedBy: opts.by ?? null,
        state: 'draft',
        humanFields: scaffold.humanFields,
        files: [scaffold.path],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const payload = {
    ok: true as const,
    proposalId,
    toolId: scaffold.id,
    state: 'draft' as const,
    target: scaffold.path,
    staged: stagedPath,
    humanFields: scaffold.humanFields,
    next: `${scaffold.next} Nothing under manifests/ has been written: review ${stagedPath} and apply it in a change proposal.`,
  };
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    process.stdout.write(
      [
        `forge new tool: staged ${scaffold.id} (nothing was written to manifests/).`,
        `  proposes: ${scaffold.path}`,
        `  staged at ${stagedPath}`,
        `  human-supplied fields (${scaffold.humanFields.length}): ${scaffold.humanFields.join(', ')}`,
        `forge: next — ${payload.next}`,
        '',
      ].join('\n'),
    );
  }
  return 0;
}
