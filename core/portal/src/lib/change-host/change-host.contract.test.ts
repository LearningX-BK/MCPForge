// MCPForge — W0-J12: the `ChangeHost` contract suite.
//
// One suite, two implementations, exactly as `IdentityProvider` and
// `SecretStore` are contract-tested against one suite (02 §4.4, §10; CLAUDE
// .md §3). `LocalGit` runs it against a real, throwaway git repository built
// in the OS temp directory — never against this working tree, which is not a
// git repo and must not become one. `HostedGit` runs the same call list and
// must fail every one loudly with `CHANGE_HOST_NOT_IMPLEMENTED`; a stub that
// silently succeeded, or that quietly degraded to local behaviour, is the
// failure mode this half of the suite exists to catch.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  LocalGit,
  proposalIdForBranch,
  reviewRecordPathFor,
  serialiseReviewRecord,
} from './local-git';
import { HostedGit } from './hosted-git';
import { ChangeHostError, changeProposalSchema, type ChangeHost } from './types';

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

/** A throwaway repo with a base commit, a manifest and a compiled role scope. */
function makeRepo(options: { remote?: boolean } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mcpforge-changehost-'));
  temps.push(dir);
  git(dir, ['init', '--initial-branch=main']);
  git(dir, ['config', 'user.name', 'Fixture']);
  git(dir, ['config', 'user.email', 'fixture@mcpforge.local']);
  git(dir, ['config', 'commit.gpgsign', 'false']);

  mkdirSync(path.join(dir, 'manifests'), { recursive: true });
  mkdirSync(path.join(dir, 'generated', 'roles'), { recursive: true });
  writeFileSync(
    path.join(dir, 'manifests', 'voucher.tool.yaml'),
    'id: jde.ap.voucher.get\n',
    'utf8',
  );
  writeFileSync(
    path.join(dir, 'generated', 'roles', 'p2p.scope.json'),
    `${JSON.stringify({ roleId: 'p2p', label: 'Procure-to-Pay', toolIds: ['jde.ap.voucher.get'], bindingGrants: [] }, null, 2)}\n`,
    'utf8',
  );
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'base']);

  if (options.remote === true) {
    git(dir, ['remote', 'add', 'origin', 'https://example.invalid/mcpforge.git']);
  }
  return dir;
}

