'use server';
// MCPForge — named follow-up from W0-J21: the ONE composition of `LocalGit`
// into a running portal (02 §10.1 item 1, CLAUDE.md §3 "the portal writes to
// git, not to a database").
//
// WHY THIS FILE EXISTS, AND WHY IT IS SHAPED AS SERVER ACTIONS RATHER THAN A
// CONSTRUCTED `ChangeHost` PASSED DOWN AS A PROP:
//
//  * `LocalGit` shells out to `git` and touches the filesystem
//    (`local-git.ts`'s own header: "SERVER-ONLY... must never be imported
//    from a client component"). A `ChangeHost` instance is therefore not a
//    value a Server Component can hand a Client Component as an ordinary
//    prop — its methods close over `execFile`/`node:fs` state, and only a
//    reference to a real Server Action survives the React Server Components
//    boundary as a callable. So this file's exports ARE the boundary: each
//    one is a `'use server'` action with a plain, JSON-serialisable
//    signature, and `default-host.ts` (also inside `lib/change-host/`, so it
//    remains an allowed namer of the implementation per
//    `vocabulary.test.tsx`) is the thin client-safe `ChangeHost` object that
//    calls them. Nothing outside `lib/change-host/` ever imports this file.
//  * `LocalGit` MUST NOT run against this repo's own working tree. Two
//    independent reasons converge: `change-host.contract.test.ts` states it
//    outright ("never against this working tree, which is not a git repo and
//    must not become one"), and this repo genuinely has no `.git` here — a
//    real, standalone MCPForge checkout is not required to be one. So a
//    single persistent sandbox working tree is created once per server
//    process, under `.mcpforge/change-host-sandbox/` (CLAUDE.md §3.1:
//    "`rm -rf .mcpforge/` must leave a fully working, redeployable system" —
//    this sandbox is exactly that disposable: it is re-derived from the
//    definitional trees on first touch, never the record of anything).
//  * THE SANDBOX IS SEEDED, NOT LIVE-MIRRORED. Exactly `governance/_lib
//    /compile-role.ts`'s `COPY_DIRS`/`COPY_FILES` — the definitional trees a
//    change proposal can touch, plus the root formatting config so a
//    generated artefact's bytes match what CI would produce. It is copied
//    ONCE per server process (a module-scoped cache), not on every action
//    call: saveDraft/propose have to accumulate commits on the SAME branch
//    across separate calls (the role editor calls saveDraft, then later
//    propose, as two round-trips), so re-seeding on every call would erase
//    the draft branch the previous call just created.
//  * ERRORS CROSS THE BOUNDARY AS DATA, NEVER AS A THROWN CLASS. Next.js
//    server actions do not reliably carry custom `Error` subclass fields
//    (`ChangeHostError.code`/`.next`) to the client — only `.message`
//    survives in production. Every action that can fail returns an
//    `ActionResult<T>` instead of throwing; `default-host.ts` unwraps it back
//    into a thrown `ChangeHostError` so every existing caller (`RoleEditor`,
//    `ConsumerEditor`, `ProposeButton`, `ChangeTray`) keeps working exactly
//    as it does against the contract-tested `LocalGit` directly, because the
//    plain `{message, next}` shape those callers duck-type is preserved.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { resolveRepoRoot, resolveRuntimeRoot } from '../../app/build/_lib/repo-root';
import {
  gateApproveDefinitional,
  gateDiscard,
  gateMerge,
  gateSaveOrPropose,
  type GateResult,
} from '../viewer/gates';
import { holdsSuperAdmin } from '../viewer/mapping';
import { forgeMergeCheck } from './merge-check';
import { getViewer } from '../viewer/session';
import { LocalGit } from './local-git';
import {
  ChangeHostError,
  type ChangeDiffSet,
  type ChangeHostErrorCode,
  type ChangeProposal,
  type MergeResult,
  type ProposeInput,
  type RemoteInfo,
  type SaveDraftInput,
} from './types';

/** Same set `governance/_lib/compile-role.ts`'s `COPY_DIRS` names, for the
 *  same reason: these are the trees a change proposal can touch. */
const COPY_DIRS = [
  'manifests',
  'roles',
  'packages',
  'consumers',
  'enums',
  'evals',
  'approvals',
  'generated',
  // W0-P33b — the merge check runs `forge validate` on this tree, which reads
  // the deployment's overlays; without them the sandbox would fail a check
  // the real definitions pass.
  'overlays',
] as const;
const COPY_FILES = ['.prettierrc', '.prettierignore', '.editorconfig'] as const;
const SANDBOX_RELATIVE = path.join('.mcpforge', 'change-host-sandbox');
/** W0-P33b — the linked worktree of the definitions clone where drafts are checked out. */
const WORKTREE_RELATIVE = path.join('.mcpforge', 'change-worktree');

/**
 * W0-P33b — the VM's definitions clone, when `MCPFORGE_DEFINITIONS_ROOT` names
 * a git working tree. Without it (a developer machine, tests) the portal keeps
 * using the disposable sandbox and never touches this repository's own tree.
 */
