// MCPForge — the two guardrail kinds that read state outside the call. W0-F4,
// 02 §3.1.3.
//
//   rateLimit   — N executes per caller per window for this tool.
//   timeWindow  — e.g. no GL posting outside an open period, evaluated from a
//                 precondition read.
//
// THESE TWO ARE WHY 02 §3.1.3 SAYS "AND AGAIN AT EXECUTE TIME (NEVER ONLY AT
// PLAN)". The other three kinds are functions of arguments the confirm token
// already binds (W0-F2), so they cannot change between plan and execute without
// `PLAN_ARGUMENT_MISMATCH` catching it first. These two can, and do: another
// call by the same human consumes the last slot of the window, or the GL period
// closes, in the seconds between the human reading the plan and confirming it.
// Nothing in this file re-runs anything — the chain runs once per call and a
// plan and an execute are two calls, so stage 6f simply asks again, with the
// state as it is now.
//
// BOTH FAIL CLOSED WHEN THEIR SOURCE IS ABSENT. See ./types.ts.

import type { Guardrail } from '@mcpforge/shared';
import { malformedDeclaration } from './field.js';
import {
  NOT_BREACHED,
  type ExecuteCountSource,
  type GuardrailVerdict,
  type TimeWindowSource,
} from './types.js';

/** The breach a declared-but-uncheckable guardrail produces. */
function unenforceable(guardrail: Guardrail, toolId: string, missing: string): GuardrailVerdict {
  return {
    breached: true,
    kind: guardrail.kind,
    message:
      `The ${guardrail.kind} guardrail on ${toolId} could not be checked: this gateway has no ${missing}. ` +
      `The call is refused because the control could not be evaluated — an unenforceable guardrail is not a satisfied one.`,
    next:
      `Do not retry — the same call will refuse again. Tell the human the request did not reach the target system, so nothing was created or changed, ` +
      `and ask your MCPForge operator to configure the ${missing} for this deployment.`,
  };
}

export async function evaluateRateLimit(
  guardrail: Guardrail,
  toolId: string,
  subject: string,
  now: Date,
  executes: ExecuteCountSource | undefined,
): Promise<GuardrailVerdict> {
  const limit = guardrail.limit;
  const windowSeconds = guardrail.windowSeconds;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    return malformedDeclaration(
      guardrail,
      toolId,
      'it declares no positive integer `limit` of executes per window',
    );
  }
  if (typeof windowSeconds !== 'number' || !Number.isInteger(windowSeconds) || windowSeconds < 1) {
    return malformedDeclaration(
      guardrail,
      toolId,
      'it declares no positive integer `windowSeconds` to count the limit over',
    );
  }
  if (executes === undefined) return unenforceable(guardrail, toolId, 'execute counter');

  const since = new Date(now.getTime() - windowSeconds * 1000);
  const already = await executes.countExecutes({ toolId, subject, since, now });

  // `>=`, not `>`: the count excludes the call being evaluated, so admitting it
  // when `already === limit` would make the effective limit `limit + 1`.
  if (already < limit) return NOT_BREACHED;

  const windowText =
    windowSeconds % 3600 === 0
      ? `${windowSeconds / 3600}h`
      : windowSeconds % 60 === 0
        ? `${windowSeconds / 60}m`
        : `${windowSeconds}s`;

  return {
    breached: true,
    kind: guardrail.kind,
    message:
      guardrail.message ??
      `${subject} has already executed ${toolId} ${already} times in the last ${windowText}, and this tool allows ${limit} per caller per ${windowText}.`,
    next:
      `Wait until the ${windowText} window rolls forward before executing ${toolId} again — the plan you hold will have expired by then, so obtain a fresh one. ` +
      `If this workload genuinely needs a higher rate, ask the tool's business owner to raise the declared limit; it is a manifest declaration, not a per-call setting.`,
  };
}

export async function evaluateTimeWindow(
  guardrail: Guardrail,
  toolId: string,
  args: Readonly<Record<string, unknown>>,
  now: Date,
  windows: TimeWindowSource | undefined,
): Promise<GuardrailVerdict> {
  const ref = guardrail.ref;
  if (ref === undefined || ref === '') {
    return malformedDeclaration(
      guardrail,
      toolId,
      'it names no `ref` for the precondition read the window is evaluated from',
    );
  }
  if (windows === undefined) return unenforceable(guardrail, toolId, 'time-window source');

  const query =
    guardrail.field === undefined
      ? { toolId, ref, args, now }
      : { toolId, ref, field: guardrail.field, args, now };
  const verdict = await windows.isOpen(query);
  if (verdict.open) return NOT_BREACHED;

  return {
    breached: true,
    kind: guardrail.kind,
    message: guardrail.message ?? `${toolId} is outside its permitted window: ${verdict.detail}`,
    next:
      `Do not retry now — the window is closed, and the target would refuse or post to the wrong period. ${verdict.detail} ` +
      `Ask the finance operations owner when ${ref} reopens, then obtain a fresh plan for ${toolId} and confirm it inside the window.`,
  };
}
