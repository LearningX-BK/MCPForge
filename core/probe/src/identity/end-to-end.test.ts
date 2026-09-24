// W0-H5 — the whole path, end to end, against the in-process fake AIS server:
// authenticate as the designated test user -> call MCPFORGE_PROBE_WHOAMI ->
// compare -> verdict into the probe report -> automatic constraint -> the
// gateway's ProbeEnabled predicate. No live Oracle instance (02 §7.1, W0-H6).

import { describe, expect, it } from 'vitest';
import { createMockAisServer } from '@mcpforge/adapter-function/testing';
import type { BindingType } from '@mcpforge/shared/manifest';
import { PROBE_ENABLED_STATUSES } from '../status.js';
import { probeStatusMap } from '../report/io.js';
import { validateProbeReport } from '../report/schema.js';
import type { ProbeReport } from '../report/types.js';
import { createFunctionProbeExecutor } from '../run/function-executor.js';
import { runProbe, type ProbeToolInput } from '../run/runner.js';
import type { ProbeTarget } from '../target.js';
import { PROBE_WHOAMI_ORCHESTRATION } from './whoami.js';

const LOCAL: ProbeTarget = { id: 'py920', environmentClass: 'local', deploymentId: 'dev' };
const NOW = (): Date => new Date('2026-09-04T00:00:00.000Z');
const TEST_USER = 'TESTUSER01';

function tool(over: Partial<ProbeToolInput> = {}): ProbeToolInput {
  return {
    toolId: 'jde.ap.voucher.create',
    bindingType: 'function',
    write: true,
    ref: 'JDE_AP_VOUCHER_CREATE',
    refVersion: null,
    owningTeam: 'JDE Finance CoE',
    testIdentity: TEST_USER,
    onNonCarriage: 'block',
    sensitivity: 'financial',
    ...over,
  };
}

/** `whoami` answers `identity`; every other orchestration answers a validate shape. */
function target(identity: string | null): ReturnType<typeof createMockAisServer> {
  return createMockAisServer({
    body: (req) =>
      req.orchestration === PROBE_WHOAMI_ORCHESTRATION
        ? JSON.stringify(identity === null ? { note: 'no identity here' } : { identity })
        : JSON.stringify({ validated: true }),
  });
}

async function probe(
  identity: string | null,
  over: Partial<ProbeToolInput> = {},
  opts: { readonly missingProbeBinding?: boolean } = {},
): Promise<ProbeReport> {
  const client = opts.missingProbeBinding
    ? createMockAisServer({
        targetError: { message: `orchestration ${PROBE_WHOAMI_ORCHESTRATION} was not found` },
      })
    : target(identity);
  return runProbe({
    target: LOCAL,
    tools: [tool(over)],
    executors: new Map([
      [
        'function' as BindingType,
        createFunctionProbeExecutor({
          client,
          testIdentity: TEST_USER,
          acquireToken: () => Promise.resolve('token'),
        }),
      ],
    ]),
    now: NOW,
  });
}

describe('W0-H5 end to end — 02 §3.5 branch 1: equal -> verified', () => {
  it('writes identity.carries: verified into the probe report and publishes the write tool', async () => {
    const report = await probe(TEST_USER);
    const entry = report.tools[0]!;
    expect(entry.identity.carries).toBe('verified');
    expect(entry.identity.probeBinding).toBe(PROBE_WHOAMI_ORCHESTRATION);
    expect(entry.identity.testIdentity).toBe(TEST_USER);
    expect(entry.identity.observedIdentity).toBe(TEST_USER);
    expect(entry.identity.constrainedTo).toBeNull();
    expect(entry.identity.autoDisabled).toBe(false);
    expect(entry.identityCarries).toBe(true);
    expect(entry.status).toBe('resolved');
    expect(validateProbeReport(report).valid).toBe(true);
    // ...and the gateway's ProbeEnabled predicate lets it through.
    expect(PROBE_ENABLED_STATUSES.has(probeStatusMap(report).get(entry.toolId)!)).toBe(true);
  });
});

