// MCPForge — W0-H3's done criterion, clause by clause. 02 §3.5's runtime
// identity echo. Every test runs against the in-process fake AIS server; NONE
// of it has been run against a live JDE AIS instance (none exists here).

import { describe, expect, it } from 'vitest';
import type { ForgeError } from '@mcpforge/shared/errors';
import { buildFunctionBindingDescriptor } from './descriptor.js';
import { createFunctionExecutor } from './executor.js';
import { FunctionIdentityEchoError } from './errors.js';
import {
  DEFAULT_READ_SAMPLE_RATE,
  createDeterministicSampler,
  decideEchoCheck,
  extractExecutingUser,
  identitiesMatch,
} from './identity.js';
import { compileGeneratedSchema } from './schema.js';
import { createMockAisServer } from './testing/mock-ais-server.js';
import { voucherCreateManifest, voucherCreateSchema } from './fixtures.test-support.js';
import type { ToolManifest } from '@mcpforge/shared/manifest';

const CALLER = 'bikash';
const args = { supplier: '4242', amount: 18400, company: '00100' } as const;
const validate = compileGeneratedSchema(voucherCreateSchema);

/** The write tool: `echoOn: write`, probe step `MCPFORGE_PROBE_WHOAMI`. */
const writeDescriptor = buildFunctionBindingDescriptor(voucherCreateManifest);

/** The same binding as a READ under `echoOn: sampled` — 02 §3.5's 1-in-N. */
function readManifest(echoOn: 'sampled' | 'write' | 'always' | 'never'): ToolManifest {
  return {
    ...voucherCreateManifest,
    id: 'jde.ap.voucher.get',
    verb: 'get',
    write: false,
    binding: {
      ...voucherCreateManifest.binding,
      ref: 'MCPFORGE_AP_VOUCHER_GET',
      identity: { ...voucherCreateManifest.binding.identity, echoOn },
    },
  } as ToolManifest;
}

async function refusal(p: Promise<unknown>): Promise<ForgeError> {
  try {
    await p;
  } catch (err) {
    const e = err as ForgeError;
    expect(e.name).toBe('ForgeError');
    expect(e.next.trim().length).toBeGreaterThan(0);
    expect(e.next.toLowerCase()).not.toBe('try again');
    return e;
  }
  throw new Error('expected the call to be refused, but it resolved');
}

describe('extraction — the executing user comes out of the response document', () => {
  it('reads it under the probe step, the shape an AIS orchestration returns', () => {
    const body = JSON.stringify({
      voucher: { docNumber: '77123' },
      MCPFORGE_PROBE_WHOAMI: { MCPFORGE_EXECUTING_USER: 'BIKASH' },
    });
    expect(extractExecutingUser(body, 'MCPFORGE_PROBE_WHOAMI')).toBe('BIKASH');
  });

  it('reads it at the document root', () => {
    expect(extractExecutingUser(JSON.stringify({ MCPFORGE_EXECUTING_USER: 'BIKASH' }), null)).toBe(
      'BIKASH',
    );
  });

  it('reads it through the single-element array AIS wraps step output in', () => {
    const body = JSON.stringify({ WHOAMI: [{ MCPFORGE_EXECUTING_USER: 'BIKASH' }] });
    expect(extractExecutingUser(body, 'WHOAMI')).toBe('BIKASH');
  });

  it('returns null — never a guess — for an absent, blank or unparseable echo', () => {
    expect(extractExecutingUser(JSON.stringify({ voucher: {} }), 'WHOAMI')).toBeNull();
    expect(
      extractExecutingUser(JSON.stringify({ MCPFORGE_EXECUTING_USER: '  ' }), null),
    ).toBeNull();
    expect(extractExecutingUser('not json at all', null)).toBeNull();
  });

  it('compares case- and whitespace-insensitively but nothing more', () => {
    expect(identitiesMatch('bikash', ' BIKASH ')).toBe(true);
    expect(identitiesMatch('bikash', 'bikash@ltm')).toBe(false);
    expect(identitiesMatch('bikash', 'JDE_SVC')).toBe(false);
  });
});

