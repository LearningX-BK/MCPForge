// MCPForge — W0-J12: `LocalGit`, the Wave-0 `ChangeHost` (02 §10.1 item 1).
//
// "branch + commit + a review record committed under `approvals/`."
//
// SERVER-ONLY. This module shells out to the `git` binary and touches the
// filesystem; it must never be imported from a client component. Nothing in
// `src/components/**` imports it — they take a `ChangeHost` (the interface)
// as a prop or from `ChangeHostProvider`, and a test in
// `change-host.contract.test.ts` asserts that no component file names
// `LocalGit`/`HostedGit` or their modules.
//
// Judgment calls made here, all of them things the spec left implicit:
//
//  * SHELLING OUT vs A LIBRARY. `git` via `node:child_process.execFile`,
//    not isomorphic-git or simple-git. Reasons: zero new dependencies for
//    the portal; identical behaviour to what a reviewer gets on the command
//    line (the whole point of a host-agnostic local-first model); and
//    `forge` already assumes a working git in the CI lane. `execFile` with
//    an argv array (never a shell string) so branch names and paths cannot
//    be injected into a shell.
//  * WHICH STATES GIT CAN HONESTLY REPORT. Only `draft` (branch, no review
//    record), `in_review` (review record committed) and `merged` (branch is
//    an ancestor of the base). `validating`/`invalid` belong to CI,
//    `approved`/`changes_requested` to a reviewer, and **`deployed` belongs
//    to the running catalogue artefact and is the gateway's to report**.
//    `LocalGit` therefore NEVER returns `deployed` — that is the
//    mechanical half of 03 §6.1's "MERGED and DEPLOYED must never be
//    conflated".
//  * THE REVIEW RECORD IS YAML, HAND-SERIALISED. It matches the shape of
//    the committed records under `approvals/` (`id`, `subject`, `decision`,
//    `scope`, plus the fields a change needs). The record is a closed set
//    of strings and string arrays, so a ~20-line writer is preferred over
//    adding a YAML dependency to the portal for one call site.
//  * DIFF BUCKETING. 03 §6.5 says "manifest diff — what a human wrote", so
//    the manifest bucket is the hand-authored sources of truth
//    (`manifests/ roles/ packages/ consumers/ enums/ evals/`), `generated/`
//    is the generated bucket, and everything else (docs, overlays, core)
//    falls to `other` so the three headline diffs stay exactly three.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ChangeHostError,
  type ChangeDiffSet,
  type ChangeHost,
  type ChangeProposal,
  type ChangeState,
  type DiffFile,
  type DiffFileStatus,
  type ProposeInput,
  type RemoteInfo,
  type ReviewRecord,
  type RoleScopeDelta,
  type SaveDraftInput,
} from './types';

const run = promisify(execFile);

const HAND_AUTHORED_PREFIXES = [
  'manifests/',
  'roles/',
  'packages/',
  'consumers/',
  'enums/',
  'evals/',
] as const;
const GENERATED_PREFIX = 'generated/';
const ROLE_SCOPE_DIR = 'generated/roles';
const APPROVALS_DIR = 'approvals';

export interface LocalGitOptions {
  /** Absolute path to the working tree. */
  repoRoot: string;
  /** The integration branch. Default `main`. */
  baseBranch?: string;
  /** Prefix that marks a branch as a MCPForge change (CLAUDE.md §5). */
  branchPrefix?: string;
  /** Override for tests / unusual installs. Default `git`. */
  gitBinary?: string;
}