function definitionsClone(): string | undefined {
  const root = process.env['MCPFORGE_DEFINITIONS_ROOT'];
  if (root === undefined || root.length === 0) return undefined;
  return existsSync(path.join(root, '.git')) ? root : undefined;
}

let cachedHost: LocalGit | undefined;
// Single-flight promise guarding `seedSandbox`/construction. Every route
// mounts `AppChangeHostProvider`, whose effect calls `currentBranch()` +
// `describeRemote()` on mount — so under concurrent navigations (multiple
// Playwright workers, or just two tabs) `ensureHost()` can be entered by
// more than one in-flight request before `cachedHost` is set. Without this,
// two concurrent callers both observe no `.mcpforge/change-host-sandbox/.git`
// and both run `git init`/`config`/`add`/`commit` against the SAME working
// tree concurrently — a real race (not a hypothetical), reproduced as
// intermittent git failures/hangs under `test:a11y:keyboard`'s multi-worker
// run. Caching the in-flight promise itself (not just the resolved value)
// makes every concurrent caller await the ONE seeding operation instead of
// re-entering it.
let hostPromise: Promise<LocalGit> | undefined;

function seedSandbox(sandbox: string, repoRoot: string): void {
  mkdirSync(sandbox, { recursive: true });
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: sandbox });
  execFileSync('git', ['config', 'user.name', 'MCPForge Portal'], { cwd: sandbox });
  execFileSync('git', ['config', 'user.email', 'portal@mcpforge.local'], { cwd: sandbox });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: sandbox });

  for (const dir of COPY_DIRS) {
    const src = path.join(repoRoot, dir);
    if (existsSync(src)) cpSync(src, path.join(sandbox, dir), { recursive: true });
  }
  for (const file of COPY_FILES) {
    const src = path.join(repoRoot, file);
    if (existsSync(src)) cpSync(src, path.join(sandbox, file));
  }
  writeFileSync(
    path.join(sandbox, 'README.mcpforge-sandbox.md'),
    '# Portal change-host sandbox\n\n' +
      'A disposable working tree the running portal writes change proposals into.\n' +
      'Not the real MCPForge repo, not committed anywhere, safe to delete — the\n' +
      'portal re-derives it from `manifests/ roles/ packages/ consumers/ enums/\n' +
      'evals/ approvals/ generated/` the next time a Save draft is attempted.\n' +
      'See core/portal/src/lib/change-host/local-git-actions.ts.\n',
    'utf8',
  );
  // Guarantee at least one committable file even against a stripped
  // checkout that has none of COPY_DIRS yet.
  execFileSync('git', ['add', '-A'], { cwd: sandbox });
  execFileSync('git', ['commit', '-m', 'Portal change-host sandbox base', '--allow-empty'], {
    cwd: sandbox,
  });
}

async function ensureHost(): Promise<LocalGit> {
  if (cachedHost !== undefined) return cachedHost;
  if (hostPromise === undefined) {
    hostPromise = (async () => {
      // W0-P33b: on the VM the definitions are a real git clone. Drafts live
      // in a linked worktree of it under the install root's .mcpforge/, so the
      // clone itself (what the gateway reads) never has a draft checked out;
      // Merge is the only act that touches it.
      const clone = definitionsClone();
      if (clone !== undefined) {
        const worktree = path.join(resolveRuntimeRoot(), WORKTREE_RELATIVE);
        if (!existsSync(path.join(worktree, '.git'))) {
          execFileSync('git', ['worktree', 'prune'], { cwd: clone });
          execFileSync('git', ['worktree', 'add', '--detach', worktree, 'main'], { cwd: clone });
        }
        const host = new LocalGit({ repoRoot: worktree, integrationRoot: clone });
        cachedHost = host;
        return host;
      }
      // W0-P33a: the sandbox is runtime state (under the install root's
      // .mcpforge/); it is seeded FROM the definitions root.
      const sandbox = path.join(resolveRuntimeRoot(), SANDBOX_RELATIVE);
      if (!existsSync(path.join(sandbox, '.git'))) seedSandbox(sandbox, resolveRepoRoot());
      const host = new LocalGit({ repoRoot: sandbox });
      cachedHost = host;
      return host;
    })().catch((error: unknown) => {
      // A failed seed must not poison the single-flight slot forever —
      // the next caller should be allowed to retry seeding.
      hostPromise = undefined;
      throw error;
    });
  }
  return hostPromise;
}

export type ActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ChangeHostErrorCode; readonly message: string; readonly next: string };

async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    if (error instanceof ChangeHostError) {
      return { ok: false, code: error.code, message: error.message, next: error.next };
    }
    return {
      ok: false,
      code: 'CHANGE_HOST_UNAVAILABLE',
      message: error instanceof Error ? error.message : String(error),
      next: 'Check the portal server logs, then retry the action from the change tray.',
    };
  }
}

// currentBranch/describeRemote are read-only and already handled broadly by
// `ChangeHostProvider`'s own try/catch (context.tsx), so they pass a plain
// rejection through rather than an ActionResult.
export async function changeHostCurrentBranch(): Promise<string> {
  return (await ensureHost()).currentBranch();
}