describe('LocalGit — branch + commit + a review record (02 §10.1 item 1)', () => {
  it('saveDraft creates the branch, commits the files, and reports state `draft`', async () => {
    const repo = makeRepo();
    const host = new LocalGit({ repoRoot: repo });

    const draft = await host.saveDraft({
      branch: 'forge/W0-J12-add-create',
      title: 'Add jde.ap.voucher.create',
      author: 'priya',
      files: { 'manifests/voucher-create.tool.yaml': 'id: jde.ap.voucher.create\n' },
    });

    expect(changeProposalSchema.parse(draft)).toBeTruthy();
    expect(draft.state).toBe('draft');
    expect(draft.branch).toBe('forge/W0-J12-add-create');
    expect(draft.reviewRecordPath).toBeUndefined();
    expect(git(repo, ['branch', '--list', 'forge/W0-J12-add-create']).trim()).toContain('W0-J12');
  });

  it('propose commits a review record under approvals/ and moves the state to in_review', async () => {
    const repo = makeRepo();
    const host = new LocalGit({ repoRoot: repo });
    const draft = await host.saveDraft({
      branch: 'forge/W0-J12-propose',
      title: 'Widen p2p',
      author: 'priya',
      files: { 'manifests/new.tool.yaml': 'id: jde.ap.voucher.create\n' },
    });

    const proposed = await host.propose({
      id: draft.id,
      author: 'priya',
      description: 'Adds create.',
    });

    expect(proposed.state).toBe('in_review');
    expect(proposed.reviewRecordPath).toBe(reviewRecordPathFor(draft.id));
    const record = git(repo, ['show', `${proposed.branch}:${reviewRecordPathFor(draft.id)}`]);
    expect(record).toContain('decision: "proposed"');
    expect(record).toContain(`subject: "change/${proposed.branch}"`);
    expect(record).toContain('"manifests/new.tool.yaml"');
  });

  it("never reports `deployed` — deployment is the gateway's, not git's (03 §6.1)", async () => {
    const repo = makeRepo();
    const host = new LocalGit({ repoRoot: repo });
    await host.saveDraft({
      branch: 'forge/W0-J12-states',
      title: 'x',
      author: 'p',
      files: { 'manifests/x.tool.yaml': 'id: x\n' },
    });
    const listed = await host.listProposals();
    expect(listed.map((entry) => entry.state)).not.toContain('deployed');
  });

  it('reports `merged` once the branch is an ancestor of the base — and merged is not deployed', async () => {
    const repo = makeRepo();
    const host = new LocalGit({ repoRoot: repo });
    const draft = await host.saveDraft({
      branch: 'forge/W0-J12-merge',
      title: 'x',
      author: 'p',
      files: { 'manifests/y.tool.yaml': 'id: y\n' },
    });
    git(repo, ['checkout', 'main']);
    git(repo, ['merge', '--no-ff', '-m', 'merge', draft.branch]);

    const merged = await host.getProposal(draft.id);
    expect(merged?.state).toBe('merged');
    expect(merged?.state).not.toBe('deployed');
  });

  it('discard deletes the branch', async () => {
    const repo = makeRepo();
    const host = new LocalGit({ repoRoot: repo });
    const draft = await host.saveDraft({
      branch: 'forge/W0-J12-discard',
      title: 'x',
      author: 'p',
      files: { 'manifests/z.tool.yaml': 'id: z\n' },
    });
    await host.discard(draft.id);
    expect(await host.getProposal(draft.id)).toBeUndefined();
  });

  it('errors are the closed taxonomy and always carry an actionable `next`', async () => {
    const repo = makeRepo();
    const host = new LocalGit({ repoRoot: repo });
    await expect(host.diff('no-such-change')).rejects.toBeInstanceOf(ChangeHostError);
    try {
      await host.propose({ id: 'no-such-change', author: 'p' });
      expect.unreachable('propose on a missing change must fail');
    } catch (error) {
      const typed = error as ChangeHostError;
      expect(typed.code).toBe('CHANGE_NOT_FOUND');
      expect(typed.next.length).toBeGreaterThan(0);
      expect(typed.next.toLowerCase()).not.toContain('try again');
    }
  });
});

describe('LocalGit — the three diffs (03 §6.5)', () => {
  it('buckets manifest, generated and other, and computes the role scope delta', async () => {
    const repo = makeRepo();
    const host = new LocalGit({ repoRoot: repo });
    const draft = await host.saveDraft({
      branch: 'forge/W0-J12-diffs',
      title: 'Widen p2p by one tool',
      author: 'priya',
      files: {
        'manifests/voucher-create.tool.yaml': 'id: jde.ap.voucher.create\n',
        'generated/tools/jde.ap.voucher.create/schema.json': '{}\n',
        'docs/notes.md': 'note\n',
        'generated/roles/p2p.scope.json': `${JSON.stringify(
          {
            roleId: 'p2p',
            label: 'Procure-to-Pay',
            toolIds: ['jde.ap.voucher.get', 'jde.ap.voucher.create'],
            bindingGrants: ['jde.ap.voucher.create'],
          },
          null,
          2,
        )}\n`,
      },
    });

    const diff = await host.diff(draft.id);

    expect(diff.manifest.map((file) => file.path)).toEqual(['manifests/voucher-create.tool.yaml']);
    expect(diff.generated.map((file) => file.path).sort()).toEqual([
      'generated/roles/p2p.scope.json',
      'generated/tools/jde.ap.voucher.create/schema.json',
    ]);
    expect(diff.other.map((file) => file.path)).toEqual(['docs/notes.md']);
    expect(diff.manifest[0]?.status).toBe('added');
    expect(diff.manifest[0]?.patch).toContain('jde.ap.voucher.create');

    expect(diff.roleScope).toHaveLength(1);
    expect(diff.roleScope[0]?.roleId).toBe('p2p');
    expect(diff.roleScope[0]?.toolsAdded).toEqual(['jde.ap.voucher.create']);
    expect(diff.roleScope[0]?.bindingGrantsAdded).toEqual(['jde.ap.voucher.create']);
    expect(diff.roleScope[0]?.toolsRemoved).toEqual([]);
  });

  it('reports no role scope entry when no grant moved', async () => {
    const repo = makeRepo();
    const host = new LocalGit({ repoRoot: repo });
    const draft = await host.saveDraft({
      branch: 'forge/W0-J12-noscope',
      title: 'Copy edit',
      author: 'priya',
      files: { 'manifests/voucher.tool.yaml': 'id: jde.ap.voucher.get\n# copy edit\n' },
    });
    const diff = await host.diff(draft.id);
    expect(diff.roleScope).toEqual([]);
  });
});

