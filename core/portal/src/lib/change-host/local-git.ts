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
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ChangeHostError,
  DEFINITIONAL_PREFIXES,
  isDefinitionalPath,
  type ChangeDiffSet,
  type GitChangeHost,
  type ChangeProposal,
  type ChangeState,
  type DiffFile,
  type DiffFileStatus,
  type AuthoredApproveInput,
  type AuthoredMergeInput,
  type AuthoredProposeInput,
  type MergeResult,
  type RemoteInfo,
  type ReviewRecord,
  type RoleScopeDelta,
  reviewRecordSchema,
  type AuthoredSaveDraftInput,
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
  /**
   * W0-P33b — the working tree that holds the BASE branch and that the
   * gateway reads (the VM's definitions clone). When set, `repoRoot` is a
   * linked worktree of it where drafts are checked out, the base branch is
   * never checked out in `repoRoot`, and Merge runs here. Unset (the
   * sandbox, tests), everything happens in `repoRoot`.
   */
  integrationRoot?: string;
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
  // W0-P33b — written by Approve.
  if (record.approver !== undefined) lines.push(`approver: ${yamlString(record.approver)}`);
  if (record.approvedAt !== undefined) lines.push(`approvedAt: ${yamlString(record.approvedAt)}`);
  if (record.selfApproved !== undefined) lines.push(`selfApproved: ${record.selfApproved}`);
  return `${lines.join('\n')}\n`;
}

/**
 * W0-P33b — read back exactly what `serialiseReviewRecord` writes: one
 * `key: <JSON>` per line, and `files` as a list of JSON strings. Anything it
 * cannot read is `undefined`, never a guess.
 */
