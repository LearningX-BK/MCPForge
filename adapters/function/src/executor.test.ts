// MCPForge — the `function` binding executor's proofs. 02 §3.5.
// Every test here runs against the in-process fake AIS server; NONE of it has
// ever been run against a live JDE AIS instance (none exists in this
// environment).

import { describe, expect, it } from 'vitest';
import type { ForgeError } from '@mcpforge/shared/errors';
import { buildFunctionBindingDescriptor } from './descriptor.js';
import { createFunctionExecutor } from './executor.js';
import { compileGeneratedSchema } from './schema.js';
import { createMockAisServer } from './testing/mock-ais-server.js';
import {
  voucherCreateManifest,
  voucherCreateSchema,
  voucherCreateSchemaOpen,
} from './fixtures.test-support.js';
import type { FunctionBindingDescriptor } from './types.js';

const descriptor = buildFunctionBindingDescriptor(voucherCreateManifest);
const validate = compileGeneratedSchema(voucherCreateSchema);
const validateOpen = compileGeneratedSchema(voucherCreateSchemaOpen);

const CALLER = 'bikash';

const goodArgs = { supplier: '4242', amount: 18400, company: '00100' } as const;

async function expectForgeError(p: Promise<unknown>): Promise<ForgeError> {
  try {
    await p;
  } catch (err) {
    const e = err as ForgeError;
    expect(e.name).toBe('ForgeError');
    // CLAUDE.md non-negotiable #5 — every error path carries an actionable next.
    expect(e.next.trim().length).toBeGreaterThan(0);
    expect(e.next.toLowerCase()).not.toBe('try again');
    return e;
  }
  throw new Error('expected the call to be refused, but it resolved');
}

describe('binding.ref is the only source of the orchestration name (02 §3.5)', () => {
  it('dispatches the manifest ref, ignoring every orchestration-shaped argument', async () => {
    const client = createMockAisServer({ executesAs: CALLER });
    const exec = createFunctionExecutor({ client });

    // The attack: every plausible way a caller might try to name an
    // orchestration, on an OPEN schema so nothing else can be credited with
    // stopping it.
    const hostile = {
      ...goodArgs,
      orchestration: 'MCPFORGE_PAYMENT_TRANSMIT',
      ref: 'MCPFORGE_PAYMENT_TRANSMIT',
      binding: { ref: 'MCPFORGE_PAYMENT_TRANSMIT' },
      orchestrationName: 'MCPFORGE_PAYMENT_TRANSMIT',
      serviceRequest: { operation: 'MCPFORGE_PAYMENT_TRANSMIT' },
    };

    const result = await exec.execute(descriptor, {
      args: hostile,
      correlationId: 'c1',
      principalSubject: CALLER,
      validate: validateOpen,
    });

    expect(result.dispatched.orchestration).toBe('MCPFORGE_AP_VOUCHER_CREATE_EXECUTE');
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.orchestration).toBe('MCPFORGE_AP_VOUCHER_CREATE_EXECUTE');
    // Not merely overridden downstream — never forwarded at all.
    const sent = JSON.stringify(client.calls[0]?.inputs);
    expect(sent).not.toContain('MCPFORGE_PAYMENT_TRANSMIT');
    expect(Object.keys(client.calls[0]?.inputs ?? {})).toEqual(['supplier', 'amount', 'company']);
  });

  it('refuses to build a descriptor for a non-function binding', () => {
    const asRest = {
      ...voucherCreateManifest,
      binding: { ...voucherCreateManifest.binding, type: 'rest' },
    } as typeof voucherCreateManifest;
    expect(() => buildFunctionBindingDescriptor(asRest)).toThrow(/binding.type rest/);
  });

  it('refuses to build a descriptor with an empty binding.ref', () => {
    const noRef = {
      ...voucherCreateManifest,
      binding: { ...voucherCreateManifest.binding, ref: '   ' },
    } as typeof voucherCreateManifest;
    expect(() => buildFunctionBindingDescriptor(noRef)).toThrow(/binding\.ref is empty/);
  });

  it('freezes the descriptor so no call path can rewrite the ref', () => {
    expect(Object.isFrozen(descriptor)).toBe(true);
    const mutable = descriptor as unknown as { ref: string };
    expect(() => {
      'use strict';
      mutable.ref = 'MCPFORGE_PAYMENT_TRANSMIT';
    }).toThrow();
    expect(descriptor.ref).toBe('MCPFORGE_AP_VOUCHER_CREATE_EXECUTE');
  });
});

