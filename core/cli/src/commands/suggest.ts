// MCPForge — `forge suggest`. W0-Q9, docs/build-plan/w0-q8-assisted-authoring.md.
//
//   forge suggest <manifest> --field <field> [--input <name>] [--provider <id>]
//                 [--dry-run] [--accept --by <subject>] [--deployment <id>] [--root <dir>] [--json]
//
// Drafts text for ONE allow-listed field of a tool manifest. By default it only
// PRINTS the suggestion (and which provider/model produced it). `--dry-run`
// prints exactly what would leave the machine and sends nothing (note §4).
// `--accept` is the human acting: it writes the field into a STAGED copy under
// `.mcpforge/proposals/` and records provenance beside it. It never writes
// `manifests/`, and there is no "accept all": one field per call.
//
// With no overlay (or `enabled: false`) the command prints one line saying the
// feature is not configured. Nothing else in the CLI depends on it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  ALLOWED_FIELDS,
  UNCONFIGURED,
  applySuggestion,
  authoringEnabled,
  parseAuthoringConfig,
  previewPayload,
  provenancePath,
  recordAcceptance,
  suggestField,
  type AuthoringConfig,
  type AuthoringModel,
  type FieldTarget,
  type SiblingTool,
} from '@mcpforge/adapter-model';
import { findDefinitionsRoot, findRepoRoot } from '@mcpforge/ci';
import { loadManifestFiles } from '@mcpforge/codegen/validate';
import { EncryptedFileStore } from '@mcpforge/gateway/secrets/server';
import type { SecretStore } from '@mcpforge/gateway/secrets';
import { parse as parseYaml } from 'yaml';

export interface SuggestOptions {
  readonly json: boolean;
  readonly field?: string;
  readonly input?: string;
  readonly provider?: string;
  readonly dryRun?: boolean;
  readonly accept?: boolean;
  readonly by?: string;
  readonly deployment?: string;
  readonly root?: string;
}

export interface SuggestDeps {
  readonly secretStore?: SecretStore;
  readonly model?: AuthoringModel;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

const USAGE_EXIT_CODE = 64;

function emit(
  opts: SuggestOptions,
  payload: Record<string, unknown>,
  human: string[],
  stderr = false,
): void {
  if (opts.json) process.stdout.write(`${JSON.stringify(payload)}\n`);
  else (stderr ? process.stderr : process.stdout).write(`${human.join('\n')}\n`);
}

function fail(opts: SuggestOptions, code: string, message: string, next: string): number {
  emit(
    opts,
    { ok: false, code, message, next },
    [`forge: suggest — ${message}`, `forge: next — ${next}`],
    true,
  );
  return USAGE_EXIT_CODE;
}

export function loadAuthoringConfig(
  definitionsRoot: string,
  deployment: string,
): { ok: true; config: AuthoringConfig } | { ok: false; message: string; next: string } {
  const file = join(definitionsRoot, 'overlays', deployment, 'authoring.yaml');
  if (!existsSync(file)) return { ok: true, config: UNCONFIGURED };
  return parseAuthoringConfig(readFileSync(file, 'utf8'));
}

function siblingsOf(root: string, doc: Record<string, unknown>): SiblingTool[] {
  const key = `${String(doc['app'])}.${String(doc['module'])}.${String(doc['entity'])}`;
  const out: SiblingTool[] = [];
  for (const m of loadManifestFiles(root)) {
    const d = m.doc as Record<string, unknown> | null | undefined;
    if (d?.['kind'] !== 'Tool' || typeof d['id'] !== 'string' || d['id'] === doc['id']) continue;
    if (`${String(d['app'])}.${String(d['module'])}.${String(d['entity'])}` === key) {
      out.push({ id: d['id'], purpose: typeof d['purpose'] === 'string' ? d['purpose'] : '' });
    }
  }
  return out;
}

export async function runSuggestCommand(
  manifest: string | undefined,
  opts: SuggestOptions,
  deps: SuggestDeps = {},
): Promise<number> {
  if (manifest === undefined || opts.field === undefined) {
    return fail(
      opts,
      'INPUT_INVALID',
      'A manifest path and --field are required.',
      `Run "forge suggest <manifest> --field <${ALLOWED_FIELDS.join('|')}> [--input <name>] [--dry-run]".`,
    );
  }
  const definitionsRoot = opts.root !== undefined ? resolve(opts.root) : findDefinitionsRoot();
  const loaded = loadAuthoringConfig(
    definitionsRoot,
    opts.deployment ?? process.env['MCPFORGE_DEPLOYMENT'] ?? 'local',
  );
  if (!loaded.ok) return fail(opts, 'INPUT_INVALID', loaded.message, loaded.next);
  const config = loaded.config;
  if (!authoringEnabled(config)) {
    return fail(
      opts,
      'AUTHORING_NOT_CONFIGURED',
      'Model-assisted authoring is not configured.',
      'Nothing else depends on it. To enable it, add overlays/<deployment>/authoring.yaml with enabled: true and a provider, and store its key with "forge secrets put".',
    );
  }

  const abs = resolve(definitionsRoot, manifest);
  const rel = relative(definitionsRoot, abs).split(sep).join('/');
  if (rel.startsWith('..') || !rel.startsWith('manifests/') || !existsSync(abs)) {
    return fail(
      opts,
      'INPUT_INVALID',
      `${manifest} is not a manifest under manifests/.`,
      'Pass the repo-relative path of a tool manifest, e.g. manifests/jde/fin/ap/voucher.create.tool.yaml.',
    );
  }
  // Re-accepting builds on what was already staged for this tool.
  const toolIdGuess = (parseYaml(readFileSync(abs, 'utf8')) as { id?: unknown } | null)?.id;
  const toolId = typeof toolIdGuess === 'string' ? toolIdGuess : rel;
  const proposalId = `suggest-${toolId.replace(/\./g, '-')}`;
  const stagedDir = join(definitionsRoot, '.mcpforge', 'proposals', proposalId);
  const stagedManifest = join(stagedDir, 'files', ...rel.split('/'));
  const baseYaml = readFileSync(existsSync(stagedManifest) ? stagedManifest : abs, 'utf8');
  const doc = parseYaml(baseYaml) as Record<string, unknown> | null;
  if (doc === null || typeof doc !== 'object') {
    return fail(
      opts,
      'INPUT_INVALID',
      `${manifest} is not a YAML mapping.`,
      'Fix the manifest through a change proposal.',
    );
  }

  const target: FieldTarget = {
    field: opts.field as FieldTarget['field'],
    ...(opts.input === undefined ? {} : { inputName: opts.input }),
  };
  const input = {
    config,
    target,
    draft: { doc, siblings: siblingsOf(definitionsRoot, doc) },
    ...(opts.provider === undefined ? {} : { providerId: opts.provider }),
  };

  if (opts.dryRun === true) {
    const preview = previewPayload(input);
    if (!preview.ok) return fail(opts, preview.code, preview.message, preview.next);
    emit(
      opts,
      {
        ok: true,
        dryRun: true,
        provider: preview.provider,
        system: preview.system,
        user: preview.user,
        sent: false,
      },
      [
        `forge suggest: dry run. Nothing was sent. This is exactly what would go to provider "${preview.provider}":`,
        '--- system ---',
        preview.system,
        '--- user ---',
        preview.user,
      ],
    );
    return 0;
  }

  const secrets = deps.secretStore ?? new EncryptedFileStore({ repoRoot: findRepoRoot() });
  const result = await suggestField(
    input,
    { secrets, ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) },
    deps.model,
  );
  if (!result.ok) return fail(opts, result.code, result.message, result.next);

