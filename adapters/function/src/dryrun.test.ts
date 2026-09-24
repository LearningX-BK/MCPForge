// MCPForge — W0-H2's done criterion, clause by clause. 02 §3.5's validate-pair
// dry run and its degradation ladder; 01 §10.5 item 2.
//
// EVERY test here runs against the in-process fake AIS server. There is no live
// JDE instance in this environment and the six `*_VALIDATE` orchestrations of
// `docs/build-plan/w0-hg2-validate-orchestrations.md` are specified but NOT YET
// AUTHORED anywhere real. What is proved here is the dispatch and the ladder,
// not the existence of the pairs.

import { describe, expect, it } from 'vitest';
import type { ForgeError } from '@mcpforge/shared/errors';
import type { ToolManifest } from '@mcpforge/shared/manifest';
import type { FunctionCallInput } from './types.js';
import {
  NO_PROBE_EVIDENCE,
  NotAWriteTool,
  VALIDATE_SIBLING_SUFFIX,
  buildDryRunDescriptor,
  createDryRunDispatcher,
  resolveDryRunPlan,
  validatePairRegistry,
  validateSiblingDescriptor,
} from './dryrun.js';
import { buildFunctionBindingDescriptor } from './descriptor.js';
import { createFunctionExecutor } from './executor.js';
import { createAlwaysSampler } from './identity.js';
import { compileGeneratedSchema } from './schema.js';
import { createMockAisServer } from './testing/mock-ais-server.js';
import {
  voucherCreateManifest,
  voucherCreateSchema,
  voucherCreateSchemaOpen,
} from './fixtures.test-support.js';
import { TEST_EXECUTION_GRANT, TEST_GRANTS } from './testing/index.js';

const CALLER = 'bikash';
const EXECUTE_REF = 'MCPFORGE_AP_VOUCHER_CREATE_EXECUTE';
const VALIDATE_REF = 'MCPFORGE_AP_VOUCHER_CREATE_VALIDATE';
const args = { supplier: '4242', amount: 18400, company: '00100' } as const;
const validate = compileGeneratedSchema(voucherCreateSchema);

function callInput(): FunctionCallInput {
  return {
    args: { ...args },
    correlationId: 'corr-1',
    validate,
    principalSubject: CALLER,
    executionGrant: TEST_EXECUTION_GRANT,
  };
}

/** Probe evidence saying the sibling is there. The happy path's precondition. */
const PAIR_PRESENT = validatePairRegistry(new Map([[VALIDATE_REF, true]]));
/** Probe evidence saying it is NOT there — the steward never authored it. */
const PAIR_ABSENT = validatePairRegistry(new Map([[VALIDATE_REF, false]]));

function manifestWith(patch: Partial<ToolManifest>): ToolManifest {
  return { ...voucherCreateManifest, ...patch } as ToolManifest;
}

async function refusal(p: Promise<unknown>): Promise<ForgeError> {
  try {
    await p;
  } catch (err) {
    return err as ForgeError;
  }
  throw new Error('expected a refusal, got a result');
}