/** `forge/W0-J12-slug` -> `forge-W0-J12-slug`; ids are stable per branch. */
export function proposalIdForBranch(branch: string): string {
  return branch.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function reviewRecordPathFor(id: string): string {
  return `${APPROVALS_DIR}/change-${id}.yaml`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** Serialises the closed `ReviewRecord` shape; see the header judgment call. */
export function serialiseReviewRecord(record: ReviewRecord): string {
  const lines: string[] = [
    '# MCPForge change review record — governance evidence, committed',
    '# (CLAUDE.md §4, 02 §10.1 item 1). Written by ChangeHost/LocalGit on',
    '# Propose. A hosted git host would open a review instead; nothing above',
    '# the ChangeHost interface knows which happened.',
    `id: ${yamlString(record.id)}`,
    `subject: ${yamlString(record.subject)}`,
    `decision: ${yamlString(record.decision)}`,
    `requestedBy: ${yamlString(record.requestedBy)}`,
    `requestedAt: ${yamlString(record.requestedAt)}`,
    `branch: ${yamlString(record.branch)}`,
    `baseBranch: ${yamlString(record.baseBranch)}`,
    `scope: ${yamlString(record.scope)}`,
    'files:',
  ];
  for (const file of record.files) lines.push(`  - ${yamlString(file)}`);
  if (record.files.length === 0) lines[lines.length - 1] = 'files: []';
  return `${lines.join('\n')}\n`;
}

function bucketFor(filePath: string): 'manifest' | 'generated' | 'other' {
  if (HAND_AUTHORED_PREFIXES.some((prefix) => filePath.startsWith(prefix))) return 'manifest';
  if (filePath.startsWith(GENERATED_PREFIX)) return 'generated';
  return 'other';
}

function statusFromCode(code: string): DiffFileStatus {
  if (code.startsWith('A')) return 'added';
  if (code.startsWith('D')) return 'deleted';
  if (code.startsWith('R')) return 'renamed';
  return 'modified';
}

interface RoleScopeArtefact {
  readonly toolIds: readonly string[];
  readonly bindingGrants: readonly string[];
  readonly label?: string;
}

/** Grants may be strings or objects; JSON is the stable fallback key. */
function grantKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry)));
}

