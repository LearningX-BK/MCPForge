// [P5] 02 §11.4.3 — the gateway grant and the database grant, reconciled.
// FIXTURE-ONLY at Wave 0: no plsql manifest and no live database exist. Every
// assertion here is against a fixture grant source, and the report says so.

import { describe, expect, it } from 'vitest';
import { reconcileBindingGrants, reconciliationDetail } from './binding-grants.js';
import { fixtureDatabaseGrantSource } from '../testing/index.js';
import { runProbe } from '../run/runner.js';
import { validateProbeReport } from '../report/schema.js';
import type { ProbeTarget } from '../target.js';

const TARGET: ProbeTarget = { id: 'local', environmentClass: 'local', deploymentId: 'dep-1' };
const NOW = (): Date => new Date('2026-09-04T09:00:00.000Z');

const gateway = [{ bindingType: 'plsql', names: ['MCPFORGE_WRAP.AP_VOUCHER'] }];

describe('bindingGrantReconciliation', () => {
  it('reconciles when both sides name the same wrapper packages', () => {
    const r = reconcileBindingGrants(
      'ebs.ap.voucher.create',
      gateway,
      fixtureDatabaseGrantSource(
        new Map([['ebs.ap.voucher.create', ['MCPFORGE_WRAP.AP_VOUCHER']]]),
      ),
    );
    expect(r.reconciled).toBe(true);
    expect(r.evidence).toBe('fixture');
    expect(r.gatewayOnly).toEqual([]);
    expect(r.databaseOnly).toEqual([]);
  });

  it('reports a gateway grant the database does not hold', () => {
    const r = reconcileBindingGrants(
      'ebs.ap.voucher.create',
      gateway,
      fixtureDatabaseGrantSource(new Map([['ebs.ap.voucher.create', []]])),
    );
    expect(r.reconciled).toBe(false);
    expect(r.gatewayOnly).toEqual(['MCPFORGE_WRAP.AP_VOUCHER']);
    expect(reconciliationDetail(r)).toContain('gateway grants the database does not');
  });

  it('reports a database EXECUTE grant the gateway does not hold — the finding is symmetric', () => {
    const r = reconcileBindingGrants(
      'ebs.ap.voucher.create',
      [],
      fixtureDatabaseGrantSource(new Map([['ebs.ap.voucher.create', ['MCPFORGE_WRAP.ROGUE']]])),
    );
    expect(r.reconciled).toBe(false);
    expect(r.databaseOnly).toEqual(['MCPFORGE_WRAP.ROGUE']);
    expect(reconciliationDetail(r)).toContain('database EXECUTE grants the gateway does not');
  });

  it('an unavailable observation is a finding, never an assumed pass', () => {
    const r = reconcileBindingGrants('ebs.ap.voucher.create', gateway, null);
    expect(r.evidence).toBe('unavailable');
    expect(r.reconciled).toBe(false);
    expect(reconciliationDetail(r)).toContain('Wave 2');
  });

  it('ignores non-plsql grants when collecting the gateway side', () => {
    const r = reconcileBindingGrants(
      'ebs.ap.voucher.create',
      [
        { bindingType: 'function', names: ['JDE_AP_FAMILY'] },
        { bindingType: 'plsql', names: ['MCPFORGE_WRAP.AP_VOUCHER'] },
      ],
      fixtureDatabaseGrantSource(
        new Map([['ebs.ap.voucher.create', ['MCPFORGE_WRAP.AP_VOUCHER']]]),
      ),
    );
    expect(r.gatewayGrants).toEqual(['MCPFORGE_WRAP.AP_VOUCHER']);
    expect(r.reconciled).toBe(true);
  });
});

describe('the reconciliation block in the report', () => {
  it('rides on a plsql tool, drives its grant check, and validates', async () => {
    const report = await runProbe({
      target: TARGET,
      tools: [
        {
          toolId: 'ebs.ap.voucher.create',
          bindingType: 'plsql',
          write: true,
          ref: 'MCPFORGE_WRAP.AP_VOUCHER',
          refVersion: null,
          owningTeam: 'EBS Finance CoE',
          bindingGrants: gateway,
        },
      ],
      executors: new Map(),
      databaseGrants: fixtureDatabaseGrantSource(new Map([['ebs.ap.voucher.create', []]])),
      now: NOW,
    });
    const entry = report.tools[0]!;
    expect(entry.bindingGrantReconciliation).toBeDefined();
    expect(entry.bindingGrantReconciliation?.evidence).toBe('fixture');
    expect(entry.checks.find((c) => c.name === 'binding_grant_reconciliation')?.result).toBe(
      'fail',
    );
    expect(validateProbeReport(JSON.parse(JSON.stringify(report))).valid).toBe(true);
  });

  it('is absent for every non-plsql binding type — the schema forbids it there', async () => {
    const report = await runProbe({
      target: TARGET,
      tools: [
        {
          toolId: 'jde.ap.voucher.create',
          bindingType: 'function',
          write: true,
          ref: 'JDE_AP_VOUCHER_CREATE',
          refVersion: null,
          owningTeam: 'JDE Finance CoE',
          bindingGrants: gateway,
        },
      ],
      executors: new Map(),
      databaseGrants: fixtureDatabaseGrantSource(new Map()),
      now: NOW,
    });
    expect(report.tools[0]!.bindingGrantReconciliation).toBeUndefined();
    expect(validateProbeReport(JSON.parse(JSON.stringify(report))).valid).toBe(true);
  });
});