export function parseReviewRecord(text: string): ReviewRecord | undefined {
  const values: Record<string, unknown> = {};
  const files: string[] = [];
  let inFiles = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#') || line.trim().length === 0) continue;
    const item = /^ {2}- (.+)$/.exec(line);
    if (inFiles && item !== null) {
      try {
        files.push(String(JSON.parse(item[1] ?? '')));
      } catch {
        return undefined;
      }
      continue;
    }
    inFiles = false;
    const kv = /^([A-Za-z]+): ?(.*)$/.exec(line);
    if (kv === null) return undefined;
    const key = kv[1] ?? '';
    const raw = kv[2] ?? '';
    if (key === 'files') {
      inFiles = raw.length === 0;
      continue;
    }
    try {
      values[key] = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  const parsed = reviewRecordSchema.safeParse({ ...values, files });
  return parsed.success ? parsed.data : undefined;
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

export class LocalGit implements GitChangeHost {
  readonly #repoRoot: string;
  readonly #baseBranch: string;
  readonly #branchPrefix: string;
  readonly #git: string;
  readonly #integrationRoot: string | undefined;

  constructor(options: LocalGitOptions) {
    this.#repoRoot = options.repoRoot;
    this.#baseBranch = options.baseBranch ?? 'main';
    this.#branchPrefix = options.branchPrefix ?? 'forge/';
    this.#git = options.gitBinary ?? 'git';
    this.#integrationRoot = options.integrationRoot;
  }

  async #git_(args: readonly string[], cwd: string = this.#repoRoot): Promise<string> {
    try {
      const { stdout } = await run(this.#git, [...args], {
        cwd,
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

  async saveDraft(input: AuthoredSaveDraftInput): Promise<ChangeProposal> {
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

  async propose(input: AuthoredProposeInput): Promise<ChangeProposal> {
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
    if (current === proposal.branch) await this.#leaveBranch();
    await this.#git_(['branch', '-D', proposal.branch]);
  }

  /**
   * Step off a branch. In a linked worktree the base branch is checked out in
   * the integration tree and cannot be checked out twice, so detach instead.
   */
  async #leaveBranch(): Promise<void> {
    if (this.#integrationRoot === undefined) await this.#git_(['checkout', this.#baseBranch]);
    else await this.#git_(['checkout', '--detach', this.#baseBranch]);
  }

  async #readRecord(branch: string): Promise<ReviewRecord | undefined> {
    const recordPath = reviewRecordPathFor(proposalIdForBranch(branch));
    const raw = await this.#tryGit(['show', `${branch}:${recordPath}`]);
    return raw === undefined ? undefined : parseReviewRecord(raw);
  }

  async #commitAs(who: string, message: string, cwd: string = this.#repoRoot): Promise<void> {
    await this.#git_(
      ['-c', `user.name=${who}`, '-c', `user.email=${who}@mcpforge.local`, 'commit', '-m', message],
      cwd,
    );
  }

  /**
   * W0-P33b — Approve. Only a proposal `in_review` can be approved; the
   * approver and whether they are also the author are recorded on the review
   * record, on the branch, as governance evidence. WHO may approve is the
   * caller's gate (`gateApproveDefinitional`), never decided here.
   */
  async approve(input: AuthoredApproveInput): Promise<ChangeProposal> {
    const proposal = await this.getProposal(input.id);
    if (proposal === undefined) {
      throw new ChangeHostError(
        'CHANGE_NOT_FOUND',
        `No change proposal ${input.id}.`,
        'Pick the change from the change tray.',
      );
    }
    if (proposal.state !== 'in_review') {
      throw new ChangeHostError(
        'CHANGE_NOT_PERMITTED',
        `Change ${input.id} is ${proposal.state}; only a proposed change can be approved.`,
        proposal.state === 'draft'
          ? 'Ask the author to Propose it first; approval is of a proposal, never of a draft.'
          : 'Nothing to approve. Open the change to see its state.',
      );
    }
    const record = await this.#readRecord(proposal.branch);
    if (record === undefined) {
      throw new ChangeHostError(
        'CHANGE_NOT_FOUND',
        `Change ${input.id} has no readable review record.`,
        'Ask the author to Propose it again, which rewrites the review record.',
      );
    }
    await this.#git_(['checkout', proposal.branch]);
    const approved: ReviewRecord = {
      ...record,
      decision: 'approved',
      approver: input.approver,
      approvedAt: new Date().toISOString(),
      selfApproved: input.selfApproved,
    };
    const relative = reviewRecordPathFor(input.id);
    await writeFile(path.join(this.#repoRoot, relative), serialiseReviewRecord(approved), 'utf8');
    await this.#git_(['add', '--', relative]);
    await this.#commitAs(input.approver, `Approve: ${proposal.title}`);
    const after = await this.getProposal(input.id);
    if (after === undefined) {
      throw new ChangeHostError(
        'CHANGE_NOT_FOUND',
        `Change ${input.id} was approved but could not be read back.`,
        'Refresh the change tray.',
      );
    }
    return after;
  }

  /**
   * W0-P33b — Merge an APPROVED change. The integration tree must be clean
   * and on the base branch. `check` (`forge codegen` then `forge validate`)
   * runs on the branch; a codegen diff is committed on the branch so the
   * blast radius is visible; any failure refuses with its own `next` and
   * nothing is merged. The merge itself is one `merge --no-ff`, aborted on
   * conflict. Merged is not deployed: the gateway picks it up on reload.
   */
  async merge(input: AuthoredMergeInput): Promise<MergeResult> {
    const proposal = await this.getProposal(input.id);
    if (proposal === undefined) {
      throw new ChangeHostError(
        'CHANGE_NOT_FOUND',
        `No change proposal ${input.id}.`,
        'Pick the change from the change tray.',
      );
    }
    if (proposal.state !== 'approved') {
      throw new ChangeHostError(
        'CHANGE_NOT_APPROVED',
        `Change ${input.id} is ${proposal.state}; only an approved change can be merged.`,
        proposal.state === 'merged'
          ? 'It is already merged; nothing to do.'
          : 'Have an admin Approve it first, then Merge.',
      );
    }
    const target = this.#integrationRoot ?? this.#repoRoot;
    if (this.#integrationRoot !== undefined) {
      const head = (await this.#git_(['rev-parse', '--abbrev-ref', 'HEAD'], target)).trim();
      const dirty = (await this.#git_(['status', '--porcelain'], target)).trim();
      if (head !== this.#baseBranch || dirty.length > 0) {
        throw new ChangeHostError(
          'CHANGE_HOST_UNAVAILABLE',
          `The definitions clone is ${head !== this.#baseBranch ? `on ${head}, not ${this.#baseBranch}` : 'not clean'}, so nothing can be merged into it safely.`,
          `On the VM, run "git -C <definitions clone> status" and return it to a clean ${this.#baseBranch}, then Merge again. The portal never edits that tree except to merge.`,
        );
      }
    }

    await this.#git_(['checkout', proposal.branch]);
    const checked = await input.check(this.#repoRoot);
    if (!checked.ok) {
      await this.#tryGit(['checkout', '--', '.']);
      throw new ChangeHostError('CHANGE_CHECKS_FAILED', checked.message, checked.next);
    }
    if (existsSync(path.join(this.#repoRoot, 'generated'))) {
      await this.#git_(['add', '-A', '--', 'generated']);
    }
    const staged = (await this.#git_(['diff', '--cached', '--name-only'])).trim();
    const generatedCommitted = staged.length > 0;
    if (generatedCommitted) await this.#commitAs(input.mergedBy, `Codegen: ${proposal.title}`);

    if (this.#integrationRoot === undefined) await this.#git_(['checkout', this.#baseBranch]);
    try {
      await this.#git_(
        [
          '-c',
          `user.name=${input.mergedBy}`,
          '-c',
          `user.email=${input.mergedBy}@mcpforge.local`,
          'merge',
          '--no-ff',
          '-m',
          `Merge ${proposal.branch}: ${proposal.title}`,
          proposal.branch,
        ],
        target,
      );
    } catch {
      await this.#tryGit(['merge', '--abort']);
      if (this.#integrationRoot !== undefined) {
        await this.#git_(['merge', '--abort'], target).catch(() => undefined);
      }
      throw new ChangeHostError(
        'CHANGE_MERGE_CONFLICT',
        `${proposal.branch} does not merge cleanly into ${this.#baseBranch}; nothing was merged.`,
        'Ask the author to recreate the change on the current definitions, Propose it again, and have it re-approved.',
      );
    }
    const mergeCommit = (await this.#git_(['rev-parse', 'HEAD'], target)).trim();
    if (this.#integrationRoot !== undefined) await this.#leaveBranch();

    const merged = await this.getProposal(input.id);
    return {
      proposal: merged ?? { ...proposal, state: 'merged' },
      mergeCommit,
      generatedCommitted,
      next: 'Merged into the definitions. It is not deployed yet: the gateway serves it after its next catalogue reload, and a new tool reads "Not probed" until a probe enables it.',
    };
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
    const record = hasRecord ? await this.#readRecord(branch) : undefined;

    // Only the states git can honestly know. Never `deployed`. W0-P33b adds
    // `approved`: an approval committed on the review record is a git fact.
    const state: ChangeState = merged.has(branch)
      ? 'merged'
      : record?.decision === 'approved'
        ? 'approved'
        : hasRecord
          ? 'in_review'
          : 'draft';

    // The author is the review record's requester when there is one: later
    // commits on the branch may be an approver's or codegen's (W0-P33b).
    const log = (await this.#git_(['log', '-1', '--format=%s%x00%an%x00%aI', branch])).trim();
    const [lastSubject = branch, lastAuthor = 'unknown', createdAt = ''] = log.split('\0');
    const author = record?.requestedBy ?? lastAuthor;
    const subject =
      record !== undefined && state !== 'in_review' ? `Propose: ${record.scope}` : lastSubject;

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

  async readFile(id: string, filePath: string): Promise<string | undefined> {
    if (!isDefinitionalPath(filePath)) {
      throw new ChangeHostError(
        'CHANGE_NOT_PERMITTED',
        `${filePath} is not a repo-relative path under a definitional tree.`,
        `Read a path under one of ${DEFINITIONAL_PREFIXES.join(', ')}, with no "..".`,
      );
    }
    const proposal = await this.getProposal(id);
    if (proposal === undefined) {
      throw new ChangeHostError(
        'CHANGE_NOT_FOUND',
        `No change proposal ${id}.`,
        'Pick the change from the change tray, or Save draft first.',
      );
    }
    return this.#tryGit(['show', `${proposal.branch}:${filePath}`]);
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
