// MCPForge — W0-J18: `/governance` view types (03 §5.3 "Governance", 02 §4.3,
// 02 §8.1 item 4).
//
// Same honesty rule as `environments/types.ts` and `activity/types.ts`: where a
// field is rendered directly it mirrors a REAL type from the package that owns
// it, so a later live-wiring task changes a loader, never a component.
//
// TAB 1 IS DIFFERENT AND DELIBERATELY SO. The Roles tab is not fixture-driven:
// its compiled scope, its budget meter and its SoD panel are produced by
// running the REAL codegen (`runCodegen`), the REAL token-budget gate
// (`runTokenBudgetGate`) and the REAL SoD rules (`SOD_RULES`) against a sandbox
// copy of the repo with the edited role overlaid — see `_lib/compile-role.ts`.
// 02 §8.1 item 4 ("a role editor that hides which tools a glob picks up is the
// exact failure this architecture is designed to prevent") is not satisfiable
// by a preview that only looks live.
import type { CapName, CapValues } from '@mcpforge/gateway/caps';
import type { KillScope } from '@mcpforge/gateway/scope';
import type { BindingType, IdentityCarries } from '@mcpforge/shared/manifest';
/*
 * The disposition the PROBE applies when it observes a target executing under
 * something other than the calling human. It is a DETECTION verdict written
 * into the probe report — `block` or `readonly-lowsens`, both of which take
 * capability AWAY — and never a credential path, a default responsibility or a
 * substitute identity. `core/shared/src/manifest/tool.ts` carries the same
 * disable, for the same three lines, with the same reasoning: the lint rule
 * matches on the name shape alone and cannot see the direction of the effect.
 */
/* eslint-disable-next-line mcpforge/no-service-account-fallback -- spec-fixed field name; detection, never substitution (02 §2.2, §3.5) */
import type { OnServiceAccountDisposition } from '@mcpforge/shared/manifest';

export type { CapName, CapValues, KillScope, BindingType, IdentityCarries };

// ---------------------------------------------------------------------------
// Tab 1 — Roles
// ---------------------------------------------------------------------------

/** One role as the editor loads it: its authored YAML plus its merged compiled scope. */
export interface RoleSource {
  readonly roleId: string;
  readonly label: string;
  /** Repo-relative path of the authored role, e.g. `roles/p2p.yaml`. */
  readonly path: string;
  /** The authored YAML, verbatim. The editor's left pane. */
  readonly yamlText: string;
  /**
   * The tool ids in `generated/roles/<id>.scope.json` on the branch the portal
   * is reading — the "currently merged scope" the live compile is diffed
   * against. Empty when the role has never been compiled.
   */
  readonly mergedToolIds: readonly string[];
  /** The merged compiled artefact's bytes, for the proposal's diff base. */
  readonly mergedScopeJson: string;
  /** Repo-relative path of the compiled artefact, e.g. `generated/roles/p2p.scope.json`. */
  readonly scopePath: string;
}

/** 02 §5.3(d) — the role core-set budget, with the demote list the gate itself chose. */
export interface RoleBudgetView {
  readonly coreSetTokens: number;
  readonly limit: number;
  readonly overBudget: boolean;
  /**
   * The tools to demote from `coreTools`, named — never just a number.
   * Produced by the gate's own `chooseDemotions`, so the portal and CI name
   * the same tools. Empty when the set is within budget.
   */
  readonly demote: readonly string[];
  /** The gate's own message, which explains that demoting does not remove. */
  readonly message: string | null;
}

/**
 * One SoD finding. `kind` and `disposition` are the REAL vocabulary:
 * `sod.declared-conflict` carries the authored disposition (`block` |
 * `warn-and-require-exception` | `warn`, per 02 §4.3), and
 * `sod.implicit-create-approve` has none, because nobody has recorded a
 * decision about it — which is the finding.
 */
export interface SodFindingView {
  readonly ruleId: 'sod.declared-conflict' | 'sod.implicit-create-approve';
  readonly severity: 'error' | 'warning';
  /** The two tool ids, sorted. */
  readonly pair: readonly string[];
  /** The authored disposition, or `null` for an undeclared implicit pair. */
  readonly disposition: string | null;
  readonly message: string;
  readonly fix: string;
}

