// The `done:` criterion, tested directly: every tool in the catalogue carries
// exactly one status from the closed enum, with a failing check, an owning
// team, a remediation and an agentMessage — and the runner refuses a mutating
// check, by name, against a production target.

import { describe, expect, it } from 'vitest';
import { BINDING_TYPES, type BindingType } from '@mcpforge/shared/manifest';
import { createMockAisServer } from '@mcpforge/adapter-function/testing';
import type { CatalogueIndex } from '@mcpforge/registry/index';
import {
  IDENTITY_CONSTRAINT_CHECK,
  MutatingCheckRefused,
  assertNonMutating,
  runProbe,
  type ProbeToolInput,
} from './runner.js';
import { createFunctionProbeExecutor, PROBE_WHOAMI_ORCHESTRATION } from './function-executor.js';
import { probeInputsFromCatalogue, type ProbeToolDetail } from '../catalogue.js';
import { PROBE_STATUSES, PROBE_STATUS_SET } from '../status.js';
import type { ProbeTarget } from '../target.js';
import { validateProbeReport } from '../report/schema.js';
import { fixtureDatabaseGrantSource, staticExecutor } from '../testing/index.js';
import { CHECK_CATALOGUE } from '../plan/checks.js';
import type { ProbeCheckExecutor, ProbeCheckSpec } from '../plan/types.js';

const LOCAL: ProbeTarget = { id: 'local', environmentClass: 'local', deploymentId: 'dep-1' };
const PROD: ProbeTarget = { id: 'py920prod', environmentClass: 'prod', deploymentId: 'dep-prod' };
const NOW = (): Date => new Date('2026-09-04T09:00:00.000Z');

function tool(
  over: Partial<ProbeToolInput> & Pick<ProbeToolInput, 'toolId' | 'bindingType'>,
): ProbeToolInput {
  return {
    write: false,
    ref: 'SOME_REF',
    refVersion: null,
    owningTeam: 'JDE Finance CoE',
    ...over,
  };
}

/** A synthetic catalogue spanning every binding type, read and write. */
function syntheticCatalogue(): CatalogueIndex {
  const entries = BINDING_TYPES.flatMap((bindingType, i) =>
    [false, true].map((write) => ({
      id: `jde.m${i}.e${write ? 'w' : 'r'}.${write ? 'create' : 'get'}`,
      filters: {
        app: 'jde',
        module: `m${i}`,
        entity: `e${write ? 'w' : 'r'}`,
        verb: write ? 'create' : 'get',
        bindingType,
        archetype: 'transactional',
        sensitivity: 'financial',
        write,
        processTags: [],
        packageTags: [],
        roles: [],
        status: 'unresolved',
      },
      lexicalDocument: 'synthetic',
      disambiguation: null,
    })),
  );
  return { tools: entries };
}