export async function changeHostDescribeRemote(): Promise<RemoteInfo> {
  return (await ensureHost()).describeRemote();
}

// W0-P5b, W0-P4 §3 — the three identity-bearing acts. The author is the
// signed-in viewer's `Principal.subject`, read from the session HERE and never
// from the input. Each git input is rebuilt field by field, so an `author`
// smuggled into the JSON a client sends is never read.

function refused(gate: GateResult & { allowed: false }, code: ChangeHostErrorCode): never {
  throw new ChangeHostError(code, gate.message, gate.next);
}

async function requireSignedIn() {
  const viewer = await getViewer();
  const gate = gateSaveOrPropose(viewer);
  if (!gate.allowed || viewer === null) {
    refused(gate as GateResult & { allowed: false }, 'CHANGE_SIGN_IN_REQUIRED');
  }
  return viewer;
}

export async function changeHostSaveDraft(input: SaveDraftInput): Promise<ActionResult<ChangeProposal>> {
  return runAction(async () => {
    const viewer = await requireSignedIn();
    return (await ensureHost()).saveDraft({
      title: input.title,
      branch: input.branch,
      files: input.files,
      author: viewer.subject,
    });
  });
}

export async function changeHostPropose(input: ProposeInput): Promise<ActionResult<ChangeProposal>> {
  return runAction(async () => {
    const viewer = await requireSignedIn();
    return (await ensureHost()).propose({
      id: input.id,
      ...(input.description === undefined ? {} : { description: input.description }),
      author: viewer.subject,
    });
  });
}

export async function changeHostDiscard(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const viewer = await getViewer();
    const host = await ensureHost();
    const proposal = await host.getProposal(id);
    if (proposal === undefined) {
      // Let the host produce its own CHANGE_NOT_FOUND, with its own next.
      return host.discard(id);
    }
    const gate = gateDiscard(viewer, proposal.author);
    if (!gate.allowed) {
      refused(gate, viewer === null ? 'CHANGE_SIGN_IN_REQUIRED' : 'CHANGE_NOT_PERMITTED');
    }
    return host.discard(id);
  });
}

export async function changeHostListProposals(): Promise<ActionResult<readonly ChangeProposal[]>> {
  return runAction(async () => (await ensureHost()).listProposals());
}

export async function changeHostGetProposal(id: string): Promise<ActionResult<ChangeProposal | undefined>> {
  return runAction(async () => (await ensureHost()).getProposal(id));
}

export async function changeHostDiff(id: string): Promise<ActionResult<ChangeDiffSet>> {
  return runAction(async () => (await ensureHost()).diff(id));
}

/**
 * W0-P33b — Approve a proposed definitional change. Who may: an admin
 * approves another's proposal; only a super admin (git `superAdmins:` group,
 * decided as for Merge) approves their own, recorded `selfApproved` (W0-P34,
 * owner decision 30 Sep 2026). The approver is the session, never an argument.
 */
export async function changeHostApprove(id: string): Promise<ActionResult<ChangeProposal>> {
  return runAction(async () => {
    const viewer = await getViewer();
    const host = await ensureHost();
    const proposal = await host.getProposal(id);
    if (proposal === undefined) return host.approve({ id, approver: '', selfApproved: false });
    const gate = gateApproveDefinitional(
      viewer,
      proposal.author,
      viewer !== null && holdsSuperAdmin(viewer.groups),
    );
    if (!gate.allowed || viewer === null) {
      throw new ChangeHostError(
        viewer === null ? 'CHANGE_SIGN_IN_REQUIRED' : 'CHANGE_NOT_PERMITTED',
        gate.allowed ? 'You are not signed in.' : gate.message,
        gate.allowed ? 'Sign in, then approve again.' : gate.next,
      );
    }
    return host.approve({ id, approver: viewer.subject, selfApproved: gate.selfApproved });
  });
}

/**
 * W0-P33b — Merge an approved change into the definitions: a super admin
 * only, and only after `forge codegen` and `forge validate` pass on it.
 */
export async function changeHostMerge(id: string): Promise<ActionResult<MergeResult>> {
  return runAction(async () => {
    const viewer = await getViewer();
    const gate = gateMerge(viewer, viewer !== null && holdsSuperAdmin(viewer.groups));
    if (!gate.allowed || viewer === null) {
      refused(
        gate as GateResult & { allowed: false },
        viewer === null ? 'CHANGE_SIGN_IN_REQUIRED' : 'CHANGE_NOT_PERMITTED',
      );
    }
    return (await ensureHost()).merge({
      id,
      mergedBy: viewer.subject,
      check: forgeMergeCheck(resolveRuntimeRoot()),
    });
  });
}

/** W0-P3c — a read, like `diff`; `LocalGit.readFile` refuses any non-definitional path. */
export async function changeHostReadFile(
  id: string,
  filePath: string,
): Promise<ActionResult<string | undefined>> {
  return runAction(async () => (await ensureHost()).readFile(id, filePath));
}