function parseRoleScope(raw: string): RoleScopeArtefact | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    return {
      toolIds: Array.isArray(record['toolIds']) ? record['toolIds'].filter(isString) : [],
      bindingGrants: grantKeys(record['bindingGrants']),
      ...(typeof record['label'] === 'string' ? { label: record['label'] } : {}),
    };
  } catch {
    return undefined;
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function missing(a: readonly string[], b: readonly string[]): string[] {
  const other = new Set(b);
  return a.filter((entry) => !other.has(entry)).sort();
}

export class LocalGit implements ChangeHost {
  readonly #repoRoot: string;
  readonly #baseBranch: string;
  readonly #branchPrefix: string;
  readonly #git: string;

  constructor(options: LocalGitOptions) {
    this.#repoRoot = options.repoRoot;
    this.#baseBranch = options.baseBranch ?? 'main';
    this.#branchPrefix = options.branchPrefix ?? 'forge/';
    this.#git = options.gitBinary ?? 'git';
  }

  async #git_(args: readonly string[]): Promise<string> {
    try {
      const { stdout } = await run(this.#git, [...args], {
        cwd: this.#repoRoot,
        maxBuffer: 64 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ChangeHostError(
        'CHANGE_HOST_UNAVAILABLE',
        `git ${args[0] ?? ''} failed: ${message}`,
        'Check that git is installed and that this directory is a git working tree, then retry the action from the change tray.',
      );
    }
  }

  async #tryGit(args: readonly string[]): Promise<string | undefined> {
    try {
      return await this.#git_(args);
    } catch {
      return undefined;
    }
  }

  async currentBranch(): Promise<string> {
    return (await this.#git_(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  }

  async describeRemote(): Promise<RemoteInfo> {
    const names = (await this.#git_(['remote']))
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const name = names[0];
    if (name === undefined) return { configured: false };
    const url = (await this.#tryGit(['remote', 'get-url', name]))?.trim();
    return url !== undefined && url.length > 0
      ? { configured: true, name, url }
      : { configured: true, name };
  }

  async saveDraft(input: SaveDraftInput): Promise<ChangeProposal> {
    const existing = await this.#tryGit(['rev-parse', '--verify', '--quiet', input.branch]);
    if (existing !== undefined && existing.trim().length > 0) {
      await this.#git_(['checkout', input.branch]);
    } else {
      await this.#git_(['checkout', '-b', input.branch, this.#baseBranch]);
    }

    for (const [relative, contents] of Object.entries(input.files)) {
      const absolute = path.join(this.#repoRoot, relative);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, contents, 'utf8');
      await this.#git_(['add', '--', relative]);
    }

    const staged = (await this.#git_(['diff', '--cached', '--name-only'])).trim();
    if (staged.length === 0) {
      throw new ChangeHostError(
        'CHANGE_NOTHING_TO_COMMIT',
        `Nothing changed on ${input.branch}.`,
        'Edit the manifest, role or package file first, then Save draft again.',
      );
    }
    await this.#git_([
      '-c',
      `user.name=${input.author}`,
      '-c',
      `user.email=${input.author}@mcpforge.local`,
      'commit',
      '-m',
      input.title,
    ]);

    const proposal = await this.getProposal(proposalIdForBranch(input.branch));
    if (proposal === undefined) {
      throw new ChangeHostError(
        'CHANGE_NOT_FOUND',
        `Draft ${input.branch} was committed but could not be read back.`,
        'Open the change tray and refresh, or inspect the branch with `git log`.',
      );
    }
    return proposal;
  }

  async propose(input: ProposeInput): Promise<ChangeProposal> {
    const draft = await this.getProposal(input.id);
    if (draft === undefined) {
      throw new ChangeHostError(
        'CHANGE_NOT_FOUND',
        `No change proposal ${input.id}.`,
        'Pick the change from the change tray, or Save draft first.',
      );
    }
    await this.#git_(['checkout', draft.branch]);

    const files = (
      await this.#git_(['diff', '--name-only', `${this.#baseBranch}...${draft.branch}`])
    )
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const record: ReviewRecord = {
      id: input.id,
      subject: `change/${draft.branch}`,
      decision: 'proposed',
      requestedBy: input.author,
      requestedAt: new Date().toISOString(),
      branch: draft.branch,
      baseBranch: this.#baseBranch,
      scope: input.description ?? draft.title,
      files,
    };
    const relative = reviewRecordPathFor(input.id);
    const absolute = path.join(this.#repoRoot, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, serialiseReviewRecord(record), 'utf8');
    await this.#git_(['add', '--', relative]);
    await this.#git_([
      '-c',
      `user.name=${input.author}`,
      '-c',
      `user.email=${input.author}@mcpforge.local`,
      'commit',
      '-m',
      `Propose: ${draft.title}`,
    ]);

    const proposed = await this.getProposal(input.id);
    if (proposed === undefined) {
      throw new ChangeHostError(
        'CHANGE_NOT_FOUND',
        `Review record for ${input.id} was written but the change could not be read back.`,
        'Refresh the change tray, or inspect the branch with `git log`.',
      );
    }
    return proposed;
  }

  async discard(id: string): Promise<void> {
    const proposal = await this.getProposal(id);
    if (proposal === undefined) {
      throw new ChangeHostError(
        'CHANGE_NOT_FOUND',
        `No change proposal ${id}.`,
        'Pick the change from the change tray — it may already have been discarded.',
      );
    }
    const current = await this.currentBranch();
    if (current === proposal.branch) await this.#git_(['checkout', this.#baseBranch]);
    await this.#git_(['branch', '-D', proposal.branch]);
  }

  async #branches(): Promise<string[]> {
    const output = await this.#git_(['for-each-ref', '--format=%(refname:short)', 'refs/heads/']);
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line !== this.#baseBranch)
      .filter((line) => line.startsWith(this.#branchPrefix));
  }

  async #mergedBranches(): Promise<Set<string>> {
    const output = await this.#tryGit([
      'branch',
      '--merged',
      this.#baseBranch,
      '--format=%(refname:short)',
    ]);
    if (output === undefined) return new Set();
    return new Set(
      output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    );
  }

  async #readProposal(branch: string, merged: Set<string>): Promise<ChangeProposal> {
    const id = proposalIdForBranch(branch);
    const recordPath = reviewRecordPathFor(id);
    const hasRecord =
      (await this.#tryGit(['cat-file', '-e', `${branch}:${recordPath}`])) !== undefined;

    // Only the three states git can honestly know. Never `deployed`.
    const state: ChangeState = merged.has(branch) ? 'merged' : hasRecord ? 'in_review' : 'draft';

    const log = (await this.#git_(['log', '-1', '--format=%s%x00%an%x00%aI', branch])).trim();
    const [subject = branch, author = 'unknown', createdAt = ''] = log.split('\0');

    return {
      id,
      title: subject.startsWith('Propose: ') ? subject.slice('Propose: '.length) : subject,
      branch,
      baseBranch: this.#baseBranch,
      state,
      author,
      createdAt,
      ...(hasRecord ? { reviewRecordPath: recordPath } : {}),
    };
  }

  async listProposals(): Promise<readonly ChangeProposal[]> {
    const merged = await this.#mergedBranches();
    const branches = await this.#branches();
    return Promise.all(branches.map((branch) => this.#readProposal(branch, merged)));
  }

  async getProposal(id: string): Promise<ChangeProposal | undefined> {
    const branches = await this.#branches();
    const branch = branches.find((candidate) => proposalIdForBranch(candidate) === id);
    if (branch === undefined) return undefined;
    return this.#readProposal(branch, await this.#mergedBranches());
  }

  async #patch(range: string, filePath: string): Promise<string> {
    return (await this.#tryGit(['diff', range, '--', filePath])) ?? '';
  }

  async #roleScope(ref: string): Promise<Map<string, RoleScopeArtefact>> {
    const listing = await this.#tryGit(['ls-tree', '-r', '--name-only', ref, `${ROLE_SCOPE_DIR}/`]);
    const result = new Map<string, RoleScopeArtefact>();
    if (listing === undefined) return result;
    for (const file of listing.split('\n').map((line) => line.trim())) {
      if (!file.endsWith('.scope.json')) continue;
      const raw = await this.#tryGit(['show', `${ref}:${file}`]);
      if (raw === undefined) continue;
      const parsed = parseRoleScope(raw);
      if (parsed === undefined) continue;
      const roleId = path.basename(file).replace(/\.scope\.json$/, '');
      result.set(roleId, parsed);
    }
    return result;
  }

  async diff(id: string): Promise<ChangeDiffSet> {
    const proposal = await this.getProposal(id);
    if (proposal === undefined) {
      throw new ChangeHostError(
        'CHANGE_NOT_FOUND',
        `No change proposal ${id}.`,
        'Pick the change from the change tray, or Save draft first.',
      );
    }
    const range = `${this.#baseBranch}...${proposal.branch}`;

    const numstat = (await this.#git_(['diff', '--numstat', range])).split('\n');
    const nameStatus = new Map<string, DiffFileStatus>();
    for (const line of (await this.#git_(['diff', '--name-status', range])).split('\n')) {
      const parts = line.split('\t');
      const code = parts[0];
      const file = parts[parts.length - 1];
      if (code === undefined || file === undefined || file.length === 0) continue;
      nameStatus.set(file, statusFromCode(code));
    }

    const manifest: DiffFile[] = [];
    const generated: DiffFile[] = [];
    const other: DiffFile[] = [];

    for (const line of numstat) {
      const [addedRaw, deletedRaw, filePath] = line.split('\t');
      if (filePath === undefined || filePath.length === 0) continue;
      const entry: DiffFile = {
        path: filePath,
        status: nameStatus.get(filePath) ?? 'modified',
        patch: await this.#patch(range, filePath),
        additions: Number.parseInt(addedRaw ?? '0', 10) || 0,
        deletions: Number.parseInt(deletedRaw ?? '0', 10) || 0,
      };
      const bucket = bucketFor(filePath);
      if (bucket === 'manifest') manifest.push(entry);
      else if (bucket === 'generated') generated.push(entry);
      else other.push(entry);
    }

    const before = await this.#roleScope(this.#baseBranch);
    const after = await this.#roleScope(proposal.branch);
    const roleScope: RoleScopeDelta[] = [];
    for (const roleId of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const a = before.get(roleId);
      const b = after.get(roleId);
      const delta: RoleScopeDelta = {
        roleId,
        toolsAdded: missing(b?.toolIds ?? [], a?.toolIds ?? []),
        toolsRemoved: missing(a?.toolIds ?? [], b?.toolIds ?? []),
        bindingGrantsAdded: missing(b?.bindingGrants ?? [], a?.bindingGrants ?? []),
        bindingGrantsRemoved: missing(a?.bindingGrants ?? [], b?.bindingGrants ?? []),
        ...((b?.label ?? a?.label) ? { label: b?.label ?? a?.label ?? '' } : {}),
      };
      const changed =
        delta.toolsAdded.length > 0 ||
        delta.toolsRemoved.length > 0 ||
        delta.bindingGrantsAdded.length > 0 ||
        delta.bindingGrantsRemoved.length > 0;
      if (changed) roleScope.push(delta);
    }

    return { manifest, generated, roleScope, other };
  }
}