describe('runProbe — every tool carries exactly one status', () => {
  it('reports every tool in the catalogue, with exactly one recognised status each', async () => {
    const index = syntheticCatalogue();
    const details = new Map<string, ProbeToolDetail>(
      index.tools.map((t) => [
        t.id,
        { ref: 'REF', refVersion: null, owningTeam: 'JDE Finance CoE' } satisfies ProbeToolDetail,
      ]),
    );
    const report = await runProbe({
      target: LOCAL,
      tools: probeInputsFromCatalogue(index, details),
      executors: new Map(),
      databaseGrants: fixtureDatabaseGrantSource(new Map()),
      now: NOW,
    });

    // Same set of ids in, same set out — nothing skipped, nothing duplicated.
    expect(report.tools.map((t) => t.toolId).sort()).toEqual(index.tools.map((t) => t.id).sort());
    expect(report.summary.toolCount).toBe(index.tools.length);

    for (const t of report.tools) {
      expect(PROBE_STATUS_SET.has(t.status)).toBe(true);
      expect(typeof t.status).toBe('string');
      // Exactly one: the field is scalar, and its value is a member.
      expect(PROBE_STATUSES.filter((s) => s === t.status)).toHaveLength(1);
    }

    // The counts account for every tool — no tool falls outside the summary.
    const summed = Object.values(report.summary.byStatus).reduce((a, b) => a + b, 0);
    expect(summed).toBe(report.summary.toolCount);
    // Every status is a key, zero included.
    expect(Object.keys(report.summary.byStatus).sort()).toEqual([...PROBE_STATUSES].sort());
  });

  it('a binding type with no executor is reported, not skipped', async () => {
    const report = await runProbe({
      target: LOCAL,
      tools: [tool({ toolId: 'jde.gl.journal.get', bindingType: 'rest' })],
      executors: new Map(),
      now: NOW,
    });
    const entry = report.tools[0]!;
    expect(entry.status).toBe('disabled_missing_binding');
    // Every declared check, plus the synthetic one naming the absent executor
    // — so the report says the CAUSE, not just the first symptom.
    // +1 for the synthetic `probe_executor_registered` gap check, +1 for
    // W0-H5's `identity_carriage_constraint`, which every tool carries.
    expect(entry.checks.length).toBe(CHECK_CATALOGUE.rest.length + 2);
    expect(entry.checks[0]!.name).toBe('probe_executor_registered');
    for (const c of entry.checks) {
      if (c.name === IDENTITY_CONSTRAINT_CHECK) {
        // W0-H5's verdict row: not an executed check, so it names the
        // constraint rather than the absent executor.
        expect(c.detail).toContain('auto-disabled');
        continue;
      }
      expect(c.detail).toContain('no probe executor is registered');
      expect(c.detail.length).toBeGreaterThan(0);
    }
  });

  it('non-resolved tools always carry an actionable remediation and agentMessage', async () => {
    const index = syntheticCatalogue();
    const report = await runProbe({
      target: LOCAL,
      tools: probeInputsFromCatalogue(
        index,
        new Map(
          index.tools.map((t) => [t.id, { ref: 'REF', refVersion: null, owningTeam: 'JDE CNC' }]),
        ),
      ),
      executors: new Map(),
      now: NOW,
    });
    for (const t of report.tools) {
      expect(t.owningTeam.trim().length).toBeGreaterThan(0);
      expect(t.remediation.trim().length).toBeGreaterThan(0);
      expect(t.agentMessage.trim().length).toBeGreaterThan(0);
      if (t.status !== 'resolved') {
        // Names the owner, names the failing check, and never says "try again".
        expect(t.remediation).toContain(t.owningTeam);
        expect(t.remediation).toMatch(/check "/);
        expect(t.agentMessage.toLowerCase()).not.toContain('try again');
        expect(t.agentMessage).toMatch(/Do not retry|reads only/);
      }
    }
  });

  it('an unowned tool is marked UNASSIGNED rather than silently attributed', async () => {
    const report = await runProbe({
      target: LOCAL,
      tools: [tool({ toolId: 'jde.gl.journal.get', bindingType: 'rest', owningTeam: '  ' })],
      executors: new Map(),
      now: NOW,
    });
    expect(report.tools[0]!.owningTeam).toContain('UNASSIGNED');
  });

  it('a kill-switched tool takes disabled_kill_switch, and the flag reason travels verbatim', async () => {
    const report = await runProbe({
      target: LOCAL,
      tools: [tool({ toolId: 'jde.ap.voucher.create', bindingType: 'function', write: true })],
      executors: new Map(),
      killReasonFor: (id) => (id === 'jde.ap.voucher.create' ? 'AP close in progress' : null),
      now: NOW,
    });
    const entry = report.tools[0]!;
    expect(entry.status).toBe('disabled_kill_switch');
    expect(entry.checks.some((c) => c.detail === 'AP close in progress')).toBe(true);
    expect(entry.remediation).toContain('kill-switched');
  });

  it('an executor that throws produces a failing check, never an unreported tool', async () => {
    const boom: ProbeCheckExecutor = {
      bindingType: 'rest',
      run: () => Promise.reject(new Error('connection reset')),
    };
    const report = await runProbe({
      target: LOCAL,
      tools: [tool({ toolId: 'jde.gl.journal.get', bindingType: 'rest' })],
      executors: new Map([['rest' as BindingType, boom]]),
      now: NOW,
    });
    expect(report.tools).toHaveLength(1);
    expect(report.tools[0]!.status).not.toBe('resolved');
    // Every EXECUTED check carries the throw's reason. W0-H5's
    // `identity_carriage_constraint` is not an executed check — it is the
    // verdict applied to them — so it reports the constraint instead.
    expect(
      report.tools[0]!.checks
        .filter((c) => c.name !== IDENTITY_CONSTRAINT_CHECK)
        .every((c) => c.detail.includes('connection reset')),
    ).toBe(true);
    expect(report.tools[0]!.identity.carries).toBe('unverified');
    expect(report.tools[0]!.identity.autoDisabled).toBe(true);
  });

  it('a tool whose every check passes is resolved', async () => {
    const outcomes = new Map(CHECK_CATALOGUE.rest.map((c) => [c.name, 'pass' as const]));
    const report = await runProbe({
      target: LOCAL,
      tools: [tool({ toolId: 'jde.gl.journal.get', bindingType: 'rest' })],
      executors: new Map([
        ['rest' as BindingType, staticExecutor({ bindingType: 'rest', outcomes })],
      ]),
      now: NOW,
    });
    expect(report.tools[0]!.status).toBe('resolved');
    expect(report.tools[0]!.identityCarries).toBe(true);
  });

  it('the emitted report validates against probe-report.schema.json', async () => {
    const index = syntheticCatalogue();
    const report = await runProbe({
      target: LOCAL,
      tools: probeInputsFromCatalogue(
        index,
        new Map(
          index.tools.map((t) => [t.id, { ref: 'REF', refVersion: null, owningTeam: 'JDE CoE' }]),
        ),
      ),
      executors: new Map(),
      databaseGrants: fixtureDatabaseGrantSource(new Map()),
      now: NOW,
    });
    const result = validateProbeReport(JSON.parse(JSON.stringify(report)));
    expect(result.violations).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe('the runner refuses mutating checks', () => {
  // A mutating check cannot be produced by `buildProbePlan` (that is the type
  // guarantee). This test forces one past the type system to prove the RUNTIME
  // guard exists too — the guarantee that survives a JSON boundary or a cast.
  const mutating = {
    name: 'destructive_classification',
    classification: 'mutating',
    bindingType: 'function',
    failureStatus: 'degraded_readonly',
    writeOnly: false,
    describe: 'a destructive classification check (02 §7.1: probe environment only)',
  } as unknown as ProbeCheckSpec<'read-only'>;

  it('refuses a mutating check against a production target, naming production', () => {
    expect(() => assertNonMutating('jde.ap.voucher.create', mutating, PROD)).toThrow(
      MutatingCheckRefused,
    );
    expect(() => assertNonMutating('jde.ap.voucher.create', mutating, PROD)).toThrow(
      /production target/,
    );
  });

  it('refuses a mutating check against a non-production target too', () => {
    expect(() => assertNonMutating('jde.ap.voucher.create', mutating, LOCAL)).toThrow(
      MutatingCheckRefused,
    );
  });

  it('lets every check the frozen catalogue actually contains through', () => {
    for (const bindingType of BINDING_TYPES) {
      for (const check of CHECK_CATALOGUE[bindingType]) {
        expect(() => assertNonMutating('jde.ap.voucher.create', check, PROD)).not.toThrow();
      }
    }
  });

  it('runs the whole catalogue against a prod target without a single refusal', async () => {
    // The corollary of the two guards: because no plan can contain a mutating
    // check, a full prod run completes rather than refusing everything.
    const report = await runProbe({
      target: PROD,
      tools: BINDING_TYPES.map((bindingType, i) =>
        tool({ toolId: `jde.m${i}.e.create`, bindingType, write: true }),
      ),
      executors: new Map(),
      databaseGrants: fixtureDatabaseGrantSource(new Map()),
      now: NOW,
    });
    expect(report.tools).toHaveLength(BINDING_TYPES.length);
  });

  it('records on every report that mutating checks were refused', async () => {
    const report = await runProbe({ target: PROD, tools: [], executors: new Map(), now: NOW });
    expect(report.target.mutatingChecksRefused).toBe(true);
    expect(report.target.environmentClass).toBe('prod');
  });
});

describe('the function executor against the in-process fake AIS server', () => {
  it('passes whoami when the target echoes the probe test identity', async () => {
    const client = createMockAisServer({
      body: (req) =>
        req.orchestration === PROBE_WHOAMI_ORCHESTRATION
          ? JSON.stringify({ identity: 'TESTUSER01' })
          : JSON.stringify({ validated: true }),
    });
    const report = await runProbe({
      target: LOCAL,
      tools: [tool({ toolId: 'jde.ap.voucher.get', bindingType: 'function', ref: 'JDE_AP_GET' })],
      executors: new Map([
        [
          'function' as BindingType,
          createFunctionProbeExecutor({
            client,
            testIdentity: 'TESTUSER01',
            acquireToken: () => Promise.resolve('token'),
          }),
        ],
      ]),
      now: NOW,
    });
    const entry = report.tools[0]!;
    expect(entry.checks.find((c) => c.name === 'whoami')?.result).toBe('pass');
    expect(entry.identityCarries).toBe(true);
    expect(entry.status).toBe('resolved');
  });

  it('reports disabled_identity_unverified when a service account executed instead', async () => {
    const client = createMockAisServer({ body: JSON.stringify({ identity: 'SVC_MCPFORGE' }) });
    const report = await runProbe({
      target: LOCAL,
      tools: [tool({ toolId: 'jde.ap.voucher.get', bindingType: 'function', ref: 'JDE_AP_GET' })],
      executors: new Map([
        [
          'function' as BindingType,
          createFunctionProbeExecutor({
            client,
            testIdentity: 'TESTUSER01',
            acquireToken: () => Promise.resolve('token'),
          }),
        ],
      ]),
      now: NOW,
    });
    const entry = report.tools[0]!;
    expect(entry.status).toBe('disabled_identity_unverified');
    expect(entry.identityCarries).toBe(false);
    const whoami = entry.checks.find((c) => c.name === 'whoami');
    expect(whoami?.detail).toContain('executed as SVC_MCPFORGE');
    expect(whoami?.detail).toContain('TESTUSER01');
    expect(whoami?.identityCarriage).toBe('no');
    expect(entry.identity.carries).toBe('no');
    expect(entry.agentMessage).toContain('Do not retry');
  });

  it('never dispatches the business orchestration for a write tool', async () => {
    const client = createMockAisServer({
      body: JSON.stringify({ identity: 'TESTUSER01', validated: true }),
    });
    await runProbe({
      target: LOCAL,
      tools: [
        tool({
          toolId: 'jde.ap.voucher.create',
          bindingType: 'function',
          write: true,
          ref: 'JDE_AP_VOUCHER_CREATE',
          refVersion: '3',
        }),
      ],
      executors: new Map([
        [
          'function' as BindingType,
          createFunctionProbeExecutor({
            client,
            testIdentity: 'TESTUSER01',
            acquireToken: () => Promise.resolve('token'),
          }),
        ],
      ]),
      now: NOW,
    });
    // The fake records every call it received. The write orchestration is not
    // among them — only the probe-owned names and the _VALIDATE sibling.
    expect(client.calls.map((c) => c.orchestration)).not.toContain('JDE_AP_VOUCHER_CREATE');
    expect(client.calls.length).toBeGreaterThan(0);
  });
});