describe('input validation against the generated schema', () => {
  it('refuses a missing required argument with INPUT_INVALID and never dispatches', async () => {
    const client = createMockAisServer({ executesAs: CALLER });
    const exec = createFunctionExecutor({ client });
    const e = await expectForgeError(
      exec.execute(descriptor, {
        args: { supplier: '4242' },
        correlationId: 'c2',
        validate,
        principalSubject: CALLER,
      }),
    );
    expect(e.code).toBe('INPUT_INVALID');
    expect(e.message).toContain('amount');
    expect(client.calls).toHaveLength(0);
  });

  it('refuses a wrong-typed argument', async () => {
    const client = createMockAisServer({ executesAs: CALLER });
    const exec = createFunctionExecutor({ client });
    const e = await expectForgeError(
      exec.execute(descriptor, {
        args: { supplier: '4242', amount: 'lots' },
        correlationId: 'c3',
        validate,
      }),
    );
    expect(e.code).toBe('INPUT_INVALID');
    expect(client.calls).toHaveLength(0);
  });

  it('refuses an extra argument under the real (closed) generated schema', async () => {
    const client = createMockAisServer({ executesAs: CALLER });
    const exec = createFunctionExecutor({ client });
    const e = await expectForgeError(
      exec.execute(descriptor, {
        args: { ...goodArgs, sneaky: 'value' },
        correlationId: 'c4',
        validate,
      }),
    );
    expect(e.code).toBe('INPUT_INVALID');
    expect(client.calls).toHaveLength(0);
  });
});

describe('the generated mapping drops unmapped extras rather than forwarding them', () => {
  it('never forwards an unmapped field, even when the schema would allow it', async () => {
    const client = createMockAisServer({ executesAs: CALLER });
    const exec = createFunctionExecutor({ client });
    const result = await exec.execute(descriptor, {
      args: { ...goodArgs, sneaky: 'value', confirm: 'cnf_abc' },
      correlationId: 'c5',
      principalSubject: CALLER,
      validate: validateOpen,
    });

    expect(client.calls[0]?.inputs).toEqual({
      supplier: '4242',
      amount: 18400,
      company: '00100',
    });
    expect(client.calls[0]?.inputs).not.toHaveProperty('sneaky');
    // `confirm` is MCPForge protocol, not the target's, and is dropped too.
    expect(client.calls[0]?.inputs).not.toHaveProperty('confirm');
    expect(result.dispatched.droppedArgs).toEqual(['confirm', 'sneaky']);
  });

  it('omits an absent optional rather than sending undefined', async () => {
    const client = createMockAisServer({ executesAs: CALLER });
    const exec = createFunctionExecutor({ client });
    await exec.execute(descriptor, {
      args: { supplier: '4242', amount: 1 },
      correlationId: 'c6',
      principalSubject: CALLER,
      validate,
    });
    expect(Object.keys(client.calls[0]?.inputs ?? {})).toEqual(['supplier', 'amount']);
  });
});

