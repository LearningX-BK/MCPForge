// MCPForge — the three argument-shaped guardrail kinds. W0-F4, 02 §3.1.3.
//
//   maxNumeric / minNumeric  — an amount ceiling or floor on a named field.
//   allowedValues            — the companies or business units the caller may act on.
//
// THREE RULES, APPLIED IDENTICALLY BY ALL THREE, and each one is a decision:
//
//  1. **A malformed declaration BREACHES.** A `maxNumeric` with no `field`, or
//     with a non-numeric `value`, cannot be evaluated. It is refused, not
//     skipped. A guardrail nobody can evaluate must never read as a guardrail
//     everybody passed — that is how a control disappears in a typo.
//  2. **An absent argument passes.** Stage 6d has already validated the
//     arguments against the tool's schema, so a field that is absent here is an
//     OPTIONAL field the caller did not supply: there is no amount to bound and
//     no value to check. A required field can never reach 6f absent.
//  3. **A present argument of the wrong type BREACHES.** `amount: "lots"`
//     survives neither reading, and coercing it here would be a second,
//     divergent interpretation of arguments 6d has already ruled on.
//
// `message` is the guardrail's own when declared (02 §3.1.3), and otherwise
// names both the limit AND the actual value — the copy rule 03 §10.3 and
// W0-I6's `done:` clause both require of a guardrail message.

import type { Guardrail } from '@mcpforge/shared';
import { NOT_BREACHED, type GuardrailVerdict } from './types.js';

/** The breach an unevaluable declaration produces. Shared by every kind. */
export function malformedDeclaration(
  guardrail: Guardrail,
  toolId: string,
  detail: string,
): GuardrailVerdict {
  return {
    breached: true,
    kind: guardrail.kind,
    message:
      `A ${guardrail.kind} guardrail on ${toolId} cannot be evaluated: ${detail}. ` +
      `The call is refused because the guardrail could not be checked, not because you exceeded it.`,
    next:
      `Do not retry — the same declaration will refuse again. Ask your MCPForge operator to correct the ` +
      `${guardrail.kind} entry in this tool's manifest writeSafety.guardrails block; the fix is a change proposal, not a setting.`,
  };
}

function describeValue(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** `maxNumeric` and `minNumeric`. */
export function evaluateNumeric(
  guardrail: Guardrail,
  toolId: string,
  args: Readonly<Record<string, unknown>>,
): GuardrailVerdict {
  const field = guardrail.field;
  if (field === undefined || field === '') {
    return malformedDeclaration(guardrail, toolId, 'it names no field');
  }
  const limit = guardrail.value;
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return malformedDeclaration(
      guardrail,
      toolId,
      `its value on "${field}" is ${describeValue(limit)}, which is not a finite number`,
    );
  }

  const actual = args[field];
  if (actual === undefined || actual === null) return NOT_BREACHED;
  if (typeof actual !== 'number' || !Number.isFinite(actual)) {
    return malformedDeclaration(
      guardrail,
      toolId,
      `the argument "${field}" is ${describeValue(actual)}, which is not a finite number to compare against ${limit}`,
    );
  }

  const isMax = guardrail.kind === 'maxNumeric';
  const breaches = isMax ? actual > limit : actual < limit;
  if (!breaches) return NOT_BREACHED;

  return {
    breached: true,
    kind: guardrail.kind,
    message:
      guardrail.message ??
      `${field} is ${actual}, ${isMax ? 'above the maximum' : 'below the minimum'} of ${limit} this tool allows.`,
    next:
      `Change ${field} to a value ${isMax ? 'no greater than' : 'no less than'} ${limit} and call ${toolId} again ` +
      `(the plan must be re-issued for the new value), or ask the tool's business owner to record a policy exception raising the limit. ` +
      `The limit is a manifest declaration and cannot be raised per call.`,
  };
}

/** `allowedValues`. */
export function evaluateAllowedValues(
  guardrail: Guardrail,
  toolId: string,
  args: Readonly<Record<string, unknown>>,
): GuardrailVerdict {
  const field = guardrail.field;
  if (field === undefined || field === '') {
    return malformedDeclaration(guardrail, toolId, 'it names no field');
  }
  const allowed = guardrail.value;
  if (!Array.isArray(allowed) || allowed.length === 0) {
    return malformedDeclaration(
      guardrail,
      toolId,
      `its value on "${field}" is not a non-empty list of permitted values`,
    );
  }

  const actual = args[field];
  if (actual === undefined || actual === null) return NOT_BREACHED;
  if (typeof actual !== 'string' && typeof actual !== 'number') {
    return malformedDeclaration(
      guardrail,
      toolId,
      `the argument "${field}" is ${describeValue(actual)}, which is neither a string nor a number to match against the permitted list`,
    );
  }
  if (allowed.includes(actual)) return NOT_BREACHED;

  const rendered = allowed.map(describeValue).join(', ');
  return {
    breached: true,
    kind: guardrail.kind,
    message:
      guardrail.message ??
      `${field} is ${describeValue(actual)}, which is not one of the values this tool permits: ${rendered}.`,
    next:
      `Set ${field} to one of ${rendered} and call ${toolId} again, or ask your MCPForge operator for the grant that covers ` +
      `${describeValue(actual)}. Do not substitute a nearby value the caller did not ask for.`,
  };
}