describe('a matching identity is a success carrying the audit values', () => {
  it('populates target_identity_observed and identity_match on the result', async () => {
    const client = createMockAisServer({
      executesAs: 'BIKASH',
      echoStep: 'MCPFORGE_PROBE_WHOAMI',
    });
    const exec = createFunctionExecutor({ client });

    const result = await exec.execute(writeDescriptor, {
      args,
      correlationId: 'echo-ok',
      validate,
      principalSubject: CALLER,
    });

    expect(result.identityEcho).toEqual({
      required: true,
      sampled: false,
      observed: 'BIKASH',
      match: true,
    });
  });
});

describe('a mismatched identity is a failure, and never a success', () => {
  it('refuses with the distinct error carrying observed + match:false', async () => {
    const client = createMockAisServer({
      executesAs: 'JDE_SVC',
      echoStep: 'MCPFORGE_PROBE_WHOAMI',
    });
    const exec = createFunctionExecutor({ client });

    const err = await refusal(
      exec.execute(writeDescriptor, {
        args,
        correlationId: 'echo-mismatch',
        validate,
        principalSubject: CALLER,
      }),
    );

    // Distinct: a dedicated class, not merely a shared taxonomy code.
    expect(err).toBeInstanceOf(FunctionIdentityEchoError);
    const echo = err as FunctionIdentityEchoError;
    expect(echo.targetIdentityObserved).toBe('JDE_SVC');
    expect(echo.identityMatch).toBe(false);
    expect(echo.expectedSubject).toBe(CALLER);
    expect(echo.code).toBe('IDENTITY_UNRESOLVED');
    expect(echo.retryable).toBe(false);
    // A write must never be told to retry blind (CLAUDE.md #5, 02 §3.1.5).
    expect(echo.next).toMatch(/Do NOT re-issue this write/);
    expect(echo.next).toContain('jde.ap.voucher.get_status');
  });

  it('the caller receives NO result, so no business record can be treated as completed', async () => {
    const client = createMockAisServer({
      executesAs: 'JDE_SVC',
      echoStep: 'MCPFORGE_PROBE_WHOAMI',
      // The target really did return a created document number. The safety
      // property is that a mismatched call still yields nothing a caller can
      // read as a completed write.
      body: JSON.stringify({
        voucher: { docNumber: '77123' },
        MCPFORGE_PROBE_WHOAMI: { MCPFORGE_EXECUTING_USER: 'JDE_SVC' },
      }),
    });
    const exec = createFunctionExecutor({ client });

    let resolved: unknown = 'nothing resolved';
    await exec
      .execute(writeDescriptor, {
        args,
        correlationId: 'echo-mismatch-2',
        validate,
        principalSubject: CALLER,
      })
      .then((r) => {
        resolved = r;
      })
      .catch(() => undefined);

    expect(resolved).toBe('nothing resolved');
    // The call did reach the target — the refusal is downstream of dispatch,
    // which is exactly why the reversal advice in `next` matters.
    expect(client.calls).toHaveLength(1);
  });

  it('a missing echo on a required check fails rather than being assumed fine', async () => {
    const client = createMockAisServer(); // composed without the echo step
    const exec = createFunctionExecutor({ client });

    const err = await refusal(
      exec.execute(writeDescriptor, {
        args,
        correlationId: 'echo-absent',
        validate,
        principalSubject: CALLER,
      }),
    );
    expect(err).toBeInstanceOf(FunctionIdentityEchoError);
    expect((err as FunctionIdentityEchoError).targetIdentityObserved).toBeNull();
    expect(err.message).toMatch(/NOT recorded as a success/);
  });

  it('a required check with no caller subject is IDENTITY_UNRESOLVED — there is no fallback', async () => {
    const client = createMockAisServer({ executesAs: 'BIKASH' });
    const exec = createFunctionExecutor({ client });

    const err = await refusal(
      exec.execute(writeDescriptor, { args, correlationId: 'echo-nosubject', validate }),
    );
    expect(err.code).toBe('IDENTITY_UNRESOLVED');
    expect(err.condition).toMatch(/no fallback subject/i);
  });
});