describe('response size cap', () => {
  it('discards an oversized response with a cap error naming the get_status counterpart', async () => {
    const client = createMockAisServer({ bodyBytes: descriptor.execution.responseBytesMax + 1 });
    const exec = createFunctionExecutor({ client });
    const e = await expectForgeError(
      exec.execute(descriptor, {
        args: goodArgs,
        correlationId: 'c7',
        validate,
        principalSubject: CALLER,
      }),
    );
    expect(e.code).toBe('ROW_CAP_EXCEEDED');
    expect(e.message).toContain(String(descriptor.execution.responseBytesMax + 1));
    expect(e.condition).toContain('discarded rather than truncated');
    expect(e.next).toContain('jde.ap.voucher.get_status');
  });

  it('accepts a response exactly at the cap', async () => {
    const client = createMockAisServer({
      bodyBytes: descriptor.execution.responseBytesMax,
      executesAs: CALLER,
    });
    const exec = createFunctionExecutor({ client });
    const result = await exec.execute(descriptor, {
      args: goodArgs,
      correlationId: 'c8',
      principalSubject: CALLER,
      validate,
    });
    expect(result.body.length).toBe(descriptor.execution.responseBytesMax);
  });
});

describe('timeout', () => {
  it('fires TARGET_TIMEOUT on a hung target and tells a write caller not to retry blindly', async () => {
    const client = createMockAisServer({ hang: true });
    const exec = createFunctionExecutor({ client });
    const started = Date.now();
    const e = await expectForgeError(
      exec.execute(descriptor, {
        args: goodArgs,
        correlationId: 'c9',
        validate,
        principalSubject: CALLER,
      }),
    );
    expect(e.code).toBe('TARGET_TIMEOUT');
    expect(Date.now() - started).toBeGreaterThanOrEqual(descriptor.execution.timeoutMs - 25);
    expect(e.next).toContain('Do NOT re-issue');
    expect(e.next).toContain('jde.ap.voucher.get_status');
  });

  it('releases the concurrency slot after a timeout', async () => {
    const client = createMockAisServer({ hang: true });
    const exec = createFunctionExecutor({ client });
    const slim: FunctionBindingDescriptor = {
      ...descriptor,
      ref: 'SLOT_RELEASE_TEST',
      execution: { ...descriptor.execution, maxConcurrency: 1, timeoutMs: 60 },
    };
    await expectForgeError(
      exec.execute(slim, {
        args: goodArgs,
        correlationId: 'c10',
        validate,
        principalSubject: CALLER,
      }),
    );
    // If the slot leaked, this second call would be refused rather than time out.
    const second = await expectForgeError(
      exec.execute(slim, {
        args: goodArgs,
        correlationId: 'c11',
        validate,
        principalSubject: CALLER,
      }),
    );
    expect(second.code).toBe('TARGET_TIMEOUT');
  });
});

