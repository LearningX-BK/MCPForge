// MCPForge — named follow-up from W0-J21: the composition test for
// `local-git-actions.ts` / `default-host.ts` (see `local-git-actions.ts`'s
// header for the full rationale — a sandbox `LocalGit` seeded once per
// process, never this working tree).
//
// This is a REAL integration test, not a mock: it points the module at a
// throwaway repo root (via `resolveRepoRoot`'s own env override) so the
// sandbox it seeds is built from genuine `manifests/ roles/ ...` fixtures,
// then drives `defaultChangeHost` — the exact object `AppChangeHostProvider`
// hands every route — through a real Save draft -> Propose round trip and
// asserts on real git state, the same way `change-host.contract.test.ts`
// asserts on `LocalGit` directly.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Viewer } from '../viewer/viewer';

// W0-P5b: the actions take the author from the signed-in viewer. The viewer
// is the one thing mocked here, because `getViewer()` reads a request cookie
// and there is no request in a unit test. Everything below it is real.
const viewerState: { current: Viewer | null } = { current: null };
vi.mock('../viewer/session', () => ({
  getViewer: () => Promise.resolve(viewerState.current),
}));

function signedIn(subject: string, personas: Viewer['personas'] = []): Viewer {
  return {
    subject,
    displayName: subject,
    groups: [],
    personas,
    persona: personas[0] ?? null,
    sessionExpiresAt: '2099-01-01T00:00:00.000Z',
  };
}

const temps: string[] = [];
let fixtureRoot: string;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** A minimal standalone MCPForge-shaped root — no `.git`, exactly like the
 *  real repo this session runs in, so `local-git-actions.ts` has to build
 *  its own sandbox rather than finding one already there. */
function makeFixtureRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mcpforge-changehost-actions-'));
  temps.push(dir);
  writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages: []\n', 'utf8');
  mkdirSync(path.join(dir, 'manifests'), { recursive: true });
  writeFileSync(
    path.join(dir, 'manifests', 'voucher.tool.yaml'),
    'id: jde.ap.voucher.get\n',
    'utf8',
  );
  return dir;
}

beforeAll(() => {
  fixtureRoot = makeFixtureRoot();
  process.env['MCPFORGE_PORTAL_REPO_ROOT'] = fixtureRoot;
});

afterAll(() => {
  delete process.env['MCPFORGE_PORTAL_REPO_ROOT'];
  for (const dir of temps) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // A locked handle on Windows must not fail the suite.
    }
  }
});

