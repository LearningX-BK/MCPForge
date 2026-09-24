// MCPForge — the token-budget gate, `forge ci` stage 9. W0-G5, 02 §5.3.
//
// Re-derives every measurable representation of every Tool manifest (card,
// resident definition, describe) and every Role's core-set sum, straight
// from the manifests on disk — the same source `forge codegen` (stage 3)
// reads — using the SAME builders codegen uses (`buildDiscoveryCard`,
// `buildResidentDefinition`, this package's own `buildDescribeResponse`)
// and the ONE pinned counter (`@mcpforge/shared/tokens`, W0-A4). No second
// tokenizer, no second card/resident builder: this module's only new work
// is measuring and reporting, not building.
//
// The card check (≤60) already hard-fails INSIDE `forge codegen` itself
// (`emit/pipeline.ts`, W0-B6) — stage 3 already cannot pass with an
// over-budget card. This gate re-checks it anyway, for two reasons: (1)
// stage 9's own `failsOn` text (`tools/ci/src/stages.ts`) names "card >60"
// as one of ITS four checks, so a reviewer reading `forge ci --json` must
// see stage 9 itself vouch for it, not infer it from stage 3 having not
// thrown; (2) it is the cheap, deterministic way to prove the exclusion in
// `access.ts` — that the card measurement this gate reports is the same
// ≤60 number, unchanged, with no `access` field silently added to it.

import { readTool, type ToolView } from '../templates/manifest-view.js';
import { buildDiscoveryCard, cardWireShape } from '../templates/card.js';
import { buildResidentDefinition } from '../templates/resident-definition.js';
import { loadManifestFiles } from '../validate/loader.js';
import { resolvedKindAndId } from '../validate/structural.js';
import { codegenVersion } from '../emit/version.js';
import { countTokens } from '@mcpforge/shared/tokens';
import { buildDescribeResponse } from './describe.js';

export interface BudgetFailure {
  readonly kind: 'card' | 'resident' | 'describe' | 'roleCoreSet';
  readonly id: string;
  readonly limit: number;
  readonly counted: number;
  readonly message: string;
  /** Populated only for `kind: 'roleCoreSet'` — the specific tools to demote from `coreTools`. */
  readonly demote?: readonly string[];
}

/**
 * One tool's three measured representations, as numbers. Exposed (W0-G7) so
 * `forge bench`'s MTB metric and its per-role TTFC resident-set arithmetic
 * read the SAME measurements this gate makes, with the SAME pinned counter,
 * rather than standing up a second token-counting convention beside it.
 */
export interface ToolTokenMeasurement {
  readonly cardTokens: number;
  readonly residentTokens: number;
  readonly describeTokens: number;
}

/** One role's compiled core set and what it sums to (02 §5.3(d)). */
export interface RoleTokenMeasurement {
  readonly coreTools: readonly string[];
  /** Sum of `residentTokens` over the core tools this repo actually has manifests for. */
  readonly coreSetTokens: number;
}

export interface TokenBudgetGateResult {
  readonly ok: boolean;
  readonly toolsChecked: number;
  readonly rolesChecked: number;
  readonly failures: readonly BudgetFailure[];
  /** Per-tool measurements, keyed by tool id. Reporting only — the pass/fail verdict is `failures`. */
  readonly tools: Readonly<Record<string, ToolTokenMeasurement>>;
  /** Per-role core-set measurements, keyed by role id. Reporting only. */
  readonly roles: Readonly<Record<string, RoleTokenMeasurement>>;
}

interface ToolMeasurement {
  readonly tool: ToolView;
  readonly cardTokens: number;
  readonly residentTokens: number;
  readonly describeTokens: number;
}

function measureTool(tool: ToolView): ToolMeasurement {
  // provenance content does not affect token count of the wire shape
  // (`cardWireShape` strips it), so a placeholder is fine here — this gate
  // measures what a client actually receives over the wire, not codegen
  // bookkeeping.
  const provenance = { manifestPath: '', manifestSha256: '', codegenVersion: codegenVersion() };
  const card = buildDiscoveryCard(tool, provenance);
  const cardTokens = countTokens(JSON.stringify(cardWireShape(card)));
  const resident = buildResidentDefinition(tool);
  const residentTokens = countTokens(JSON.stringify(resident));
  const describe = buildDescribeResponse(tool);
  const describeTokens = countTokens(JSON.stringify(describe));
  return { tool, cardTokens, residentTokens, describeTokens };
}

/**
 * Given a role's `coreTools` and each tool's resident-definition token cost,
 * decide which tools to demote so the sum comes back within budget.
 *
 * POLICY (02 §5.3(d) is silent on ordering; JUDGMENT CALL documented per
 * CLAUDE.md §8): demote the MOST EXPENSIVE tools first, one at a time,
 * until the remaining sum is within budget. This is deterministic, and it
 * minimises the NUMBER of tools demoted to reach compliance — each token
 * freed comes from the tool that frees the most of it, so the resident set
 * keeps as many tools as the budget allows rather than demoting several
 * cheap tools to avoid demoting one expensive one.
 */
