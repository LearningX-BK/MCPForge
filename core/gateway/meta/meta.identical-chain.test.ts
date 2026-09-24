// MCPForge — W0-G4 `done:` clause 3, and 02 §11.4.6, "the sharpest test":
//
//   "`forge.invoke` runs the identical policy chain, two-phase confirm,
//    guardrails and audit path as a direct call, proved by running the same
//    policy test suite through both entry points."
//
// HOW THIS IS PROVED, AND WHAT WOULD NOT COUNT. Asserting that `forgeInvoke`
// calls `invokeThroughForgeInvoke` would prove only that one function calls
// another; a stage that read `entryPoint` would still slip through. So this
// suite takes the CASES from W0-E3's own chain suite — the same tools, the same
// contexts, the same refusals — drives each one through BOTH entry points, and
// diffs the entire decision: outcome, refusing stage, the ordered list of
// stages that ran, and the serialized error including its code, condition and
// `next`. The only field permitted to differ is the one W0-E3 says differs,
// `PolicyCall.entryPoint`, and no stage reads it.
//
// `tests/policy/**` (W0-E8) is the privilege-escalation suite and it stays
// exactly where it is: this file does not import, weaken or duplicate it. What
// it reuses is the fixture world both suites are built on.

import { describe, expect, it } from 'vitest';
import { callThroughToolsCall, type PolicyContext, type PolicyDecision } from '../policy/index.js';
import {
  context as policyContext,
  functionGrant,
  role,
  type PolicyContextOverrides,
} from '../policy/policy.fixtures.js';
import { consumer } from '../scope/scope.fixtures.js';
import { forgeInvoke } from './invoke.js';
import { metaContext, TOOLS } from './meta.fixtures.js';
import type { PolicyRoleView } from '../policy/index.js';

const CORRELATION_ID = 'req_identical_0001';

