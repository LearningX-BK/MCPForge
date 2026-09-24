// MCPForge — W0-J13: the role simulator's measurement (03 §10.4's last
// paragraph). Pure function, unit-tested directly — the component only
// renders what this returns.
import { TOKEN_BUDGETS, countTokens, type ToolManifest } from '@mcpforge/shared';
import { buildResidentDefinition } from './agent-representations';
import type { CatalogData } from './types';

/**
 * The four always-resident meta-tools' combined token cost. 03 §10.1 item 1
 * and CLAUDE.md §3 both cite "~440 tokens total" for `forge.find` /
 * `forge.describe` / `forge.activate` / `forge.invoke`'s own resident
 * definitions — a fixed, documented constant (no generator artefact for it
 * is importable from the portal; see `agent-representations.ts`'s header for
 * the same "not a codegen import" reason).
 */
export const META_TOOLS_RESIDENT_TOKENS = 440;

export interface RoleSimulationEntry {
  readonly toolId: string;
  readonly title: string;
  readonly tokens: number;
  readonly overResidentHard: boolean;
}

export interface RoleSimulation {
  readonly roleId: string;
  readonly roleLabel: string;
  readonly metaToolsTokens: number;
  readonly tools: readonly RoleSimulationEntry[];
  readonly toolsTokens: number;
  readonly totalTokens: number;
  readonly budget: number;
  readonly withinBudget: boolean;
  /** Tools whose OWN resident definition already exceeds the 400-token hard cap — named for demotion, per 03 §10.4. */
  readonly needsDemotion: readonly RoleSimulationEntry[];
}

export function simulateRole(data: CatalogData, roleId: string, manifestsById: ReadonlyMap<string, ToolManifest>): RoleSimulation | null {
  const role = data.roles.find((r) => r.id === roleId);
  if (!role) return null;

  const tools: RoleSimulationEntry[] = role.toolIds
    .map((id) => manifestsById.get(id))
    .filter((m): m is ToolManifest => m !== undefined)
    .map((m) => {
      const resident = buildResidentDefinition(m);
      return {
        toolId: m.id,
        title: m.title,
        tokens: resident.tokens,
        overResidentHard: resident.tokens > TOKEN_BUDGETS.residentHard,
      };
    });

  const toolsTokens = tools.reduce((sum, t) => sum + t.tokens, 0);
  const totalTokens = toolsTokens + META_TOOLS_RESIDENT_TOKENS;

  return {
    roleId: role.id,
    roleLabel: role.label,
    metaToolsTokens: META_TOOLS_RESIDENT_TOKENS,
    tools,
    toolsTokens,
    totalTokens,
    budget: TOKEN_BUDGETS.roleCoreSet,
    withinBudget: totalTokens <= TOKEN_BUDGETS.roleCoreSet,
    needsDemotion: tools.filter((t) => t.overResidentHard),
  };
}

export function countText(text: string): number {
  return countTokens(text);
}