describe('W0-H2 — the descriptor is manifest-derived and nothing else', () => {
  it('takes the validate ref from writeSafety.dryRun.ref when the manifest names one', () => {
    const d = buildDryRunDescriptor(voucherCreateManifest);
    expect(d.validateRef).toBe(VALIDATE_REF);
    expect(d.execute.ref).toBe(EXECUTE_REF);
    expect(d.sensitivity).toBe('financial');
    expect(d.declaredHumanApprovalRequired).toBe(false);
  });

  it('falls back to 02 §3.5’s `<ref>_VALIDATE` convention when the manifest names none', () => {
    const d = buildDryRunDescriptor(
      manifestWith({
        writeSafety: {
          ...voucherCreateManifest.writeSafety!,
          dryRun: { strategy: 'validate-pair' },
        },
      } as Partial<ToolManifest>),
    );
    expect(d.validateRef).toBe(`${EXECUTE_REF}${VALIDATE_SIBLING_SUFFIX}`);
  });

  it('refuses a manifest that is not a write tool', () => {
    const read = { ...voucherCreateManifest };
    delete (read as { writeSafety?: unknown }).writeSafety;
    expect(() => buildDryRunDescriptor({ ...read, write: false } as ToolManifest)).toThrow(
      NotAWriteTool,
    );
    // ...and a manifest claiming `write: true` with no writeSafety block at all
    // (CLAUDE.md #4 makes that unauthorable, but the guard is not a comment).
    expect(() => buildDryRunDescriptor({ ...read, write: true } as ToolManifest)).toThrow(
      NotAWriteTool,
    );
  });

  it('never lets an orchestration name arrive from a caller argument', async () => {
    // The only public entry points are (a) a manifest and (b) a descriptor built
    // from one. There is no parameter on `dryRun` that names an orchestration,
    // so the closest a caller can get is an ARGUMENT. The generated schema is
    // closed and would refuse it outright, so this uses the OPEN variant — the
    // same device `executor.test.ts` uses — to prove the MAPPING, not the
    // schema, is what keeps a caller-supplied orchestration name off the wire.
    const server = createMockAisServer({ executesAs: CALLER });
    const dispatcher = createDryRunDispatcher({
      executor: createFunctionExecutor({
        grants: TEST_GRANTS,
        client: server,
        echoSampler: createAlwaysSampler(),
      }),
      registry: PAIR_PRESENT,
    });
    const descriptor = buildDryRunDescriptor(voucherCreateManifest);
    await dispatcher.dryRun(descriptor, {
      executionGrant: TEST_EXECUTION_GRANT,
      ...callInput(),
      validate: compileGeneratedSchema(voucherCreateSchemaOpen),
      args: { ...args, orchestration: 'MCPFORGE_AP_VOUCHER_CREATE_EXECUTE' },
    });
    expect(server.calls.map((c) => c.orchestration)).toEqual([VALIDATE_REF]);
    expect(server.calls[0]?.inputs).not.toHaveProperty('orchestration');
  });
});

describe('W0-H2 (a) — validate-pair dispatches to the X_VALIDATE sibling', () => {
  it('dispatches the sibling, never the EXECUTE orchestration', async () => {
    const server = createMockAisServer({ executesAs: CALLER });
    const dispatcher = createDryRunDispatcher({
      executor: createFunctionExecutor({
        grants: TEST_GRANTS,
        client: server,
        echoSampler: createAlwaysSampler(),
      }),
      registry: PAIR_PRESENT,
    });

    const outcome = await dispatcher.dryRun(
      buildDryRunDescriptor(voucherCreateManifest),
      callInput(),
    );

    expect(outcome.dispatched).toBe(true);
    expect(outcome.plan.effectiveStrategy).toBe('validate-pair');
    expect(outcome.plan.degraded).toBe(false);
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]?.orchestration).toBe(VALIDATE_REF);
    expect(server.calls.some((c) => c.orchestration === EXECUTE_REF)).toBe(false);
  });

  it('returns the SAME error structure as X_EXECUTE would', async () => {
    // One target error, dispatched twice: once through the execute path and once
    // through the dry-run path. The two ForgeErrors must agree on every field
    // that is not the correlation id — that is what "shares one error mapper"
    // means, and it is why the dispatcher reuses the executor rather than
    // wrapping it.
    const behaviour = {
      targetError: { message: 'supplier 4242 is on hold', precondition: true },
    } as const;
    const executeServer = createMockAisServer(behaviour);
    const validateServer = createMockAisServer(behaviour);

    const executeError = await refusal(
      createFunctionExecutor({ grants: TEST_GRANTS, client: executeServer }).execute(
        buildFunctionBindingDescriptor(voucherCreateManifest),
        callInput(),
      ),
    );
    const dryRunError = await refusal(
      createDryRunDispatcher({
        executor: createFunctionExecutor({ grants: TEST_GRANTS, client: validateServer }),
        registry: PAIR_PRESENT,
      }).dryRun(buildDryRunDescriptor(voucherCreateManifest), callInput()),
    );

    expect(dryRunError.code).toBe(executeError.code);
    expect(dryRunError.code).toBe('TARGET_PRECONDITION_FAILED');
    // Same shape, same keys, same `next` discipline.
    expect(Object.keys(dryRunError.toJSON()).sort()).toEqual(
      Object.keys(executeError.toJSON()).sort(),
    );
    expect(dryRunError.next.trim().length).toBeGreaterThan(0);
    // The only difference is which orchestration name the message carries.
    expect(dryRunError.message.replace(VALIDATE_REF, EXECUTE_REF)).toBe(executeError.message);
  });

  it('rejects the same arguments the EXECUTE path rejects, with the same code', async () => {
    const server = createMockAisServer({ executesAs: CALLER });
    const error = await refusal(
      createDryRunDispatcher({
        executor: createFunctionExecutor({ grants: TEST_GRANTS, client: server }),
        registry: PAIR_PRESENT,
      }).dryRun(buildDryRunDescriptor(voucherCreateManifest), {
        executionGrant: TEST_EXECUTION_GRANT,
        ...callInput(),
        args: { supplier: '4242' }, // `amount` is required
      }),
    );
    expect(error.code).toBe('INPUT_INVALID');
    expect(server.calls).toHaveLength(0);
  });
});

