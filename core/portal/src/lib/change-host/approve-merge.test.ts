// MCPForge — W0-P33b: Approve and Merge on `LocalGit`, against real git.
//
// Two modes, both built in the OS temp directory (never this working tree):
//  - SANDBOX: everything in one working tree (a developer machine, tests).
//  - CLONE: the VM's shape (docs/build-plan/w0-p33-portal-merge.md §2.1). The
//    definitions clone stays on `main` and is what the gateway reads; drafts
//    live in a linked worktree; only Merge touches the clone.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  LocalGit,
  parseReviewRecord,
  reviewRecordPathFor,
  serialiseReviewRecord,
} from './local-git';
import { ChangeHostError, type MergeCheck } from './types';

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // A locked handle on Windows must not fail the suite.
    }
  }
});

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mcpforge-p33b-'));
  temps.push(dir);
  git(dir, ['init', '--initial-branch=main']);
  git(dir, ['config', 'user.name', 'Fixture']);
  git(dir, ['config', 'user.email', 'fixture@mcpforge.local']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  mkdirSync(path.join(dir, 'manifests'), { recursive: true });
  writeFileSync(path.join(dir, 'manifests', 'voucher.tool.yaml'), 'id: jde.ap.voucher.get\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'base']);
  return dir;
}

/** The VM shape: a clone on main, and a linked worktree for drafts. */
function makeClone(): { clone: string; worktree: string; host: LocalGit } {
  const clone = makeRepo();
  const worktree = path.join(mkdtempSync(path.join(tmpdir(), 'mcpforge-p33b-wt-')), 'wt');
  temps.push(path.dirname(worktree));
  git(clone, ['worktree', 'add', '--detach', worktree, 'main']);
  return { clone, worktree, host: new LocalGit({ repoRoot: worktree, integrationRoot: clone }) };
}

const ADD = 'manifests/voucher-create.tool.yaml';

async function proposed(host: LocalGit, author = 'local:author') {
  const draft = await host.saveDraft({
    branch: 'forge/add-create',
    title: 'Add jde.ap.voucher.create',
    author,
    files: { [ADD]: 'id: jde.ap.voucher.create\n' },
  });
  return host.propose({ id: draft.id, author });
}

const PASS: MergeCheck = () => Promise.resolve({ ok: true });

async function expectCode(p: Promise<unknown>, code: string): Promise<ChangeHostError> {
  try {
    await p;
  } catch (error) {
    expect(error).toBeInstanceOf(ChangeHostError);
    const typed = error as ChangeHostError;
    expect(typed.code).toBe(code);
    expect(typed.next.length).toBeGreaterThan(0);
    return typed;
  }
  throw new Error(`expected ${code}`);
}

describe('review record round trip', () => {
  it('parses exactly what it serialises, approval fields included', () => {
    const record = {
      id: 'forge-x',
      subject: 'change/forge/x',
      decision: 'approved' as const,
      requestedBy: 'local:a',
      requestedAt: '2026-09-30T00:00:00.000Z',
      branch: 'forge/x',
      baseBranch: 'main',
      scope: 'Adds a "create" tool',
      files: ['manifests/a.yaml'],
      approver: 'local:a',
      approvedAt: '2026-09-30T00:01:00.000Z',
      selfApproved: true,
    };
    expect(parseReviewRecord(serialiseReviewRecord(record))).toEqual(record);
    expect(parseReviewRecord('not: [a record')).toBeUndefined();
  });
});

describe('LocalGit Approve and Merge — sandbox mode (W0-P33b)', () => {
  it('approves a proposal, recording the approver, and reports `approved`', async () => {
    const host = new LocalGit({ repoRoot: makeRepo() });
    const p = await proposed(host);
    const approved = await host.approve({ id: p.id, approver: 'local:admin', selfApproved: false });
    expect(approved.state).toBe('approved');
    expect(approved.author).toBe('local:author');
    const record = parseReviewRecord((await host.readFile(p.id, reviewRecordPathFor(p.id))) ?? '');
    expect(record).toMatchObject({
      decision: 'approved',
      approver: 'local:admin',
      selfApproved: false,
    });
  });

  it('refuses to approve a draft, and to merge anything not approved', async () => {
    const host = new LocalGit({ repoRoot: makeRepo() });
    const draft = await host.saveDraft({
      branch: 'forge/d',
      title: 'Draft only',
      author: 'local:author',
      files: { [ADD]: 'x\n' },
    });
    await expectCode(
      host.approve({ id: draft.id, approver: 'local:admin', selfApproved: false }),
      'CHANGE_NOT_PERMITTED',
    );
    await expectCode(
      host.merge({ id: draft.id, mergedBy: 'local:super', check: PASS }),
      'CHANGE_NOT_APPROVED',
    );
  });

  it('merges an approved change with --no-ff after the checks pass', async () => {
    const repo = makeRepo();
    const host = new LocalGit({ repoRoot: repo });
    const p = await proposed(host);
    await host.approve({ id: p.id, approver: 'local:admin', selfApproved: false });
    const result = await host.merge({ id: p.id, mergedBy: 'local:super', check: PASS });
    expect(result.proposal.state).toBe('merged');
    expect(result.generatedCommitted).toBe(false);
    expect(git(repo, ['show', `main:${ADD}`])).toContain('jde.ap.voucher.create');
    // A real merge commit: two parents.
    expect(git(repo, ['rev-list', '--parents', '-n', '1', 'main']).trim().split(' ')).toHaveLength(
      3,
    );
    expect(result.next).toContain('not deployed');
  });

  it('refuses with the check’s own next when a check fails, and merges nothing', async () => {
    const repo = makeRepo();
    const host = new LocalGit({ repoRoot: repo });
    const p = await proposed(host);
    await host.approve({ id: p.id, approver: 'local:admin', selfApproved: false });
    const before = git(repo, ['rev-parse', 'main']);
    const failing: MergeCheck = () =>
      Promise.resolve({
        ok: false,
        message: 'validate refused',
        next: 'Fix rule X, then Propose again.',
      });
    const error = await expectCode(
      host.merge({ id: p.id, mergedBy: 'local:super', check: failing }),
      'CHANGE_CHECKS_FAILED',
    );
    expect(error.next).toBe('Fix rule X, then Propose again.');
    expect(git(repo, ['rev-parse', 'main'])).toBe(before);
  });

  it('commits what codegen produced on the branch before merging it', async () => {
    const repo = makeRepo();
    const host = new LocalGit({ repoRoot: repo });
    const p = await proposed(host);
    await host.approve({ id: p.id, approver: 'local:admin', selfApproved: false });
    const codegen: MergeCheck = (tree) => {
      mkdirSync(path.join(tree, 'generated', 'tools'), { recursive: true });
      writeFileSync(path.join(tree, 'generated', 'tools', 'create.json'), '{"generated":true}\n');
      return Promise.resolve({ ok: true });
    };
    const result = await host.merge({ id: p.id, mergedBy: 'local:super', check: codegen });
    expect(result.generatedCommitted).toBe(true);
    expect(git(repo, ['show', 'main:generated/tools/create.json'])).toContain('generated');
  });
});

describe('LocalGit Approve and Merge — clone mode, the VM shape (W0-P33b)', () => {
  it('never checks a draft out in the clone, and merges into the clone’s main', async () => {
    const { clone, host } = makeClone();
    const p = await proposed(host);
    // The draft exists as a branch, but the clone's tree (what the gateway reads) is untouched.
    expect(git(clone, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('main');
    expect(existsSync(path.join(clone, ADD))).toBe(false);

    await host.approve({ id: p.id, approver: 'local:super', selfApproved: true });
    await host.merge({ id: p.id, mergedBy: 'local:super', check: PASS });

    expect(git(clone, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('main');
    expect(readFileSync(path.join(clone, ADD), 'utf8')).toContain('jde.ap.voucher.create');
    expect(git(clone, ['status', '--porcelain']).trim()).toBe('');
    // The merged record says it was self-approved.
    const record = parseReviewRecord(
      readFileSync(path.join(clone, reviewRecordPathFor(p.id)), 'utf8'),
    );
    expect(record).toMatchObject({
      decision: 'approved',
      selfApproved: true,
      approver: 'local:super',
    });
  });

  it('refuses to merge into a clone that is dirty or off main', async () => {
    const { clone, host } = makeClone();
    const p = await proposed(host);
    await host.approve({ id: p.id, approver: 'local:admin', selfApproved: false });
    writeFileSync(path.join(clone, 'stray.txt'), 'hand edit\n');
    await expectCode(
      host.merge({ id: p.id, mergedBy: 'local:super', check: PASS }),
      'CHANGE_HOST_UNAVAILABLE',
    );
    expect(existsSync(path.join(clone, ADD))).toBe(false);
  });

  it('a discard in the worktree detaches rather than checking out main twice', async () => {
    const { host } = makeClone();
    const draft = await host.saveDraft({
      branch: 'forge/throwaway',
      title: 'Throwaway',
      author: 'local:author',
      files: { [ADD]: 'x\n' },
    });
    await host.discard(draft.id);
    expect(await host.getProposal(draft.id)).toBeUndefined();
  });
});