function grantedRoles(): ReadonlyMap<string, PolicyRoleView> {
  return new Map<string, PolicyRoleView>([
    ['p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] })],
    ['o2c', role({ roleId: 'o2c' })],
    ['r2r', role({ roleId: 'r2r' })],
  ]);
}

/** The comparable shape of a decision — everything a caller can observe. */
function comparable(decision: PolicyDecision): unknown {
  if (decision.outcome === 'refused') {
    return {
      outcome: decision.outcome,
      stage: decision.stage,
      stagesRun: [...decision.stagesRun],
      error: decision.error.toJSON(),
    };
  }
  if (decision.outcome === 'responded') {
    return {
      outcome: decision.outcome,
      stage: decision.stage,
      stagesRun: [...decision.stagesRun],
      response: decision.response,
    };
  }
  return {
    outcome: decision.outcome,
    stagesRun: [...decision.stagesRun],
    confirmed: decision.confirmed,
  };
}

interface Case {
  readonly label: string;
  readonly toolId: string;
  readonly args?: Record<string, unknown>;
  readonly overrides?: PolicyContextOverrides;
}

/**
 * The cases, lifted from `policy/policy.chain.test.ts`'s own coverage: one per
 * refusing stage that a fixture can reach without a live target, plus the
 * proceed path. Every one of them is a case where a divergent `forge.invoke`
 * would be a privilege escalation, not a cosmetic difference.
 */
const CASES: readonly Case[] = [
  {
    label: '6a — a tool in no catalogue at all',
    toolId: 'ebs.gl.journal.create',
  },
  {
    label: "6a — a tool outside this session's scope (r2r-only)",
    toolId: TOOLS.journalCreate,
  },
  {
    label: '6a — a tool this deployment does not carry',
    toolId: TOOLS.voucherGet,
  },
  {
    label: '6a′ — a retired consumer',
    toolId: TOOLS.voucherSearch,
    overrides: { consumer: consumer({ effectiveStatus: 'retired' }) },
  },
  {
    label: '6a′ — a consumer over its sensitivity ceiling',
    toolId: TOOLS.voucherExplain,
    overrides: { consumer: consumer({ authorizations: { maxSensitivity: 'internal' } }) },
  },
  {
    label: '6a′ — a consumer that may not write',
    toolId: TOOLS.voucherCancel,
    overrides: { consumer: consumer({ authorizations: { writeAllowed: false } }) },
  },
  {
    label: '6e′ — an elevated binding with no live grant',
    toolId: TOOLS.voucherCreate,
    args: { supplier: 'ACME', amount: 100 },
  },
  {
    label: '6e′ — an elevated binding WITH a live, recorded grant',
    toolId: TOOLS.voucherCreate,
    args: { supplier: 'ACME', amount: 100 },
    overrides: { roles: grantedRoles() },
  },
  {
    label: '6c — a rate limiter that refuses',
    toolId: TOOLS.voucherSearch,
    overrides: {
      runtime: {
        rateLimiter: {
          check: () => ({ allowed: false as const, reason: 'per-minute cap reached' }),
        },
      },
    },
  },
  {
    label: '6d — arguments that fail the compiled validator',
    toolId: TOOLS.voucherSearch,
    args: { supplier: 42 },
    overrides: {
      runtime: {
        argumentValidator: {
          validate: () => ({
            valid: false as const,
            errors: 'supplier: expected string, got number',
          }),
        },
      },
    },
  },
  {
    label: '6f — a declared guardrail breach',
    toolId: TOOLS.voucherCancel,
    overrides: {
      runtime: {
        guardrails: {
          evaluate: () => ({
            breached: true as const,
            message: 'amountCeiling: 10000 exceeds the declared 5000',
            next: 'Split the request under the ceiling, or ask the approver named on the guardrail to raise it.',
          }),
        },
      },
    },
  },
  {
    label: '6g — a write tool with no confirm token: a plan is returned',
    toolId: TOOLS.voucherCancel,
    overrides: {
      runtime: {
        writeGate: {
          evaluate: () => ({
            kind: 'respond' as const,
            response: { plan: 'This CANCELS an OPEN PAYABLE in JD Edwards.', confirmToken: 'tok' },
          }),
        },
      },
    },
  },
  {
    label: '6h — an idempotent replay',
    toolId: TOOLS.voucherSearch,
    overrides: {
      runtime: {
        idempotency: {
          lookup: () => ({ kind: 'replay' as const, previousResult: { document_number: 4242 } }),
        },
      },
    },
  },
  {
    label: 'proceed — a read tool the session fully holds',
    toolId: TOOLS.voucherSearch,
  },
];

describe('DONE: forge.invoke runs the IDENTICAL chain as tools/call', () => {
  for (const testCase of CASES) {
    it(`${testCase.label}: both entry points produce a byte-identical decision`, async () => {
      const args = testCase.args ?? {};
      const overrides = testCase.overrides ?? {};

      // Two independently constructed contexts over the same fixture world, so
      // the comparison cannot pass by sharing mutable state.
      const direct: PolicyContext = policyContext(overrides);
      const meta = metaContext(overrides);

      const viaToolsCall = await callThroughToolsCall(
        { toolId: testCase.toolId, args, correlationId: CORRELATION_ID },
        direct,
      );
      const viaForgeInvoke = await forgeInvoke(
        meta,
        { toolId: testCase.toolId, arguments: args },
        CORRELATION_ID,
      );

      expect(JSON.stringify(comparable(viaForgeInvoke))).toBe(
        JSON.stringify(comparable(viaToolsCall)),
      );
    });
  }

  it('covers a refusal, a terminal response and a proceed — not just one shape', async () => {
    const outcomes = new Set<string>();
    for (const testCase of CASES) {
      const decision = await forgeInvoke(
        metaContext(testCase.overrides ?? {}),
        { toolId: testCase.toolId, arguments: testCase.args ?? {} },
        CORRELATION_ID,
      );
      outcomes.add(decision.outcome);
    }
    expect([...outcomes].sort()).toEqual(['proceed', 'refused', 'responded']);
  });

  it('a confirm token travels as an ordinary argument, identically through both paths', async () => {
    const seen: Record<string, unknown>[] = [];
    const overrides: PolicyContextOverrides = {
      runtime: {
        writeGate: {
          evaluate: (call) => {
            seen.push({ ...call.args });
            return { kind: 'respond' as const, response: { echoed: true } };
          },
        },
      },
    };

    await callThroughToolsCall(
      {
        toolId: TOOLS.voucherCancel,
        args: { doc: 1, confirm: 'tok-1' },
        correlationId: CORRELATION_ID,
      },
      policyContext(overrides),
    );
    await forgeInvoke(
      metaContext(overrides),
      { toolId: TOOLS.voucherCancel, arguments: { doc: 1 }, confirm: 'tok-1' },
      CORRELATION_ID,
    );

    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(seen[0]);
  });
});
