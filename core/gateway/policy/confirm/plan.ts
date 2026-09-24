// MCPForge — the plan response: what the human reads before anything happens.
// 02 §3.1.1, 03 §7.1–§7.2.
//
// In a chat client the `plan` string is the entire UI, and CLAUDE.md §5 calls
// it "the highest-stakes copy in the product". This module renders it from the
// manifest's `writeSafety.confirm.planTemplate` and assembles the rest of the
// `confirm_required` body around it.
//
// **The template is the manifest's, never this module's.** Nothing here writes
// business prose. Substitution is `{field}` → the argument's rendered value,
// and an unfilled placeholder is left visibly as `{field}` rather than silently
// removed: a plan that quietly drops the amount reads as a complete sentence
// about a smaller change than the one about to happen.

import type { ReversalClass } from '@mcpforge/shared';

/** One thing this call will do to one system. 02 §3.1.1's `effects` array. */
export interface PlanEffect {
  readonly system: string;
  readonly object: string;
  readonly action: string;
  readonly reversible: boolean;
}

/** The reversal contract, echoed into the plan so the human sees the way back. */
export interface PlanReversal {
  readonly class: ReversalClass;
  readonly tool?: string;
  readonly windowHours?: number;
  readonly preconditions?: string;
}

/** What a dry run tells the gate. The binding-type dispatch is W0-H2's. */
export interface DryRunOutcome {
  /** Effects observed by the dry run. Supplements the declared default effect. */
  readonly effects?: readonly PlanEffect[];
  /** e.g. "PO 0000451 is only 60% receipted." */
  readonly warnings?: readonly string[];
  /** Values the plan template may reference that were not call arguments. */
  readonly planValues?: Readonly<Record<string, unknown>>;
}

/** The `confirm_required` body, minus the token fields the gate adds. */
export interface PlanBody {
  readonly status: 'confirm_required';
  readonly plan: string;
  readonly effects: readonly PlanEffect[];
  readonly warnings: readonly string[];
  readonly reversal: PlanReversal;
}

const PLACEHOLDER = /\{([A-Za-z0-9_.]+)\}/g;

function renderValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Fill `{field}` placeholders from the call's arguments, then from any extra
 * values the dry run supplied (a supplier name the caller never passed, say).
 * Arguments win, because the argument is what the token is bound to.
 */
export function renderPlanText(
  template: string,
  args: Readonly<Record<string, unknown>>,
  extra: Readonly<Record<string, unknown>> = {},
): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const fromArgs = renderValue(args[name]);
    if (fromArgs !== null) return fromArgs;
    const fromExtra = renderValue(extra[name]);
    if (fromExtra !== null) return fromExtra;
    return whole;
  });
}

/**
 * The effect every write has by construction, derived from the tool itself.
 * A plan is never allowed to show an empty `effects` array: the array is the
 * human's evidence that something is about to change, and an empty one reads as
 * "nothing will happen".
 */
export function declaredEffect(input: {
  readonly serverId: string;
  readonly entity: string;
  readonly verb: string;
  readonly reversalClass: ReversalClass;
}): PlanEffect {
  return {
    system: input.serverId,
    object: input.entity,
    action: input.verb,
    reversible: input.reversalClass !== 'irreversible',
  };
}

/**
 * Assemble the plan body. `irreversible` says so **in the plan string itself**
 * (02 §3.1.4: "in words ... not only in a field an agent might not render"),
 * appended rather than substituted, because the manifest's own sentence is the
 * one the steward wrote and reviewed.
 */
export function buildPlanBody(input: {
  readonly template: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly dryRun: DryRunOutcome;
  readonly defaultEffect: PlanEffect;
  readonly reversal: PlanReversal;
}): PlanBody {
  let plan = renderPlanText(input.template, input.args, input.dryRun.planValues ?? {});
  if (input.reversal.class === 'irreversible') {
    plan = `${plan} THIS CANNOT BE REVERSED once executed.`;
  }

  const dryRunEffects = input.dryRun.effects ?? [];
  const effects = dryRunEffects.length > 0 ? dryRunEffects : [input.defaultEffect];

  return {
    status: 'confirm_required',
    plan,
    effects,
    warnings: input.dryRun.warnings ?? [],
    reversal: input.reversal,
  };
}
