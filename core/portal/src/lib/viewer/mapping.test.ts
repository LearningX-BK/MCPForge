// MCPForge — W0-P5b: personas come from the git mapping, and fail closed.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { resolveRepoRoot } from '../../app/build/_lib/repo-root';
import { heldPersonas } from './mapping';

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

describe('heldPersonas', () => {
  it('reads the committed local mapping', () => {
    const repoRoot = resolveRepoRoot();
    expect(heldPersonas(['mcpforge-admins'], { repoRoot, deployment: 'local' })).toEqual([
      'developer',
      'admin',
    ]);
    expect(heldPersonas(['finance-ap-clerks'], { repoRoot, deployment: 'local' })).toEqual([
      'business',
    ]);
    expect(heldPersonas(['a-group-nobody-maps'], { repoRoot, deployment: 'local' })).toEqual([]);
  });

  it('a mapping the gateway would refuse yields no personas, never a default', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mcpforge-personas-'));
    temps.push(root);
    mkdirSync(path.join(root, 'overlays', 'broken', 'mappings'), { recursive: true });
    writeFileSync(
      path.join(root, 'overlays', 'broken', 'mappings', 'groups-to-roles.yaml'),
      'apiVersion: mcpforge/v1\nkind: GroupRoleMapping\ndeployment: broken\ngroups: {}\npersonas:\n  g:\n    personas: [superuser]\n',
    );
    expect(heldPersonas(['g'], { repoRoot: root, deployment: 'broken' })).toEqual([]);
    expect(heldPersonas(['g'], { repoRoot: root, deployment: 'absent' })).toEqual([]);
  });
});
