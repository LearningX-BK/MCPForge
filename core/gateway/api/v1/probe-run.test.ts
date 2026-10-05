// W0-P33d — `runPortalProbe` in isolation: the paths the launched-gateway
// policy suite (tests/policy/escalation.probe-run.test.ts) does not drive.
// Every attempt is exactly one `probe` audit row; nothing is written before
// that row; a probe that could not be set up writes nothing at all.

import { describe, expect, it } from 'vitest';
import type { DeploymentProbeOutcome, EnvironmentClass, ProbeReport } from '@mcpforge/probe';
import type { EstablishedSession } from '../../assembly/session.js';
import type { AppendAuditCallInput } from '../../store/audit/types.js';
import { parseEnvironmentClass } from '../../launch.js';
import { ApiRefusal } from './refusal.js';
import {
  PROBE_ENVIRONMENT_REFUSED,
  probeReportSha256,
  runPortalProbe,
  type ProbeReloadResult,
} from './probe-run.js';

function session(groups: readonly string[] = ['supers']): EstablishedSession {
  const scopeSession = {
    principal: { subject: 'local:u-super', groups },
    heldRoleIds: ['super-admin'],
    consumer: {
      consumerId: 'portal-local',
      authorizations: { writeAllowed: true },
      attestation: { humanInTheLoop: true },
    },
    consumerSession: { recordSha: 'sha', authMethod: 'private-key-jwt', consumerSessionId: 'cs' },
  };
  return {
    sessionId: 's-1',
    principal: scopeSession.principal,
    scopeSession,
    scopeAt: () => ({ deployment: { deploymentId: 'local' } }),
  } as unknown as EstablishedSession;
}

const REPORT = {
  target: { id: 'local', environmentClass: 'local', deploymentId: 'local' },
  finishedAt: '2026-10-01T00:00:00Z',
  summary: { toolCount: 2, byStatus: { resolved: 1, disabled_missing_binding: 1 } },
} as unknown as ProbeReport;

function world(options: {
  environmentClass?: EnvironmentClass;
  outcome?: DeploymentProbeOutcome | Error;
  reload?: ProbeReloadResult;
}) {
  const events: string[] = [];
  const appended: AppendAuditCallInput[] = [];
  const deps = {
    store: {
      transaction: <T>(fn: () => Promise<T>) => fn(),
      audit: {
        append: (row: AppendAuditCallInput) => {
          appended.push(row);
          events.push(`audit:${row.outcome}`);
          return Promise.resolve({ id: `call-${appended.length}` });
        },
      },
    } as never,
    prober: {
      environmentClass: options.environmentClass ?? 'local',
      targetId: 'local',
      run: () => {
        events.push('run');
        const o = options.outcome ?? { ok: true, report: REPORT };
        return o instanceof Error ? Promise.reject(o) : Promise.resolve(o);
      },
      write: () => {
        events.push('write');
      },
    },
    superAdminGroups: ['local:supers'],
    reload: (): Promise<ProbeReloadResult> => {
      events.push('reload');
      return Promise.resolve(
        options.reload ?? { served: true, generation: 2, auditCallId: 'call-reload' },
      );
    },
    gatewayVersion: 'test',
    now: () => new Date('2026-10-01T00:00:00Z'),
  };
  const actor = { session: session(), subject: 'u-super', correlationId: 'req-1' };
  return { deps, actor, events, appended };
}

describe('runPortalProbe — W0-P33d', () => {
  it('records the row BEFORE the report is written, then reloads', async () => {
    const w = world({});
    const response = await runPortalProbe(w.deps, w.actor);
    expect(w.events).toEqual(['run', 'audit:ok', 'write', 'reload']);
    expect(w.appended[0]).toMatchObject({
      phase: 'probe',
      toolId: 'forge.probe.run',
      isWrite: false,
      resultKeys: [
        { keyName: 'probeReportSha256', keyValue: probeReportSha256(REPORT) },
        { keyName: 'probeFinishedAt', keyValue: REPORT.finishedAt },
      ],
    });
    expect(response).toMatchObject({
      auditCallId: 'call-1',
      byStatus: { resolved: 1, disabled_missing_binding: 1 },
      enablement: { served: true, generation: 2, reloadAuditCallId: 'call-reload' },
    });
    expect(response.next).toContain('1 of 2 tools resolved');
  });

  it('says the previous statuses still serve when the reload was refused, with its next', async () => {
    const w = world({
      reload: {
        served: false,
        generation: 1,
        auditCallId: 'call-reload',
        reloadNext: 'Nothing changed: catalogue generation 1 is still serving. Bump version.',
      },
    });
    const response = await runPortalProbe(w.deps, w.actor);
    expect(response.enablement).toEqual({
      served: false,
      generation: 1,
      reloadAuditCallId: 'call-reload',
    });
    expect(response.next).toContain('generation 1 still serves the previous statuses');
    expect(response.next).toContain('Bump version.');
  });

  it('a probe that cannot be set up is refused with its own next, audited, and writes nothing', async () => {
    const w = world({
      outcome: {
        ok: false,
        code: 'PROBE_TARGET_UNCONFIGURED',
        message: '11 function tool(s) need an AIS target.',
        next: 'Create overlays/local/ais-targets.yaml.',
      },
    });
    const refused = await runPortalProbe(w.deps, w.actor).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ApiRefusal);
    expect(refused).toMatchObject({
      code: 'PROBE_TARGET_UNCONFIGURED',
      next: 'Create overlays/local/ais-targets.yaml.',
    });
    expect(w.events).toEqual(['run', 'audit:business_error']);
    expect(w.appended[0]).toMatchObject({ deniedByRule: 'probe.unconfigured' });
  });

  it('a probe that throws is audited as a binding error and writes nothing', async () => {
    const w = world({ outcome: new Error('socket hang up') });
    await expect(runPortalProbe(w.deps, w.actor)).rejects.toThrow('socket hang up');
    expect(w.events).toEqual(['run', 'audit:binding_error']);
  });

  for (const environmentClass of ['probe', 'staging', 'prod'] as const) {
    it(`refuses a ${environmentClass} deployment before anything runs, naming the CLI`, async () => {
      const w = world({ environmentClass });
      const refused = await runPortalProbe(w.deps, w.actor).catch((e: unknown) => e);
      expect(refused).toMatchObject({ code: PROBE_ENVIRONMENT_REFUSED });
      expect((refused as ApiRefusal).next).toContain(
        `forge probe --env ${environmentClass} --deployment local`,
      );
      expect(w.events).toEqual(['audit:policy_denied']);
    });
  }
});

describe('parseEnvironmentClass — W0-P33d', () => {
  it('is local when MCPFORGE_ENV is unset or empty, the class when it is one, and refuses anything else', () => {
    expect(parseEnvironmentClass({})).toBe('local');
    expect(parseEnvironmentClass({ MCPFORGE_ENV: '' })).toBe('local');
    for (const c of ['local', 'probe', 'staging', 'prod'] as const) {
      expect(parseEnvironmentClass({ MCPFORGE_ENV: c })).toBe(c);
    }
    expect(() => parseEnvironmentClass({ MCPFORGE_ENV: 'dev' })).toThrow(/MCPFORGE_ENV "dev"/);
    expect(() => parseEnvironmentClass({ MCPFORGE_ENV: 'production' })).toThrow();
  });
});