describe('W0-H2 (b) — the degradation ladder', () => {
  it('degrades to precondition-read when probe evidence says the pair is absent', () => {
    const plan = resolveDryRunPlan(buildDryRunDescriptor(voucherCreateManifest), PAIR_ABSENT);
    expect(plan.declaredStrategy).toBe('validate-pair');
    expect(plan.effectiveStrategy).toBe('precondition-read');
    expect(plan.degraded).toBe(true);
    expect(plan.validatePairPresent).toBe(false);
    expect(plan.reason.trim().length).toBeGreaterThan(0);
  });

  it('FORCES humanApprovalRequired to true for a financial tool', () => {
    const descriptor = buildDryRunDescriptor(voucherCreateManifest);
    expect(descriptor.sensitivity).toBe('financial');
    expect(descriptor.declaredHumanApprovalRequired).toBe(false); // the manifest says no

    const plan = resolveDryRunPlan(descriptor, PAIR_ABSENT);

    expect(plan.humanApprovalRequired).toBe(true); // ...and the ladder says yes
    expect(plan.humanApprovalForced).toBe(true);
    expect(plan.reason).toContain('FORCED');
  });

  it('treats NO probe evidence exactly like evidence of absence', () => {
    const descriptor = buildDryRunDescriptor(voucherCreateManifest);
    const unknown = resolveDryRunPlan(descriptor, NO_PROBE_EVIDENCE);
    const absent = resolveDryRunPlan(descriptor, PAIR_ABSENT);
    expect(unknown.effectiveStrategy).toBe(absent.effectiveStrategy);
    expect(unknown.humanApprovalRequired).toBe(absent.humanApprovalRequired);
    expect(unknown.degraded).toBe(true);
  });

  it('degrades when no registry is supplied at all — the default is not "present"', () => {
    const plan = resolveDryRunPlan(buildDryRunDescriptor(voucherCreateManifest));
    expect(plan.degraded).toBe(true);
    expect(plan.humanApprovalRequired).toBe(true);
  });

  it('dispatches NOTHING when degraded — no sibling call, no execute call', async () => {
    const server = createMockAisServer({ executesAs: CALLER });
    const outcome = await createDryRunDispatcher({
      executor: createFunctionExecutor({ grants: TEST_GRANTS, client: server }),
      registry: PAIR_ABSENT,
    }).dryRun(buildDryRunDescriptor(voucherCreateManifest), callInput());

    expect(outcome.dispatched).toBe(false);
    expect(outcome.result).toBeNull();
    expect(outcome.plan.humanApprovalRequired).toBe(true);
    expect(server.calls).toHaveLength(0);
  });

  it('does not force approval for a non-financial tool, but still degrades', () => {
    const plan = resolveDryRunPlan(
      buildDryRunDescriptor(manifestWith({ sensitivity: 'internal' })),
      PAIR_ABSENT,
    );
    expect(plan.degraded).toBe(true);
    expect(plan.effectiveStrategy).toBe('precondition-read');
    expect(plan.humanApprovalRequired).toBe(false);
    expect(plan.humanApprovalForced).toBe(false);
  });

  it('never LOWERS an approval the manifest already required', () => {
    const strict = manifestWith({
      sensitivity: 'internal',
      writeSafety: {
        ...voucherCreateManifest.writeSafety!,
        humanApprovalRequired: true,
      },
    } as Partial<ToolManifest>);
    for (const registry of [PAIR_PRESENT, PAIR_ABSENT, NO_PROBE_EVIDENCE]) {
      const plan = resolveDryRunPlan(buildDryRunDescriptor(strict), registry);
      expect(plan.humanApprovalRequired).toBe(true);
      // It was already required, so nothing was FORCED by the ladder.
      expect(plan.humanApprovalForced).toBe(false);
    }
  });

  it('every financial write tool with an absent pair requires approval — exhaustively', () => {
    // The property, not one example: across every combination of declared
    // approval and evidence, a financial tool whose pair is not proven present
    // can never come back with humanApprovalRequired false.
    for (const declared of [false, true]) {
      for (const registry of [PAIR_ABSENT, NO_PROBE_EVIDENCE]) {
        const plan = resolveDryRunPlan(
          buildDryRunDescriptor(
            manifestWith({
              sensitivity: 'financial',
              writeSafety: {
                ...voucherCreateManifest.writeSafety!,
                humanApprovalRequired: declared,
              },
            } as Partial<ToolManifest>),
          ),
          registry,
        );
        expect(plan.humanApprovalRequired).toBe(true);
        expect(plan.effectiveStrategy).toBe('precondition-read');
      }
    }
  });
});