export function chooseDemotions(
  coreTools: readonly { readonly id: string; readonly tokens: number }[],
  limit: number,
): { readonly demote: readonly string[]; readonly remainingTokens: number } {
  const sorted = [...coreTools].sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id));
  let total = coreTools.reduce((sum, t) => sum + t.tokens, 0);
  const demote: string[] = [];
  for (const t of sorted) {
    if (total <= limit) break;
    demote.push(t.id);
    total -= t.tokens;
  }
  demote.sort();
  return { demote, remainingTokens: total };
}

const CARD_BUDGET = 60;
const RESIDENT_HARD_BUDGET = 400;
const DESCRIBE_BUDGET = 600;
const ROLE_CORE_SET_BUDGET = 1300;

/**
 * Run the full token-budget gate against every Tool and Role manifest in
 * `repoRoot`. Pure read — never writes `generated/`; that stays stage 3's
 * job. Manifests are read tolerantly (same posture as `compile/model.ts`):
 * a manifest that already failed stage 2 (`forge validate`) does not need a
 * second, competing structural check here.
 */
export function runTokenBudgetGate(repoRoot: string): TokenBudgetGateResult {
  const files = loadManifestFiles(repoRoot);
  const failures: BudgetFailure[] = [];

  const toolMeasurements = new Map<string, ToolMeasurement>();
  const roles: { readonly id: string; readonly coreTools: readonly string[] }[] = [];

  for (const file of files) {
    const resolved = resolvedKindAndId(file);
    if (!resolved) continue;
    if (resolved.kind === 'Tool') {
      const tool = readTool(file.doc);
      const m = measureTool(tool);
      toolMeasurements.set(resolved.id, m);

      if (m.cardTokens > CARD_BUDGET) {
        failures.push({
          kind: 'card',
          id: resolved.id,
          limit: CARD_BUDGET,
          counted: m.cardTokens,
          message: `Discovery card for ${resolved.id} measures ${m.cardTokens} tokens — over the 02 §5.3(a) ≤${CARD_BUDGET}-token budget. Shorten \`purpose\` (≤14 words) or another card field.`,
        });
      }
      if (m.residentTokens > RESIDENT_HARD_BUDGET) {
        failures.push({
          kind: 'resident',
          id: resolved.id,
          limit: RESIDENT_HARD_BUDGET,
          counted: m.residentTokens,
          message: `Resident definition for ${resolved.id} measures ${m.residentTokens} tokens — over the 02 §5.3(b) ${RESIDENT_HARD_BUDGET}-token hard cap. Shorten parameter descriptions (≤12 words each), move an enum >12 values to enumRef, or reduce nesting.`,
        });
      }
      if (m.describeTokens > DESCRIBE_BUDGET) {
        failures.push({
          kind: 'describe',
          id: resolved.id,
          limit: DESCRIBE_BUDGET,
          counted: m.describeTokens,
          message: `forge.describe response for ${resolved.id} measures ${m.describeTokens} tokens — over the 02 §5.3(c) ≤${DESCRIBE_BUDGET}-token budget. Shorten the plan template, guardrail messages, or the write-safety block.`,
        });
      }
    } else if (resolved.kind === 'Role') {
      const doc = (file.doc ?? {}) as Record<string, unknown>;
      const coreTools = Array.isArray(doc['coreTools'])
        ? doc['coreTools'].filter((t): t is string => typeof t === 'string')
        : [];
      roles.push({ id: resolved.id, coreTools });
    }
  }

  const roleMeasurements: Record<string, RoleTokenMeasurement> = {};

  for (const role of roles) {
    const measured = role.coreTools
      .map((id) => ({ id, tokens: toolMeasurements.get(id)?.residentTokens ?? 0 }))
      .filter((t) => toolMeasurements.has(t.id));
    const total = measured.reduce((sum, t) => sum + t.tokens, 0);
    roleMeasurements[role.id] = { coreTools: role.coreTools, coreSetTokens: total };
    if (total > ROLE_CORE_SET_BUDGET) {
      const { demote, remainingTokens } = chooseDemotions(measured, ROLE_CORE_SET_BUDGET);
      failures.push({
        kind: 'roleCoreSet',
        id: role.id,
        limit: ROLE_CORE_SET_BUDGET,
        counted: total,
        demote,
        message: `Role ${role.id}'s core set (${role.coreTools.length} tools) sums to ${total} tokens — over the 02 §5.3(d) ≤${ROLE_CORE_SET_BUDGET}-token role budget. Demote from coreTools to bring it to ${remainingTokens}: ${demote.join(', ')}. Demoting a tool from coreTools does not remove it from the role — the agent reaches it via forge.find (one extra hop) instead of finding it resident.`,
      });
    }
  }

  failures.sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)));

  const toolReport: Record<string, ToolTokenMeasurement> = {};
  for (const [id, m] of toolMeasurements) {
    toolReport[id] = {
      cardTokens: m.cardTokens,
      residentTokens: m.residentTokens,
      describeTokens: m.describeTokens,
    };
  }

  return {
    ok: failures.length === 0,
    toolsChecked: toolMeasurements.size,
    rolesChecked: roles.length,
    failures,
    tools: toolReport,
    roles: roleMeasurements,
  };
}