describe('reads are sampled 1-in-N, default 20 (02 §3.5)', () => {
  it('the default rate is 20', () => {
    expect(DEFAULT_READ_SAMPLE_RATE).toBe(20);
    expect(createDeterministicSampler().rate).toBe(20);
  });

  it('exactly one read in twenty is checked, and it is the first of each run', async () => {
    const readDescriptor = buildFunctionBindingDescriptor(readManifest('sampled'));
    const client = createMockAisServer({ executesAs: 'BIKASH' });
    const exec = createFunctionExecutor({ client, echoSampler: createDeterministicSampler(20) });

    const checked: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      const r = await exec.execute(readDescriptor, {
        args,
        correlationId: `r${i}`,
        validate,
        principalSubject: CALLER,
      });
      expect(r.identityEcho.sampled).toBe(true);
      if (r.identityEcho.required) {
        checked.push(i);
        expect(r.identityEcho.observed).toBe('BIKASH');
        expect(r.identityEcho.match).toBe(true);
      } else {
        // A skipped call is recorded honestly as unknown, never as a pass.
        expect(r.identityEcho.observed).toBeNull();
        expect(r.identityEcho.match).toBeNull();
      }
    }
    expect(checked).toEqual([0, 20, 40]);
    expect(checked).toHaveLength(60 / 20);
  });

  it('counts per orchestration, so a chatty read cannot starve a quiet one', () => {
    const sampler = createDeterministicSampler(3);
    expect([0, 1, 2, 3].map(() => sampler.shouldSample('A'))).toEqual([true, false, false, true]);
    expect(sampler.shouldSample('B')).toBe(true);
  });

  it('a sampled read whose identity mismatches still fails', async () => {
    const readDescriptor = buildFunctionBindingDescriptor(readManifest('sampled'));
    const client = createMockAisServer({ executesAs: 'JDE_SVC' });
    const exec = createFunctionExecutor({ client, echoSampler: createDeterministicSampler(20) });

    const err = await refusal(
      exec.execute(readDescriptor, {
        args,
        correlationId: 'read-mismatch',
        validate,
        principalSubject: CALLER,
      }),
    );
    expect(err).toBeInstanceOf(FunctionIdentityEchoError);
    // A read is told to report it, not to re-issue a write.
    expect(err.next).not.toMatch(/Do NOT re-issue this write/);
  });
});

describe('echoOn decides which calls are checked, and a write is never sampled out', () => {
  const never = buildFunctionBindingDescriptor(readManifest('never'));
  const write = buildFunctionBindingDescriptor(readManifest('write'));
  const always = buildFunctionBindingDescriptor(readManifest('always'));

  /** A sampler that would skip everything, to prove writes ignore it. */
  const skipAll = { rate: 1e9, shouldSample: () => false };

  it('never — no call is checked', () => {
    expect(decideEchoCheck(never, skipAll).required).toBe(false);
    expect(decideEchoCheck({ ...writeDescriptor, identity: never.identity }, skipAll)).toEqual({
      required: false,
      sampled: false,
    });
  });

  it('write — writes always, reads never', () => {
    expect(decideEchoCheck(write, skipAll).required).toBe(false);
    expect(decideEchoCheck(writeDescriptor, skipAll)).toEqual({ required: true, sampled: false });
  });

  it('sampled — a write is checked even when the sampler says skip', () => {
    const sampledWrite = {
      ...writeDescriptor,
      identity: { echoOn: 'sampled' as const, probe: 'MCPFORGE_PROBE_WHOAMI' },
    };
    expect(decideEchoCheck(sampledWrite, skipAll)).toEqual({ required: true, sampled: false });
  });

  it('always — reads are checked without consulting the sampler', () => {
    expect(decideEchoCheck(always, skipAll)).toEqual({ required: true, sampled: false });
  });
});