describe('W0-H2 — degradation comes from probe evidence, never from a runtime failure', () => {
  it('a failing _VALIDATE call propagates the error and does NOT silently degrade', async () => {
    const server = createMockAisServer({ throws: new Error('fetch failed') });
    const dispatcher = createDryRunDispatcher({
      executor: createFunctionExecutor({ grants: TEST_GRANTS, client: server }),
      registry: PAIR_PRESENT,
    });
    const error = await refusal(
      dispatcher.dryRun(buildDryRunDescriptor(voucherCreateManifest), callInput()),
    );
    expect(error.code).toBe('TARGET_UNAVAILABLE');
    // The plan was, and remains, validate-pair: a transient target failure is
    // not a licence to remove the dry run from a financial write.
    expect(
      resolveDryRunPlan(buildDryRunDescriptor(voucherCreateManifest), PAIR_PRESENT).degraded,
    ).toBe(false);
  });

  it('keeps the identity echo on the sibling — a _VALIDATE with no echo fails the dry run', async () => {
    // `echoOn: write` is inherited by the sibling descriptor on purpose. A
    // sibling composed without its final identity step is a FAILED dry run, not
    // a passed one whose executing identity nobody checked.
    const server = createMockAisServer({}); // no `executesAs` — no echo in the body
    const error = await refusal(
      createDryRunDispatcher({
        executor: createFunctionExecutor({
          grants: TEST_GRANTS,
          client: server,
          echoSampler: createAlwaysSampler(),
        }),
        registry: PAIR_PRESENT,
      }).dryRun(buildDryRunDescriptor(voucherCreateManifest), callInput()),
    );
    expect(error.code).toBe('IDENTITY_UNRESOLVED');
  });

  it('the sibling descriptor differs from the execute descriptor in `ref` and nothing else', () => {
    const descriptor = buildDryRunDescriptor(voucherCreateManifest);
    const sibling = validateSiblingDescriptor(descriptor, VALIDATE_REF);
    expect(sibling.ref).toBe(VALIDATE_REF);
    expect({ ...sibling, ref: descriptor.execute.ref }).toEqual({ ...descriptor.execute });
    // Notably `write` is still true, so the error copy stays the cautious one.
    expect(sibling.write).toBe(true);
  });
});

describe('W0-H2 — a non-validate-pair strategy is left alone', () => {
  it('passes a declared precondition-read strategy through untouched', () => {
    const plan = resolveDryRunPlan(
      buildDryRunDescriptor(
        manifestWith({
          writeSafety: {
            ...voucherCreateManifest.writeSafety!,
            dryRun: { strategy: 'precondition-read' },
          },
        } as Partial<ToolManifest>),
      ),
      NO_PROBE_EVIDENCE,
    );
    expect(plan.effectiveStrategy).toBe('precondition-read');
    expect(plan.degraded).toBe(false);
    expect(plan.humanApprovalForced).toBe(false);
    expect(plan.validateRef).toBeNull();
  });
});
