// MCPForge — W0-P3c: Build's drafts are ChangeHost proposals on
// `forge/build-*` branches, read back from git; never a fixture.
import { describe, expect, it } from 'vitest';

import type { ChangeProposal } from '@/lib/change-host/types';

import { resolveRepoRoot } from './_lib/repo-root';
import { findBuildDraft, listBuildDrafts, loadCommittedManifest, type DraftHost } from './drafts';

function proposal(id: string, branch: string, state: ChangeProposal['state']): ChangeProposal {
  return { id, title: `${id} title`, branch, baseBranch: 'main', state, author: 'local:p', createdAt: '2026-09-30' };
}

const FILES: Record<string, Record<string, string>> = {
  'build-a': { 'manifests/jde/fin/ap/voucher.get.tool.yaml': 'kind: Tool\nid: jde.ap.voucher.get\n' },
  'build-b': { 'manifests/x/y/z.create.tool.yaml': 'kind: Tool\nid: x.y.z.create\n' },
  'role-c': { 'roles/p2p.yaml': 'id: p2p\n' },
  'build-d': { 'manifests/q.tool.yaml': 'id: q\n' },
};

function host(proposals: readonly ChangeProposal[]): DraftHost {
  return {
    listProposals: () => Promise.resolve({ ok: true, value: proposals }),
    getProposal: (id) => Promise.resolve({ ok: true, value: proposals.find((p) => p.id === id) }),
    diff: (id) =>
      Promise.resolve({
        ok: true,
        value: { manifest: Object.keys(FILES[id] ?? {}).filter((p) => p.startsWith('manifests/')).map((path) => ({ path })) },
      }),
    readFile: (id, path) => Promise.resolve({ ok: true, value: FILES[id]?.[path] }),
  };
}

const PROPOSALS = [
  proposal('build-a', 'forge/build-jde-ap-voucher-get', 'draft'),
  proposal('build-b', 'forge/build-x-y-z-create', 'in_review'),
  proposal('role-c', 'forge/role-p2p', 'draft'),
  proposal('build-d', 'forge/build-q', 'merged'),
];

describe('listBuildDrafts', () => {
  it('lists open drafts on build branches, with the manifest as the branch holds it', async () => {
    const result = await listBuildDrafts(host(PROPOSALS));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.drafts.map((d) => [d.id, d.toolId, d.state, d.manifestPath])).toEqual([
      ['build-a', 'jde.ap.voucher.get', 'draft', 'manifests/jde/fin/ap/voucher.get.tool.yaml'],
      ['build-b', 'x.y.z.create', 'in_review', 'manifests/x/y/z.create.tool.yaml'],
    ]);
    expect(result.drafts[0]?.yaml).toContain('id: jde.ap.voucher.get');
  });

  it('is unavailable, with the host next, when git cannot be read, never an empty list', async () => {
    const down: DraftHost = {
      ...host([]),
      listProposals: () =>
        Promise.resolve({ ok: false, message: 'git failed', next: 'Check that git is installed.' }),
    };
    expect(await listBuildDrafts(down)).toEqual({
      kind: 'unavailable',
      message: 'git failed',
      next: 'Check that git is installed.',
    });
  });
});

describe('findBuildDraft', () => {
  it('finds an open build draft and refuses a merged or non-build proposal', async () => {
    const h = host(PROPOSALS);
    expect((await findBuildDraft('build-a', h))?.toolId).toBe('jde.ap.voucher.get');
    expect(await findBuildDraft('build-d', h)).toBeUndefined();
    expect(await findBuildDraft('role-c', h)).toBeUndefined();
    expect(await findBuildDraft('nope', h)).toBeUndefined();
  });
});

describe('loadCommittedManifest', () => {
  it('reads a committed manifest verbatim from where it lives in manifests/', () => {
    const found = loadCommittedManifest('jde.ap.voucher.create', resolveRepoRoot());
    expect(found?.path).toBe('manifests/jde/fin/ap/voucher.create.tool.yaml');
    expect(found?.yaml).toContain('id: jde.ap.voucher.create');
    expect(loadCommittedManifest('no.such.tool.get', resolveRepoRoot())).toBeUndefined();
  });
});
