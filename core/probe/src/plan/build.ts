// MCPForge — building one tool's probe plan from its binding type. 02 §4.5.
// W0-H4.
//
// This is the ONLY exported plan constructor. It takes no check list, no
// classification and no target name from its caller: the checks come from the
// frozen catalogue keyed by binding type, and the `ref` comes from the tool's
// own manifest-derived input. There is therefore no argument a caller can pass
// that makes a plan do something the catalogue does not already declare.

import type { BindingType } from '@mcpforge/shared/manifest';
import { CHECK_CATALOGUE } from './checks.js';
import type { NonMutatingClassification, ProbePlan, ProbeCheckSpec } from './types.js';

/** The per-tool facts the plan builder reads. All manifest-derived. */
export interface ProbePlanInput {
  readonly toolId: string;
  readonly bindingType: BindingType;
  readonly write: boolean;
}

export function buildProbePlan(input: ProbePlanInput): ProbePlan {
  const declared: readonly ProbeCheckSpec<NonMutatingClassification>[] =
    CHECK_CATALOGUE[input.bindingType];
  const checks = declared.filter((c) => (c.writeOnly ? input.write : true));
  return Object.freeze({
    toolId: input.toolId,
    bindingType: input.bindingType,
    write: input.write,
    checks: Object.freeze(checks),
  });
}