describe('local-git-actions — the one real ChangeHost composition', () => {
  beforeEach(() => {
    viewerState.current = signedIn('local:priya');
  });

  it('seeds a persistent sandbox under .mcpforge/ from the fixture root, never the fixture root itself', async () => {
    const { changeHostSaveDraft } = await import('./local-git-actions');
    const result = await changeHostSaveDraft({
      title: 'Add jde.ap.voucher.create',
      branch: 'forge/actions-test-seed',
      files: { 'manifests/voucher-create.tool.yaml': 'id: jde.ap.voucher.create\n' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe('draft');
    expect(result.value.branch).toBe('forge/actions-test-seed');

    // The fixture root itself must still not be a git repo — the sandbox is
    // strictly a child of it.
    expect(() => git(fixtureRoot, ['status'])).toThrow();
    const sandbox = path.join(fixtureRoot, '.mcpforge', 'change-host-sandbox');
    expect(git(sandbox, ['branch', '--list', 'forge/actions-test-seed']).trim()).toContain(
      'actions-test-seed',
    );
  });

  it('defaultChangeHost round-trips Save draft -> Propose through the real sandbox', async () => {
    const { defaultChangeHost } = await import('./default-host');
    const draft = await defaultChangeHost.saveDraft({
      title: 'Widen p2p',
      branch: 'forge/actions-test-roundtrip',
      files: { 'manifests/new.tool.yaml': 'id: jde.ap.voucher.create\n' },
    });
    expect(draft.state).toBe('draft');

    const proposed = await defaultChangeHost.propose({ id: draft.id });
    expect(proposed.state).toBe('in_review');
    expect(proposed.reviewRecordPath).toBeDefined();

    const remote = await defaultChangeHost.describeRemote();
    expect(remote).toEqual({ configured: false });
  });

  it('an error crossing the action boundary keeps its ChangeHostError code and next (non-negotiable 5)', async () => {
    const { defaultChangeHost } = await import('./default-host');
    await expect(defaultChangeHost.propose({ id: 'no-such-change' })).rejects.toMatchObject({
      code: 'CHANGE_NOT_FOUND',
    });
    try {
      await defaultChangeHost.propose({ id: 'no-such-change' });
      expect.unreachable('propose on a missing change must reject');
    } catch (error) {
      const typed = error as { next: string };
      expect(typed.next.length).toBeGreaterThan(0);
      expect(typed.next.toLowerCase()).not.toContain('try again');
    }
  });

  it('repeats saveDraft on the same branch without re-seeding (the module-scoped cache)', async () => {
    const { changeHostSaveDraft } = await import('./local-git-actions');
    const first = await changeHostSaveDraft({
      title: 'Step 1',
      branch: 'forge/actions-test-cache',
      files: { 'manifests/a.tool.yaml': 'id: a\n' },
    });
    expect(first.ok).toBe(true);
    const second = await changeHostSaveDraft({
      title: 'Step 2',
      branch: 'forge/actions-test-cache',
      files: { 'manifests/b.tool.yaml': 'id: b\n' },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Both files must be present on the SAME branch — proof the sandbox (and
    // its checked-out state) persisted across the two separate calls.
    const sandbox = path.join(fixtureRoot, '.mcpforge', 'change-host-sandbox');
    const files = git(sandbox, ['ls-tree', '-r', '--name-only', second.value.branch]);
    expect(files).toContain('manifests/a.tool.yaml');
    expect(files).toContain('manifests/b.tool.yaml');
  });

  it('the author is the signed-in subject, whatever the caller sends (W0-P4 §3)', async () => {
    const { changeHostSaveDraft, changeHostPropose } = await import('./local-git-actions');
    const smuggled = {
      title: 'Smuggle an author',
      branch: 'forge/actions-test-author',
      files: { 'manifests/c.tool.yaml': 'id: c\n' },
      author: 'meera.rao@example.com',
    };
    const draft = await changeHostSaveDraft(smuggled as never);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.value.author).toBe('local:priya');

    const proposed = await changeHostPropose({
      id: draft.value.id,
      author: 'someone-else',
    } as never);
    expect(proposed.ok).toBe(true);
    const sandbox = path.join(fixtureRoot, '.mcpforge', 'change-host-sandbox');
    const record = git(sandbox, [
      'show',
      `${draft.value.branch}:${proposed.ok ? proposed.value.reviewRecordPath : ''}`,
    ]);
    expect(record).toContain('requestedBy: "local:priya"');
    expect(record).not.toContain('someone-else');
  });

  it("refuses Save draft and Propose when nobody is signed in, with the note's copy", async () => {
    const { changeHostSaveDraft, changeHostPropose } = await import('./local-git-actions');
    viewerState.current = null;
    const saved = await changeHostSaveDraft({
      title: 'Nobody',
      branch: 'forge/actions-test-nobody',
      files: { 'manifests/d.tool.yaml': 'id: d\n' },
    });
    expect(saved).toMatchObject({
      ok: false,
      code: 'CHANGE_SIGN_IN_REQUIRED',
      message: 'You are not signed in.',
      next: 'Sign in, then propose again; your draft is kept.',
    });
    expect(await changeHostPropose({ id: 'whatever' })).toMatchObject({
      ok: false,
      code: 'CHANGE_SIGN_IN_REQUIRED',
    });
  });

  it('only the author can discard; another viewer is refused naming the author', async () => {
    const { changeHostSaveDraft, changeHostDiscard, changeHostGetProposal } =
      await import('./local-git-actions');
    const draft = await changeHostSaveDraft({
      title: 'Priya owns this',
      branch: 'forge/actions-test-discard',
      files: { 'manifests/e.tool.yaml': 'id: e\n' },
    });
    if (!draft.ok) throw new Error('draft must save');

    viewerState.current = signedIn('local:arjun', ['admin']);
    const refused = await changeHostDiscard(draft.value.id);
    expect(refused).toMatchObject({
      ok: false,
      code: 'CHANGE_NOT_PERMITTED',
      message: 'Only the author, local:priya, can discard this change.',
      next: 'Ask local:priya to discard it, or request changes on the proposal instead.',
    });
    expect((await changeHostGetProposal(draft.value.id)).ok).toBe(true);

    viewerState.current = signedIn('local:priya');
    expect((await changeHostDiscard(draft.value.id)).ok).toBe(true);
  });
});
