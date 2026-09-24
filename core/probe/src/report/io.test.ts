// The artefact: schema validation on the way out, on the way in, and the
// bridge into the gateway's ProbeStatusSource.

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { staticProbeStatuses } from '@mcpforge/gateway/scope';
import { runProbe } from '../run/runner.js';
import {
  loadProbeReport,
  probeReportPath,
  probeStatusMap,
  writeProbeReport,
  ProbeReportLoadError,
} from './io.js';
import { ProbeReportInvalid, assertProbeReport, validateProbeReport } from './schema.js';
import type { ProbeTarget } from '../target.js';

const TARGET: ProbeTarget = { id: 'local', environmentClass: 'local', deploymentId: 'dep-1' };
const NOW = (): Date => new Date('2026-09-04T09:00:00.000Z');

const dirs: string[] = [];
function tempRoot(): string {
  const d = mkdtempSync(join(tmpdir(), 'mcpforge-probe-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function sampleReport() {
  return runProbe({
    target: TARGET,
    tools: [
      {
        toolId: 'jde.ap.voucher.create',
        bindingType: 'function',
        write: true,
        ref: 'JDE_AP_VOUCHER_CREATE',
        refVersion: null,
        owningTeam: 'JDE Finance CoE',
      },
    ],
    executors: new Map(),
    now: NOW,
  });
}

describe('probe-report.json', () => {
  it('is written under .mcpforge/ — it is an event, not a definition', async () => {
    const root = tempRoot();
    const path = writeProbeReport(root, await sampleReport());
    expect(path).toBe(probeReportPath(root));
    expect(path.replace(/\\/g, '/')).toContain('/.mcpforge/probe-report.json');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ kind: 'ProbeReport' });
  });

  it('round-trips through disk with schema validation on both sides', async () => {
    const root = tempRoot();
    const written = await sampleReport();
    writeProbeReport(root, written);
    const loaded = loadProbeReport(root);
    expect(loaded.tools.map((t) => t.toolId)).toEqual(written.tools.map((t) => t.toolId));
  });

  it('refuses to write an invalid report — it never reaches disk', async () => {
    const root = tempRoot();
    const bad = { ...(await sampleReport()), kind: 'NotAProbeReport' };
    expect(() => writeProbeReport(root, bad as never)).toThrow(ProbeReportInvalid);
    expect(() => loadProbeReport(root)).toThrow(ProbeReportLoadError);
  });

  it('refuses to load a report carrying a status outside the closed enum', async () => {
    const root = tempRoot();
    const report = await sampleReport();
    const tampered = {
      ...report,
      tools: [{ ...report.tools[0]!, status: 'probably_fine' }],
    };
    const path = probeReportPath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(tampered), 'utf8');
    expect(() => loadProbeReport(root)).toThrow(ProbeReportLoadError);
  });

  it('refuses a report whose check detail is empty — no bare pass/fail', async () => {
    const report = await sampleReport();
    const tampered = {
      ...report,
      tools: [{ ...report.tools[0]!, checks: [{ name: 'x', result: 'fail', detail: '' }] }],
    };
    expect(validateProbeReport(tampered).valid).toBe(false);
    expect(() => assertProbeReport(tampered)).toThrow(ProbeReportInvalid);
  });

  it('reports a missing artefact honestly rather than returning an empty report', () => {
    expect(() => loadProbeReport(tempRoot())).toThrow(/Run `forge probe` first/);
  });
});

describe('the ProbeStatusSource seam (W0-E2)', () => {
  it("satisfies core/gateway/scope's staticProbeStatuses without either package growing a parallel shape", async () => {
    const report = await sampleReport();
    const source = staticProbeStatuses(probeStatusMap(report));
    expect(source.statusFor('jde.ap.voucher.create')).toBe(report.tools[0]!.status);
    // A tool absent from the report has no status — fail-closed, as documented.
    expect(source.statusFor('jde.gl.journal.get')).toBeNull();
  });
});