describe('per-orchestration maxConcurrency (default 4)', () => {
  it('defaults to 4 when the manifest omits it', () => {
    const noLimit = {
      ...voucherCreateManifest,
      binding: {
        ...voucherCreateManifest.binding,
        execution: { timeoutMs: 200, responseBytesMax: 4096 },
      },
    } as unknown as typeof voucherCreateManifest;
    expect(buildFunctionBindingDescriptor(noLimit).execution.maxConcurrency).toBe(4);
  });

  it('never admits a 5th simultaneous call — the 5th queues, it is not over-admitted', async () => {
    const client = createMockAisServer({ executesAs: CALLER });
    client.gate();
    const exec = createFunctionExecutor({ client });
    const gated: FunctionBindingDescriptor = {
      ...descriptor,
      ref: 'CONCURRENCY_QUEUE_TEST',
      execution: { ...descriptor.execution, maxConcurrency: 4, timeoutMs: 5000 },
    };

    const calls = Array.from({ length: 5 }, (_v, i) =>
      exec.execute(gated, {
        args: goodArgs,
        correlationId: `q${i}`,
        validate,
        principalSubject: CALLER,
      }),
    );

    // Let the first four reach the (gated) target.
    await new Promise((r) => setTimeout(r, 50));
    expect(client.calls).toHaveLength(4);
    expect(client.inFlight()).toBe(4);

    client.releaseAll();
    const results = await Promise.all(calls);

    expect(results).toHaveLength(5);
    expect(client.calls).toHaveLength(5);
    // The real assertion: five calls completed, but never five at once.
    expect(client.peakConcurrency()).toBeLessThanOrEqual(4);
  });

  it('refuses rather than over-admits when the queue wait exceeds the timeout', async () => {
    const client = createMockAisServer({ executesAs: CALLER });
    client.gate();
    const exec = createFunctionExecutor({ client });
    const tight: FunctionBindingDescriptor = {
      ...descriptor,
      ref: 'CONCURRENCY_REFUSE_TEST',
      execution: { ...descriptor.execution, maxConcurrency: 2, timeoutMs: 80 },
    };

    const held = [0, 1].map((i) =>
      exec.execute(tight, {
        args: goodArgs,
        correlationId: `h${i}`,
        validate,
        principalSubject: CALLER,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));

    const e = await expectForgeError(
      exec.execute(tight, {
        args: goodArgs,
        correlationId: 'h2',
        validate,
        principalSubject: CALLER,
      }),
    );
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.message).toContain('No call was made to the target');
    expect(e.next).toContain('no business record was created');
    // The refused call never reached the target at all.
    expect(client.calls).toHaveLength(2);

    client.releaseAll();
    await Promise.allSettled(held);
    expect(client.peakConcurrency()).toBeLessThanOrEqual(2);
  });

  it('shares one limit across two tools pointing at the same orchestration', async () => {
    const client = createMockAisServer({ executesAs: CALLER });
    client.gate();
    const exec = createFunctionExecutor({ client });
    const base: FunctionBindingDescriptor = {
      ...descriptor,
      ref: 'SHARED_REF_TEST',
      execution: { ...descriptor.execution, maxConcurrency: 2, timeoutMs: 5000 },
    };
    const twin: FunctionBindingDescriptor = { ...base, toolId: 'jde.ap.voucher.create_twin' };

    const calls = [
      exec.execute(base, {
        args: goodArgs,
        correlationId: 's0',
        validate,
        principalSubject: CALLER,
      }),
      exec.execute(base, {
        args: goodArgs,
        correlationId: 's1',
        validate,
        principalSubject: CALLER,
      }),
      exec.execute(twin, {
        args: goodArgs,
        correlationId: 's2',
        validate,
        principalSubject: CALLER,
      }),
    ];
    await new Promise((r) => setTimeout(r, 40));
    expect(client.inFlight()).toBe(2);

    client.releaseAll();
    await Promise.all(calls);
    expect(client.peakConcurrency()).toBeLessThanOrEqual(2);
  });
});

describe('target failures map onto the closed taxonomy', () => {
  it('maps an application error to TARGET_ERROR', async () => {
    const client = createMockAisServer({
      targetError: { message: 'F0411 insert rejected: invalid company' },
    });
    const exec = createFunctionExecutor({ client });
    const e = await expectForgeError(
      exec.execute(descriptor, {
        args: goodArgs,
        correlationId: 'c12',
        validate,
        principalSubject: CALLER,
      }),
    );
    expect(e.code).toBe('TARGET_ERROR');
  });

  it('maps a business precondition to TARGET_PRECONDITION_FAILED', async () => {
    const client = createMockAisServer({
      targetError: { message: 'PO 0000451 is not receipted', precondition: true },
    });
    const exec = createFunctionExecutor({ client });
    const e = await expectForgeError(
      exec.execute(descriptor, {
        args: goodArgs,
        correlationId: 'c13',
        validate,
        principalSubject: CALLER,
      }),
    );
    expect(e.code).toBe('TARGET_PRECONDITION_FAILED');
  });

  it('maps a transport failure to TARGET_UNAVAILABLE', async () => {
    const client = createMockAisServer({
      throws: new Error('connect ECONNREFUSED 127.0.0.1:9302'),
    });
    const exec = createFunctionExecutor({ client });
    const e = await expectForgeError(
      exec.execute(descriptor, {
        args: goodArgs,
        correlationId: 'c14',
        validate,
        principalSubject: CALLER,
      }),
    );
    expect(e.code).toBe('TARGET_UNAVAILABLE');
    expect(e.retryable).toBe(true);
  });
});
