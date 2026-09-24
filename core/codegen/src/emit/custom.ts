// MCPForge — the three-file split, the `contract-hash`, and
// `--accept-contract`. W0-B5. Reads: 02 §2.4 (and §2.3 for the artefact
// table and the provenance conventions W0-B4 already built).
//
// 02 §2.4's whole argument is "separation plus a contract hash — never a
// merge". This module implements the hand-owned half of that split:
//
//   generated/tools/<id>/binding.custom.ts   HAND-OWNED. Created ONCE by
//       codegen when a manifest first declares a custom binding body, and
//       never written by codegen again — with exactly two exceptions, both
//       deliberate: it does not exist yet (create the stub), or a human/agent
//       ran `forge codegen --accept-contract <id>`, which rewrites the single
//       hash-comment LINE and nothing else.
//
//   generated/tools/<id>/contract.json       GENERATED. The snapshot of the
//       contract fields as they stood at the last accepted hash. See
//       "WHY A SNAPSHOT FILE" below.
//
// WHY A SNAPSHOT FILE (judgment call, documented per CLAUDE.md §8):
// 02 §2.4 requires the drift error to name "the exact fields that changed,
// which is what makes it an autonomous-agent-fixable failure". A hash is
// one-way: knowing the old hash tells you *that* something changed, never
// *what*. Naming the fields therefore requires the previous contract itself
// to be recoverable. 02 is silent on where it lives, so this task keeps it
// in a small, fully-generated sibling artefact under the same tool
// directory, written only on a run that did NOT drift — so it always
// describes the state the current hash comment was accepted against.
// The alternative (embedding the whole contract in a comment inside the
// hand-owned file) was rejected: it would put generated content inside the
// one hand-owned file, which is precisely what §2.4's three-file split
// exists to forbid.
//
// If the snapshot is absent (e.g. someone deleted generated/ but restored
// binding.custom.ts from git), drift is still DETECTED and still fails the
// build — the message then says the snapshot was unavailable rather than
// inventing a field list.

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { provenanceJsonFields } from './provenance.js';
import { formatTsDeterministic, serializeJsonDeterministic, writeGeneratedFile } from './writer.js';

/** The literal comment marker 02 §2.4's stub shows: `// mcpforge:contract-hash a91c4e02`. */
export const CONTRACT_HASH_MARKER = 'mcpforge:contract-hash';

/** The stable, machine-readable failure code 02 §2.4 names verbatim. */
export const CUSTOM_BINDING_CONTRACT_DRIFT = 'CUSTOM_BINDING_CONTRACT_DRIFT' as const;

/** One input field, reduced to only what custom binding code can depend on. */
export interface ContractInput {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  /** Present only when the manifest declares one; part of the callable shape (`string/date`). */
  readonly format?: string;
}

/** One result key: the business key the custom body must produce, and where it is read from. */
export interface ContractResultKey {
  readonly name: string;
  readonly path: string;
}

/**
 * 02 §2.4: "a hash of *only the manifest fields the custom code can depend
 * on*: input names and types, `output.resultKeys`, `binding.ref`/`refVersion`,
 * `writeSafety.dryRun.strategy`."
 *
 * JUDGMENT CALL on the exact width of "input names and types": `required`
 * and `format` are included alongside name and type, because §2.4's own
 * worked error message reports an input change as
 * `input.gl_date (added, optional, string/date)` — i.e. it treats
 * optionality and format as part of the input contract it reports on. A
 * narrower reading (name+type only) would let a required->optional flip
 * change what the custom body may assume without any drift signal, which
 * would weaken the guarantee this whole mechanism exists to provide.
 * Deliberately NOT included: `desc`, `example`, `enumRef`, minima, and every
 * other manifest field — those change the generated schema, not the shape
 * the custom body codes against.
 */