describe('RemoteInfo is a fact about the repository, not about the implementation (03 §11.3)', () => {
  it('reports not-configured for a bare local repo', async () => {
    const host = new LocalGit({ repoRoot: makeRepo() });
    expect(await host.describeRemote()).toEqual({ configured: false });
  });

  it('reports the remote name and url when one exists', async () => {
    const host = new LocalGit({ repoRoot: makeRepo({ remote: true }) });
    const remote = await host.describeRemote();
    expect(remote.configured).toBe(true);
    if (remote.configured) {
      expect(remote.name).toBe('origin');
      expect(remote.url).toContain('example.invalid');
    }
  });

  it('currentBranch reports the checked-out branch', async () => {
    const host = new LocalGit({ repoRoot: makeRepo() });
    expect(await host.currentBranch()).toBe('main');
  });
});

describe('HostedGit — a stub that fails loudly, never quietly (CLAUDE.md §3.1)', () => {
  const host: ChangeHost = new HostedGit({
    hostUrl: 'https://example.invalid/mcpforge',
    credentialRef: 'secretRef://change-host/example/pat',
  });

  const calls: ReadonlyArray<[string, () => Promise<unknown>]> = [
    ['currentBranch', () => host.currentBranch()],
    ['describeRemote', () => host.describeRemote()],
    ['saveDraft', () => host.saveDraft({ title: 't', branch: 'b', files: {}, author: 'a' })],
    ['propose', () => host.propose({ id: 'i', author: 'a' })],
    ['discard', () => host.discard('i')],
    ['listProposals', () => host.listProposals()],
    ['getProposal', () => host.getProposal('i')],
    ['diff', () => host.diff('i')],
  ];

  for (const [name, call] of calls) {
    it(`${name} rejects with CHANGE_HOST_NOT_IMPLEMENTED and a named human action`, async () => {
      try {
        await call();
        expect.unreachable(`HostedGit.${name} must not silently succeed`);
      } catch (error) {
        const typed = error as ChangeHostError;
        expect(typed).toBeInstanceOf(ChangeHostError);
        expect(typed.code).toBe('CHANGE_HOST_NOT_IMPLEMENTED');
        expect(typed.next).toContain('HostedGit');
      }
    });
  }

  it('carries a secretRef, never a credential value (non-negotiable 8)', () => {
    const stringified = JSON.stringify(
      new HostedGit({ hostUrl: 'https://h', credentialRef: 'secretRef://change-host/h/pat' }),
    );
    expect(stringified).not.toContain('ghp_');
  });
});

describe('review record serialisation', () => {
  it('matches the approvals/*.yaml shape and escapes values', () => {
    const yaml = serialiseReviewRecord({
      id: 'forge-W0-J12',
      subject: 'change/forge/W0-J12',
      decision: 'proposed',
      requestedBy: 'priya',
      requestedAt: '2026-09-09T00:00:00.000Z',
      branch: 'forge/W0-J12',
      baseBranch: 'main',
      scope: 'Adds a "create" tool',
      files: ['manifests/a.yaml'],
    });
    expect(yaml).toContain('id: "forge-W0-J12"');
    expect(yaml).toContain('scope: "Adds a \\"create\\" tool"');
    expect(yaml).toContain('  - "manifests/a.yaml"');
  });

  it('renders an empty file list as `files: []`', () => {
    const yaml = serialiseReviewRecord({
      id: 'i',
      subject: 's',
      decision: 'proposed',
      requestedBy: 'p',
      requestedAt: 't',
      branch: 'b',
      baseBranch: 'main',
      scope: 'x',
      files: [],
    });
    expect(yaml).toContain('files: []');
    expect(yaml).not.toContain('files:\n');
  });

  it('proposal ids are stable and filesystem-safe', () => {
    expect(proposalIdForBranch('forge/W0-J12-change-host')).toBe('forge-W0-J12-change-host');
  });
});
