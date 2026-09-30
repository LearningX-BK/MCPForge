// MCPForge — W0-P3c: packages are counted from git, never typed in.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { resolveRepoRoot } from '../../build/_lib/repo-root';
import { loadPackagesFromGit } from './load-packages';

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'mcpforge-packages-'));
  temps.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

const tool = (id: string, server: string, type: string) =>
  `apiVersion: mcpforge/v1\nkind: Tool\nid: ${id}\nserver: ${server}\nbinding:\n  type: ${type}\n`;
const server = (id: string) => `apiVersion: mcpforge/v1\nkind: Server\nid: ${id}\n`;

describe('loadPackagesFromGit', () => {
  it('matches the committed jde-fin package and its compiled selection', () => {
    const [pkg] = loadPackagesFromGit(resolveRepoRoot());
    expect(pkg).toMatchObject({
      id: 'jde-fin',
      label: 'JD Edwards Financials',
      servers: ['jde-fin-ap', 'jde-fin-gl', 'jde-scm-po'],
      roleCount: 1,
      toolCount: 11,
      bindingTypesPresent: ['function'],
      compiled: true,
    });
  });

  it('counts binding types from the selected manifests and lists unselected servers', () => {
    const root = repo({
      'packages/slice.yaml':
        'apiVersion: mcpforge/v1\nkind: Package\nid: slice\nlabel: Slice\nblurb: A test slice.\n',
      'generated/packages/slice.selection.json': JSON.stringify({
        servers: ['s-a'],
        roles: [],
        toolIds: ['a.m.x.get', 'a.m.y.get'],
      }),
      'manifests/_servers/s-a.server.yaml': server('s-a'),
      'manifests/_servers/s-b.server.yaml': server('s-b'),
      'manifests/a/x.get.tool.yaml': tool('a.m.x.get', 's-a', 'rest'),
      'manifests/a/y.get.tool.yaml': tool('a.m.y.get', 's-a', 'database'),
      'manifests/b/z.get.tool.yaml': tool('b.m.z.get', 's-b', 'plsql'),
    });
    expect(loadPackagesFromGit(root)).toEqual([
      {
        id: 'slice',
        label: 'Slice',
        blurb: 'A test slice.',
        servers: ['s-a'],
        roleCount: 0,
        bindingTypesPresent: ['database', 'rest'],
        toolCount: 2,
        notIncluded: ['s-b'],
        compiled: true,
      },
    ]);
  });

  it('says a package is not compiled rather than reporting zero tools as fact', () => {
    const root = repo({ 'packages/raw.yaml': 'kind: Package\nid: raw\n' });
    expect(loadPackagesFromGit(root)[0]).toMatchObject({
      id: 'raw',
      compiled: false,
      toolCount: 0,
    });
  });

  it('returns nothing when there is no packages directory', () => {
    expect(loadPackagesFromGit(repo({}))).toEqual([]);
  });
});