/** What one live compile of an edited role produced. */
export interface CompiledRoleDraft {
  readonly roleId: string;
  /** The explicit tool-id list, read out of the compiled artefact this run wrote. */
  readonly toolIds: readonly string[];
  /** The compiled `generated/roles/<id>.scope.json` bytes this run wrote. */
  readonly scopeJson: string;
  /** Diffed against `RoleSource.mergedToolIds`. */
  readonly toolsAdded: readonly string[];
  readonly toolsRemoved: readonly string[];
  readonly budget: RoleBudgetView;
  readonly sod: readonly SodFindingView[];
  /**
   * Set when the edited YAML could not be compiled at all (unparseable, wrong
   * kind, codegen threw). The right pane then shows the reason and the LAST
   * good compile is not silently reused — an editor that keeps showing a stale
   * tool list while the source is broken is the same lie as one that hides the
   * list entirely. Always names an action (CLAUDE.md non-negotiable 5).
   */
  readonly error?: { readonly message: string; readonly next: string };
}

// ---------------------------------------------------------------------------
// Tab 2 — Policy & guardrails
// ---------------------------------------------------------------------------

/** One declared guardrail across the catalogue (03 §5.3 tab 2's table). */
export interface GuardrailRowView {
  readonly kind: string;
  readonly field: string | null;
  readonly threshold: string;
  readonly message: string;
  readonly toolIds: readonly string[];
}

/**
 * One deployment cap: the overlay's value and the compiled-in hard ceiling,
 * side by side. TWO numbers, never merged — 03 §5.3 tab 2: "so it is visible
 * that a customer can tighten but not loosen".
 */
export interface CapRowView {
  readonly name: CapName;
  readonly label: string;
  /** `null` when this overlay tightens nothing for this cap. */
  readonly overlayValue: number | null;
  /** `HARD_CEILINGS[name]` — a code constant, not configuration. */
  readonly hardCeiling: number;
  /** `resolveEffectiveCaps`'s answer: `min(overlay ?? ceiling, ceiling)`. */
  readonly effective: number;
  /** True when the overlay asked for MORE than the ceiling and was clamped. */
  readonly clamped: boolean;
}

// ---------------------------------------------------------------------------
// Tab 3 — Security posture (from the probe, never the manifest)
// ---------------------------------------------------------------------------

/**
 * One application row. `identityCarries` mirrors `ProbeToolReport.identity.carries`
 * and MAY ONLY come from a probe run — non-negotiable #2. `probeReference` is
 * therefore required to be non-null for any row claiming `verified`; a row with
 * no probe reference renders "not established by a probe", never a verdict.
 */
export interface SecurityPostureRowView {
  readonly application: string;
  readonly bindingTypes: readonly BindingType[];
  /** `null` — no probe has reported on this application. Never rendered as a verdict. */
  readonly identityCarries: IdentityCarries | null;
  /** The probe run that established `identityCarries`. `null` iff `identityCarries` is null. */
  readonly probeReference: string | null;
  /** What actually enforces access in the target. */
  readonly enforcedBy: string;
  /**
   * The disposition the probe applied when the target did NOT carry the calling
   * human's identity — `block` or `readonly-lowsens`, both of which remove
   * capability. `null` when the probe applied none.
   */
  /* eslint-disable-next-line mcpforge/no-service-account-fallback -- spec-fixed type name; detection, never substitution (02 §2.2, §3.5) */
  readonly nonCarriageDisposition: OnServiceAccountDisposition | null;
  /**
   * 03 §5.3 tab 3: "The OIC service-account exception stays a highlighted row."
   * True iff the PROBE reported non-carriage — derived, never authored.
   */
  readonly exception: boolean;
  readonly note: string;
}

// ---------------------------------------------------------------------------
// Tab 4 — Kill switch
// ---------------------------------------------------------------------------

/** One active `runtime_flags` row. Mirrors `StoredRuntimeFlag` / `KillFlagView`. */
export interface KillFlagRowView {
  readonly id: string;
  readonly scope: KillScope;
  readonly target: string;
  readonly reason: string;
  readonly until: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}