export interface ContractSnapshot {
  readonly toolId: string;
  /** Sorted by name — set membership is the contract, authoring order is not. */
  readonly inputs: readonly ContractInput[];
  /** Sorted by name. */
  readonly resultKeys: readonly ContractResultKey[];
  readonly bindingRef: string | null;
  readonly bindingRefVersion: string | null;
  /** `null` for a read tool with no `writeSafety` block. */
  readonly dryRunStrategy: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * 02 §2.4/§2.3 prose names the manifest flag `binding.custom: true`. The
 * W0-B1 Tool JSON Schema, which is the structural source of truth already
 * committed to this repo, carries it as the top-level boolean
 * `bindingCustom` (and closes `binding` with `additionalProperties: false`,
 * so `binding.custom` is not even expressible in a valid manifest).
 * JUDGMENT CALL: this reads the schema's field, since a manifest written
 * the prose way would fail `forge validate` before ever reaching codegen.
 * Flagged in the task report rather than silently reconciled.
 */
export function hasCustomBinding(doc: unknown): boolean {
  const record = asRecord(doc);
  return record?.['bindingCustom'] === true;
}

/** Extract the narrow contract from a parsed Tool manifest document. */
export function contractSnapshot(toolId: string, doc: unknown): ContractSnapshot {
  const record = asRecord(doc) ?? {};
  const binding = asRecord(record['binding']);
  const output = asRecord(record['output']);
  const writeSafety = asRecord(record['writeSafety']);
  const dryRun = asRecord(writeSafety?.['dryRun']);

  const rawInputs = Array.isArray(record['input']) ? record['input'] : [];
  const inputs: ContractInput[] = [];
  for (const raw of rawInputs) {
    const item = asRecord(raw);
    const name = asString(item?.['name']);
    if (name === null) continue;
    const format = asString(item?.['format']);
    inputs.push({
      name,
      type: asString(item?.['type']) ?? 'unknown',
      required: item?.['required'] === true,
      ...(format === null ? {} : { format }),
    });
  }
  inputs.sort((a, b) => a.name.localeCompare(b.name));

  const rawKeys = Array.isArray(output?.['resultKeys']) ? output['resultKeys'] : [];
  const resultKeys: ContractResultKey[] = [];
  for (const raw of rawKeys) {
    const item = asRecord(raw);
    const name = asString(item?.['name']);
    if (name === null) continue;
    resultKeys.push({ name, path: asString(item?.['path']) ?? '' });
  }
  resultKeys.sort((a, b) => a.name.localeCompare(b.name));

  return {
    toolId,
    inputs,
    resultKeys,
    bindingRef: asString(binding?.['ref']),
    bindingRefVersion: asString(binding?.['refVersion']),
    dryRunStrategy: asString(dryRun?.['strategy']),
  };
}

/**
 * The `contract-hash`: sha256 over a canonical serialization of the snapshot,
 * truncated to the 8 lower-case hex characters 02 §2.4's worked stub shows
 * (`a91c4e02`). Truncation is a display choice the document makes; drift
 * detection never relies on the hash alone to describe a change (the
 * snapshot artefact does that), and 8 hex characters is ample to catch an
 * accidental edit, which is the failure mode this guards.
 */
export function contractHash(snapshot: ContractSnapshot): string {
  const canonical = JSON.stringify({
    bindingRef: snapshot.bindingRef,
    bindingRefVersion: snapshot.bindingRefVersion,
    dryRunStrategy: snapshot.dryRunStrategy,
    inputs: snapshot.inputs.map((i) => ({
      format: i.format ?? null,
      name: i.name,
      required: i.required,
      type: i.type,
    })),
    resultKeys: snapshot.resultKeys.map((k) => ({ name: k.name, path: k.path })),
    toolId: snapshot.toolId,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 8);
}

/** Absolute path of the hand-owned binding body for `toolId`. */
export function customBindingPath(repoRoot: string, toolId: string): string {
  return join(repoRoot, 'generated', 'tools', toolId, 'binding.custom.ts');
}

/** Absolute path of the generated contract snapshot for `toolId`. */
export function contractSnapshotPath(repoRoot: string, toolId: string): string {
  return join(repoRoot, 'generated', 'tools', toolId, 'contract.json');
}

/** Repo-relative, forward-slash rendering used in every message and report. */
export function customBindingRepoPath(toolId: string): string {
  return `generated/tools/${toolId}/binding.custom.ts`;
}

const HASH_LINE_RE = new RegExp(`^\\s*//\\s*${CONTRACT_HASH_MARKER}\\s+([0-9a-f]+)\\s*$`);

/** Read the embedded `// mcpforge:contract-hash <hash>` value, or `null` if the file carries none. */
export function readContractHashComment(source: string): string | null {
  for (const line of source.split('\n')) {
    const match = HASH_LINE_RE.exec(line);
    if (match) return match[1]!;
  }
  return null;
}

/**
 * Rewrite ONLY the hash-comment line. Every other byte of the file — every
 * other line, the line endings, the trailing newline — is preserved exactly.
 * This is the `--accept-contract` primitive and it is deliberately a
 * line-surgical string operation, never a re-render of the file: the file is
 * hand-owned, so codegen must not have an opinion about anything else in it.
 */
export function replaceContractHashComment(source: string, hash: string): string {
  const lines = source.split('\n');
  let replaced = false;
  const out = lines.map((line) => {
    const match = HASH_LINE_RE.exec(line);
    if (!match || replaced) return line;
    replaced = true;
    // Preserve the line's own leading whitespace; replace only the value.
    const indent = /^\s*/.exec(line)![0];
    return `${indent}// ${CONTRACT_HASH_MARKER} ${hash}`;
  });
  if (!replaced) return source;
  return out.join('\n');
}

/**
 * 02 §2.4's stub, reproduced. The document's example elides the `dryRun`
 * body with `…`; that is prose elision, not source, so the body here mirrors
 * `execute`'s exactly.
 *
 * The bare `throw new Error` is verbatim from the document and is correct
 * here despite CLAUDE.md §5's "never a bare throw on a caller-visible path":
 * this stub is by construction not yet a caller-visible path — it exists to
 * fail loudly until a human writes the real body, and a generated error from
 * the closed taxonomy would make an unimplemented binding look like a
 * modelled runtime failure.
 */
export async function renderCustomBindingStub(
  toolId: string,
  hash: string,
  repoRoot?: string,
): Promise<string> {
  const source = [
    '// HAND-OWNED. codegen will never overwrite this file.',
    `// ${CONTRACT_HASH_MARKER} ${hash}`,
    "import type { Ctx, Args, Result } from './handler.generated';",
    '',
    'export async function execute(ctx: Ctx, args: Args): Promise<Result> {',
    `  throw new Error('NOT_IMPLEMENTED: ${toolId} binding body');`,
    '}',
    '',
    'export async function dryRun(ctx: Ctx, args: Args): Promise<Result> {',
    `  throw new Error('NOT_IMPLEMENTED: ${toolId} binding dry run');`,
    '}',
    '',
  ].join('\n');
  return formatTsDeterministic(source, repoRoot);
}

/** One `changed:` entry in the drift report, in 02 §2.4's worked format. */
export type ContractChange = string;

function inputShape(input: ContractInput): string {
  const optionality = input.required ? 'required' : 'optional';
  const type = input.format === undefined ? input.type : `${input.type}/${input.format}`;
  return `${optionality}, ${type}`;
}

/**
 * The exact field-level difference between two snapshots, rendered in the
 * form 02 §2.4's worked example uses:
 *
 *   input.gl_date (added, optional, string/date)
 *   output.resultKeys.document_company (added)
 *
 * The document only works an "added" example. JUDGMENT CALL on the other
 * cases, chosen to stay in the same grammar: `(removed)` for a deletion, and
 * `(changed, was <old>, now <new>)` for a modification, so an agent reading
 * the failure can act without opening git history.
 */
export function diffContracts(
  previous: ContractSnapshot,
  next: ContractSnapshot,
): readonly ContractChange[] {
  const changes: ContractChange[] = [];

  const prevInputs = new Map(previous.inputs.map((i) => [i.name, i]));
  const nextInputs = new Map(next.inputs.map((i) => [i.name, i]));
  for (const name of [...new Set([...prevInputs.keys(), ...nextInputs.keys()])].sort()) {
    const before = prevInputs.get(name);
    const after = nextInputs.get(name);
    if (before === undefined && after !== undefined) {
      changes.push(`input.${name} (added, ${inputShape(after)})`);
    } else if (before !== undefined && after === undefined) {
      changes.push(`input.${name} (removed, was ${inputShape(before)})`);
    } else if (before && after && inputShape(before) !== inputShape(after)) {
      changes.push(`input.${name} (changed, was ${inputShape(before)}, now ${inputShape(after)})`);
    }
  }

  const prevKeys = new Map(previous.resultKeys.map((k) => [k.name, k]));
  const nextKeys = new Map(next.resultKeys.map((k) => [k.name, k]));
  for (const name of [...new Set([...prevKeys.keys(), ...nextKeys.keys()])].sort()) {
    const before = prevKeys.get(name);
    const after = nextKeys.get(name);
    if (before === undefined && after !== undefined) {
      changes.push(`output.resultKeys.${name} (added)`);
    } else if (before !== undefined && after === undefined) {
      changes.push(`output.resultKeys.${name} (removed)`);
    } else if (before && after && before.path !== after.path) {
      changes.push(`output.resultKeys.${name} (changed, was ${before.path}, now ${after.path})`);
    }
  }

  const scalars: readonly [string, string | null, string | null][] = [
    ['binding.ref', previous.bindingRef, next.bindingRef],
    ['binding.refVersion', previous.bindingRefVersion, next.bindingRefVersion],
    ['writeSafety.dryRun.strategy', previous.dryRunStrategy, next.dryRunStrategy],
  ];
  for (const [label, before, after] of scalars) {
    if (before === after) continue;
    if (before === null) changes.push(`${label} (added, ${after})`);
    else if (after === null) changes.push(`${label} (removed, was ${before})`);
    else changes.push(`${label} (changed, was ${before}, now ${after})`);
  }

  return changes;
}

/** The structured build-time failure. Not a gateway error code — a codegen failure, like `ValidationFailure`. */
export interface ContractDriftFailure {
  readonly code: typeof CUSTOM_BINDING_CONTRACT_DRIFT;
  readonly toolId: string;
  /** Repo-relative, forward-slash path of the untouched hand-owned file. */
  readonly file: string;
  /** The exact fields that changed, 02 §2.4's format. Never empty. */
  readonly changed: readonly ContractChange[];
  /** The `fix:` line — always names `--accept-contract <id>`. */
  readonly fix: string;
  /** The hash currently embedded in the hand-owned file (`null` when the marker is missing). */
  readonly foundHash: string | null;
  /** The hash the manifest now implies. */
  readonly expectedHash: string;
}

/** 02 §2.4's worked block, reproduced byte-for-byte in shape. */
export function formatContractDriftHuman(failure: ContractDriftFailure): string {
  const [first, ...rest] = failure.changed;
  const lines = [
    `${CUSTOM_BINDING_CONTRACT_DRIFT}  ${failure.toolId}`,
    `  changed: ${first ?? '(unknown)'}`,
    ...rest.map((c) => `           ${c}`),
    `  file:    ${failure.file}`,
    `  fix:     ${failure.fix}`,
  ];
  return lines.join('\n');
}

function driftFailure(
  toolId: string,
  changed: readonly ContractChange[],
  foundHash: string | null,
  expectedHash: string,
): ContractDriftFailure {
  return {
    code: CUSTOM_BINDING_CONTRACT_DRIFT,
    toolId,
    file: customBindingRepoPath(toolId),
    changed:
      changed.length > 0
        ? changed
        : [
            `contract changed (hash ${foundHash ?? 'absent'} -> ${expectedHash}); the previous contract snapshot at generated/tools/${toolId}/contract.json is missing, so the individual fields cannot be named`,
          ],
    fix: `update the file, then \`forge codegen --accept-contract ${toolId}\``,
    foundHash,
    expectedHash,
  };
}

/** Read the previously-accepted snapshot, or `null` when the generated sibling is absent/unreadable. */
export function readContractSnapshot(repoRoot: string, toolId: string): ContractSnapshot | null {
  const path = contractSnapshotPath(repoRoot, toolId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { contract?: unknown };
    const contract = asRecord(parsed.contract);
    if (!contract) return null;
    return contract as unknown as ContractSnapshot;
  } catch {
    return null;
  }
}

export type CustomBindingAction =
  /** The file did not exist: the typed stub was created, once. */
  | 'created'
  /** The hash matched: nothing was written, not even identical bytes. */
  | 'unchanged'
  /** The hash did not match: nothing was written, and the build fails. */
  | 'drift';

export interface CustomBindingResult {
  readonly toolId: string;
  readonly action: CustomBindingAction;
  /** Repo-relative paths actually written by this call (empty for `unchanged` and `drift`). */
  readonly filesWritten: readonly string[];
  readonly drift?: ContractDriftFailure;
}

/**
 * The create-once-or-check-drift step, run by `forge codegen` for every Tool
 * manifest that declares a custom binding body.
 *
 * The three outcomes are exhaustive and 02 §2.4 fixes all three:
 *   - no file yet          -> write the typed stub, once, with the hash comment
 *   - hash matches         -> do NOTHING. The write is skipped entirely, so the
 *                             file's bytes and its mtime are untouched.
 *   - hash does not match  -> do NOTHING to the file, and return a
 *                             CUSTOM_BINDING_CONTRACT_DRIFT failure naming the
 *                             exact fields.
 */
export async function syncCustomBinding(args: {
  readonly repoRoot: string;
  readonly toolId: string;
  readonly doc: unknown;
  readonly manifestPath: string;
  readonly manifestSha256: string;
  readonly codegenVersion: string;
}): Promise<CustomBindingResult> {
  const { repoRoot, toolId, doc } = args;
  const snapshot = contractSnapshot(toolId, doc);
  const expected = contractHash(snapshot);
  const absPath = customBindingPath(repoRoot, toolId);

  const writeSnapshot = async (): Promise<string> => {
    const body = {
      contract: snapshot as unknown,
      contractHash: expected,
      note: 'GENERATED. The contract fields (02 §2.4) as they stood when the hash in binding.custom.ts was last accepted. Used to name exactly which fields changed on drift. Never hand-edit.',
      ...provenanceJsonFields({
        manifestPath: args.manifestPath,
        manifestSha256: args.manifestSha256,
        codegenVersion: args.codegenVersion,
      }),
    };
    const content = await serializeJsonDeterministic(body, repoRoot);
    writeGeneratedFile(contractSnapshotPath(repoRoot, toolId), content);
    return `generated/tools/${toolId}/contract.json`;
  };

  if (!existsSync(absPath)) {
    const stub = await renderCustomBindingStub(toolId, expected, repoRoot);
    writeGeneratedFile(absPath, stub);
    const snapshotFile = await writeSnapshot();
    return {
      toolId,
      action: 'created',
      filesWritten: [customBindingRepoPath(toolId), snapshotFile].sort(),
    };
  }

  const source = readFileSync(absPath, 'utf8');
  const found = readContractHashComment(source);

  if (found === expected) {
    // 02 §2.4: "the custom file is left completely alone. No diff, no noise."
    // The write is skipped, not repeated with identical bytes — an identical
    // rewrite would still touch mtime and would still be a write to a
    // hand-owned file, which this mechanism promises never happens.
    const snapshotFile = await writeSnapshot();
    return { toolId, action: 'unchanged', filesWritten: [snapshotFile] };
  }

  const previous = readContractSnapshot(repoRoot, toolId);
  const changed = previous ? diffContracts(previous, snapshot) : [];
  return {
    toolId,
    action: 'drift',
    filesWritten: [],
    drift: driftFailure(toolId, changed, found, expected),
  };
}

/** Why an `--accept-contract` run was refused. */
export interface AcceptContractRefusal {
  readonly ok: false;
  readonly code: 'ACCEPT_CONTRACT_REFUSED';
  readonly toolId: string;
  readonly message: string;
  readonly next: string;
}

export interface AcceptContractSuccess {
  readonly ok: true;
  readonly toolId: string;
  readonly file: string;
  readonly previousHash: string | null;
  readonly acceptedHash: string;
}

export type AcceptContractResult = AcceptContractSuccess | AcceptContractRefusal;

function refusal(toolId: string, message: string, next: string): AcceptContractRefusal {
  return { ok: false, code: 'ACCEPT_CONTRACT_REFUSED', toolId, message, next };
}

/**
 * `forge codegen --accept-contract <id>` — 02 §2.4: "rewrites only the hash
 * comment. It cannot be run in CI (it is refused when `CI=true`), so
 * acceptance is always a deliberate human or agent act recorded in a commit."
 *
 * CI DETECTION (judgment call, documented): the document names exactly one
 * condition — `CI=true` — so exactly that is implemented, a strict equality
 * against the string `'true'`. No broader sniffing of GITHUB_ACTIONS and
 * friends: 02 §2.4's Wave 0 stance is host-agnostic (CLAUDE.md §3.1), and a
 * refusal condition that is wider than the specified one would be a silent
 * policy change on a governance-relevant gate.
 */
export async function acceptContract(args: {
  readonly repoRoot: string;
  readonly toolId: string;
  readonly doc: unknown;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<AcceptContractResult> {
  const env = args.env ?? process.env;
  const { repoRoot, toolId } = args;

  if (env['CI'] === 'true') {
    return refusal(
      toolId,
      '--accept-contract is refused when CI=true: accepting a contract change is a deliberate human or agent act, recorded in a commit (02 §2.4).',
      `Run \`forge codegen --accept-contract ${toolId}\` locally, review the resulting one-line diff in ${customBindingRepoPath(toolId)}, and commit it.`,
    );
  }

  const absPath = customBindingPath(repoRoot, toolId);
  if (!existsSync(absPath)) {
    return refusal(
      toolId,
      `There is no ${customBindingRepoPath(toolId)} to accept a contract for.`,
      `Run \`forge codegen\` first — it creates the hand-owned stub once for a manifest declaring bindingCustom: true.`,
    );
  }

  const source = readFileSync(absPath, 'utf8');
  const previousHash = readContractHashComment(source);
  if (previousHash === null) {
    return refusal(
      toolId,
      `${customBindingRepoPath(toolId)} carries no \`// ${CONTRACT_HASH_MARKER} <hash>\` line, so there is nothing to rewrite.`,
      `Add the line \`// ${CONTRACT_HASH_MARKER} <hash>\` near the top of the file (see 02 §2.4's stub), then re-run \`forge codegen --accept-contract ${toolId}\`.`,
    );
  }

  const acceptedHash = contractHash(contractSnapshot(toolId, args.doc));
  const rewritten = replaceContractHashComment(source, acceptedHash);
  if (rewritten !== source) {
    writeGeneratedFile(absPath, rewritten);
  }
  return {
    ok: true,
    toolId,
    file: customBindingRepoPath(toolId),
    previousHash,
    acceptedHash,
  };
}