  if (opts.accept !== true) {
    emit(
      opts,
      {
        ok: true,
        accepted: false,
        field: target.field,
        text: result.text,
        provenance: result.provenance,
        next: `This is a suggestion only. Re-run with --accept --by <subject> to stage it, or edit the field by hand.`,
      },
      [
        `forge suggest: ${target.field}${target.inputName === undefined ? '' : ` (${target.inputName})`} from ${result.provenance.provider} / ${result.provenance.model}:`,
        result.text,
        'forge: next — This is a suggestion only. Re-run with --accept --by <subject> to stage it, or edit the field by hand.',
      ],
    );
    return 0;
  }

  if (opts.by === undefined || opts.by.length === 0) {
    return fail(
      opts,
      'INPUT_INVALID',
      '--accept needs --by <subject>.',
      'Name the human accepting this field with --by <Principal.subject>. There is no default identity.',
    );
  }
  const applied = applySuggestion(baseYaml, target, result.text);
  if (!applied.ok) return fail(opts, applied.code, applied.message, applied.next);

  const provFile = join(stagedDir, 'files', ...provenancePath(toolId).split('/'));
  const provExisting = existsSync(provFile) ? readFileSync(provFile, 'utf8') : undefined;
  const now = (deps.now ?? (() => new Date()))().toISOString();
  mkdirSync(dirname(stagedManifest), { recursive: true });
  mkdirSync(dirname(provFile), { recursive: true });
  writeFileSync(stagedManifest, applied.yaml, 'utf8');
  writeFileSync(
    provFile,
    recordAcceptance(provExisting, toolId, target, result.provenance, opts.by, now),
    'utf8',
  );
  writeFileSync(
    join(stagedDir, 'proposal.json'),
    `${JSON.stringify({ proposalId, kind: 'authoring-suggestion', toolId, requestedBy: opts.by, state: 'draft', files: [rel, provenancePath(toolId)] }, null, 2)}\n`,
    'utf8',
  );
  emit(
    opts,
    {
      ok: true,
      accepted: true,
      field: target.field,
      staged: stagedManifest,
      provenance: provFile,
      next: `Review the staged manifest, run "forge validate", and apply it in a change proposal. Nothing under manifests/ was written.`,
    },
    [
      `forge suggest: accepted ${target.field} (nothing was written to manifests/).`,
      `  staged at ${stagedManifest}`,
      `  provenance ${provFile}`,
      'forge: next — Review the staged manifest, run "forge validate", and apply it in a change proposal.',
    ],
  );
  return 0;
}
