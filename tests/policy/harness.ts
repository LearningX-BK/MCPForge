// MCPForge — the privilege-escalation suite's shared assertions. W0-E8.
//
// WHY THE ASSERTIONS LIVE IN ONE FILE. "Fails closed" is exactly the claim a
// weak test quietly stops making: `expect(() => ...).toThrow()` passes on a
// TypeError, `expect(result).toBeDefined()` passes on a refusal AND on a
// success, and a chain that returned `proceed` still "did not throw". So every
// case in this suite asserts refusal through `expectFailsClosed`, which checks
// the four things that together mean refused-and-not-executed:
//
//   1. the decision's outcome is literally `refused` — not `proceed`, and not
//      `responded` (a plan, an approval hand-off or a replay is a NON-error
//      terminal response, and none of the eight cases here is entitled to one);
//   2. the closed-taxonomy code is the expected one;
//   3. the refusal carries a non-empty, non-"try again" `next`
//      (CLAUDE.md non-negotiable #5);
//   4. no stage AFTER the refusing one ran — which is what "the call never
//      reached the binding executor" means at this layer.
//
// WHY THE IMPORTS ARE RELATIVE, NOT `@mcpforge/gateway/...`. This suite needs
// W0-E2's and W0-E3's own test fixtures (`scope.fixtures.ts`,
// `policy.fixtures.ts`) — the task's instruction is to reuse the repo's
// established test-construction patterns rather than invent a second style —
// and those files are deliberately not part of the gateway package's public
// exports. Mixing a package import of the gateway with a relative import of its
// fixtures would load two copies of the same modules, so every gateway import
// in this suite is relative and there is exactly one instance of each module.
// Codegen, which shares no fixture with this suite, is imported as a package.

import { expect } from 'vitest';
import type { PolicyDecision } from '../../core/gateway/policy/chain.js';
import type { PolicyStageId } from '../../core/gateway/policy/types.js';
// Type-only, so the package import carries no dual-instance risk.
import type { ErrorCode } from '@mcpforge/shared';

export interface FailsClosedExpectation {
  readonly code: ErrorCode;
  /** The stage that must own the refusal. */
  readonly stage: PolicyStageId;
}

/**
 * Asserts that `decision` is a refusal with the expected code, owned by the
 * expected stage, carrying a real `next`, with nothing downstream having run.
 * Returns the refusal so a caller can make case-specific assertions on it.
 */
export function expectFailsClosed(
  decision: PolicyDecision,
  expected: FailsClosedExpectation,
): Extract<PolicyDecision, { outcome: 'refused' }> {
  // Named in the failure message so a regression reads as "it proceeded" rather
  // than as an opaque property mismatch.
  expect(
    decision.outcome,
    `expected a REFUSAL but the policy chain returned "${decision.outcome}"`,
  ).toBe('refused');
  const refused = decision as Extract<PolicyDecision, { outcome: 'refused' }>;

  expect(refused.error.code).toBe(expected.code);
  expect(refused.stage).toBe(expected.stage);

  // Non-negotiable #5: a non-empty, agent-actionable next. "try again" is the
  // named anti-example in CLAUDE.md, so it is checked for by name.
  expect(typeof refused.error.next).toBe('string');
  expect(refused.error.next.trim().length).toBeGreaterThan(0);
  expect(refused.error.next.toLowerCase()).not.toMatch(/^try again\b/);

  // Nothing after the refusing stage ran.
  const refusingIndex = refused.stagesRun.indexOf(expected.stage);
  expect(refusingIndex, `${expected.stage} is not in stagesRun`).toBeGreaterThanOrEqual(0);
  expect(refused.stagesRun.slice(refusingIndex)).toEqual([expected.stage]);

  return refused;
}

/**
 * The counterpart guard. A "fails closed" test is only meaningful if the SAME
 * call succeeds when the one thing being tested is put back — otherwise the
 * refusal could be coming from anywhere. Cases that can establish a baseline
 * use this for it.
 */
export function expectProceeds(decision: PolicyDecision): void {
  expect(
    decision.outcome,
    decision.outcome === 'refused'
      ? `baseline call was refused: ${(decision as Extract<PolicyDecision, { outcome: 'refused' }>).error.code}`
      : `baseline call did not proceed ("${decision.outcome}")`,
  ).toBe('proceed');
}