describe('W0-H5 end to end — 02 §3.5 branch 2: a service account came back -> no', () => {
  it('auto-disables the WRITE tool outright, full stop', async () => {
    const report = await probe('SVC_MCPFORGE');
    const entry = report.tools[0]!;
    expect(entry.identity.carries).toBe('no');
    expect(entry.identity.observedIdentity).toBe('SVC_MCPFORGE');
    expect(entry.identity.autoDisabled).toBe(true);
    expect(entry.status).toBe('disabled_identity_unverified');
    expect(entry.identityCarries).toBe(false);
    expect(PROBE_ENABLED_STATUSES.has(entry.status)).toBe(false);
  });

  it('auto-disables the write tool even when onServiceAccount says readonly-lowsens', async () => {
    const report = await probe('SVC_MCPFORGE', {
      onNonCarriage: 'readonly-lowsens',
      sensitivity: 'public',
    });
    expect(report.tools[0]!.status).toBe('disabled_identity_unverified');
  });

  it('applies onServiceAccount automatically for a READ: block disables', async () => {
    const report = await probe('SVC_MCPFORGE', {
      toolId: 'jde.ap.voucher.get',
      write: false,
      onNonCarriage: 'block',
      sensitivity: 'public',
    });
    expect(report.tools[0]!.status).toBe('disabled_identity_unverified');
  });

  it('applies onServiceAccount automatically for a READ: readonly-lowsens degrades', async () => {
    const report = await probe('SVC_MCPFORGE', {
      toolId: 'jde.ap.voucher.get',
      write: false,
      onNonCarriage: 'readonly-lowsens',
      sensitivity: 'internal',
    });
    const entry = report.tools[0]!;
    expect(entry.identity.carries).toBe('no');
    expect(entry.status).toBe('degraded_readonly');
    // Degraded is still published — read-only, low-sensitivity (01 §8 R1).
    expect(PROBE_ENABLED_STATUSES.has(entry.status)).toBe(true);
    expect(entry.agentMessage).toContain('reads only');
  });

  it('blocks a readonly-lowsens READ whose data is not low sensitivity', async () => {
    const report = await probe('SVC_MCPFORGE', {
      toolId: 'jde.ap.voucher.get',
      write: false,
      onNonCarriage: 'readonly-lowsens',
      sensitivity: 'financial',
    });
    expect(report.tools[0]!.status).toBe('disabled_identity_unverified');
  });
});

describe('W0-H5 end to end — 02 §3.5 branch 3: probe binding missing or erroring -> unverified', () => {
  it('auto-disables and names the owning team, for a human and for an agent', async () => {
    const report = await probe(null, {}, { missingProbeBinding: true });
    const entry = report.tools[0]!;
    expect(entry.identity.carries).toBe('unverified');
    expect(entry.identity.observedIdentity).toBeNull();
    expect(entry.identity.autoDisabled).toBe(true);
    expect(entry.status).toBe('disabled_identity_unverified');
    expect(entry.identityCarries).toBeNull();
    // "visibly reported with the owning team named" — both surfaces.
    expect(entry.remediation).toContain('JDE Finance CoE');
    expect(entry.agentMessage).toContain('JDE Finance CoE');
    expect(entry.agentMessage).toContain('Do not retry');
    expect(entry.remediation.toLowerCase()).not.toContain('try again');
  });

  it('treats an answer that names no identity as unverified, not as a pass', async () => {
    const report = await probe(null);
    const entry = report.tools[0]!;
    expect(entry.identity.carries).toBe('unverified');
    expect(entry.status).toBe('disabled_identity_unverified');
  });

  it('a function tool whose probe binding is silent is never resolved on other checks alone', async () => {
    // The auth token acquires fine and the *_VALIDATE sibling answers; only the
    // probe binding is silent. 01 §8 R1: no identity-carrying mark without
    // probe evidence.
    const report = await probe(null);
    expect(report.tools[0]!.status).not.toBe('resolved');
  });

  it('no configured test identity is itself unverified — there is no default identity', async () => {
    const report = await runProbe({
      target: LOCAL,
      tools: [tool()],
      executors: new Map([
        [
          'function' as BindingType,
          createFunctionProbeExecutor({
            client: target(TEST_USER),
            testIdentity: '',
            acquireToken: () => Promise.resolve('token'),
          }),
        ],
      ]),
      now: NOW,
    });
    expect(report.tools[0]!.identity.carries).toBe('unverified');
    expect(report.tools[0]!.status).toBe('disabled_identity_unverified');
  });
});

describe('W0-H5 — the report is the only carrier of the verdict', () => {
  it('every tool in a report carries an identity block and a derived boolean that agrees', async () => {
    for (const identity of [TEST_USER, 'SVC_MCPFORGE', null]) {
      const report = await probe(identity);
      const entry = report.tools[0]!;
      expect(validateProbeReport(report).valid).toBe(true);
      const expected =
        entry.identity.carries === 'verified'
          ? true
          : entry.identity.carries === 'no'
            ? false
            : null;
      expect(entry.identityCarries).toBe(expected);
    }
  });
});
