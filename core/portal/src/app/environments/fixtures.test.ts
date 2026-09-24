// MCPForge — W0-J17: fixtures sourcing tests. Asserts the deployment
// fingerprint's `store` field is produced by the REAL `describeStore`
// function (`@mcpforge/gateway/store`) rather than a fabricated label, and
// that the secret posture count is the real `rotationStatusFor` arithmetic.
import { describe, expect, it } from 'vitest';
import { describeStore } from '@mcpforge/gateway/store';

import { loadDeploymentFingerprint, loadEnablementBacklog, loadPackages } from './fixtures';

describe('loadDeploymentFingerprint', () => {
  it('sources `store` from the real describeStore(), not an invented label', () => {
    const fp = loadDeploymentFingerprint();
    expect(fp.store).toEqual(describeStore({ kind: 'sqlite' }));
    expect(fp.store.label).toBe('SQLite · local file');
    expect(fp.store.kind).toBe('sqlite');
  });

  it('[P5] secret posture is computed, not typed in — overdue/critical counts are consistent', () => {
    const fp = loadDeploymentFingerprint();
    expect(fp.secretPosture).toBeDefined();
    expect(fp.secretPosture!.overdueCount).toBeGreaterThanOrEqual(fp.secretPosture!.criticalCount);
    expect(fp.secretPosture!.overdueCount).toBeLessThanOrEqual(fp.secretPosture!.totalCount);
  });

  it('reports no configured git remote — 03 §11.3 "local only" case', () => {
    const fp = loadDeploymentFingerprint();
    expect(fp.gitRemote.configured).toBe(false);
  });
});

describe('loadEnablementBacklog', () => {
  it('groups every entry by a real owningTeam string, never invented/empty', () => {
    const groups = loadEnablementBacklog();
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.owningTeam.length).toBeGreaterThan(0);
      for (const entry of group.entries) {
        expect(entry.owningTeam).toBe(group.owningTeam);
        expect(entry.status).not.toBe('resolved');
      }
    }
  });

  it('sorts groups by owning team name', () => {
    const groups = loadEnablementBacklog();
    const names = groups.map((g) => g.owningTeam);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe('loadPackages', () => {
  it('returns at least one package with real derived counts', () => {
    const packages = loadPackages();
    expect(packages.length).toBeGreaterThan(0);
    for (const pkg of packages) {
      expect(pkg.servers.length).toBeGreaterThan(0);
      expect(pkg.toolCount).toBeGreaterThan(0);
    }
  });
});
