// MCPForge — W0-J13: the role simulator's measurement.
import { TOKEN_BUDGETS } from '@mcpforge/shared';
import { describe, expect, it } from 'vitest';

import { simulateRole, META_TOOLS_RESIDENT_TOKENS } from './role-simulator';
import { fixtureCatalogSource, FIXTURE_MANIFESTS } from './fixtures';

const data = fixtureCatalogSource();
const manifestsById = new Map(FIXTURE_MANIFESTS.map((m) => [m.id, m]));

describe('simulateRole', () => {
  it('returns null for an unknown role', () => {
    expect(simulateRole(data, 'not-a-role', manifestsById)).toBeNull();
  });

  it('sums the role tools plus the fixed meta-tools cost', () => {
    const sim = simulateRole(data, 'p2p', manifestsById)!;
    expect(sim.totalTokens).toBe(sim.toolsTokens + META_TOOLS_RESIDENT_TOKENS);
  });

  it('measures against the 1,300 role budget', () => {
    const sim = simulateRole(data, 'p2p', manifestsById)!;
    expect(sim.budget).toBe(TOKEN_BUDGETS.roleCoreSet);
    expect(sim.withinBudget).toBe(sim.totalTokens <= TOKEN_BUDGETS.roleCoreSet);
  });

  it('lists exactly the compiled tool ids for the role', () => {
    const sim = simulateRole(data, 'p2p', manifestsById)!;
    const role = data.roles.find((r) => r.id === 'p2p')!;
    expect(sim.tools.map((t) => t.toolId).sort()).toEqual([...role.toolIds].sort());
  });
});
