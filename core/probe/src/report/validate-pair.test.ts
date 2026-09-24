// MCPForge — W0-H2's probe half: "the probe reports validate-pair presence per
// write tool and a missing pair is visible in the enablement backlog with its
// owning team named." 02 §3.5, 01 §10.5 item 2.
//
// No live JDE instance exists here and the six `*_VALIDATE` orchestrations are
// specified but not authored, so every assertion below is made against the
// static fixture executor and the in-process fake AIS server.

import { describe, expect, it } from 'vitest';
import type { BindingType } from '@mcpforge/shared/manifest';
import { runProbe, type ProbeToolInput } from '../run/runner.js';
import { staticExecutor } from '../testing/index.js';
import { validateProbeReport } from './schema.js';
import { buildValidatePairReport, VALIDATE_SIBLING_CHECK } from './validate-pair.js';
import type { ProbeTarget } from '../target.js';
import type { ProbeCheckExecutor } from '../plan/types.js';

const LOCAL: ProbeTarget = { id: 'local', environmentClass: 'local', deploymentId: 'dep-1' };
const OWNER = 'JDE Finance CoE';
const NOW = (): Date => new Date('2026-09-07T09:00:00.000Z');

function writeTool(over: Partial<ProbeToolInput> = {}): ProbeToolInput {
  return {
    toolId: 'jde.ap.voucher.create',
    bindingType: 'function',
    write: true,
    ref: 'MCPFORGE_AP_VOUCHER_CREATE_EXECUTE',
    refVersion: null,
    owningTeam: OWNER,
    sensitivity: 'financial',
    ...over,
  };
}

/** Every `function` check passes except the one named. */
function functionExecutorWith(overrides: Record<string, 'pass' | 'fail'>): ProbeCheckExecutor {
  const outcomes = new Map<string, 'pass' | 'fail'>([
    ['auth_token_for_test_identity', 'pass'],
    ['whoami', 'pass'],
    [VALIDATE_SIBLING_CHECK, 'pass'],
    ['orchestration_version', 'pass'],
    ...Object.entries(overrides),
  ]);
  return staticExecutor({ bindingType: 'function' as BindingType, outcomes });
}

async function report(tools: readonly ProbeToolInput[], executor?: ProbeCheckExecutor) {
  return runProbe({
    target: LOCAL,
    tools,
    executors: executor ? new Map([['function' as BindingType, executor]]) : new Map(),
    now: NOW,
  });
}

describe('W0-H2 — validate-pair presence is reported per write tool', () => {
  it('reports the pair as PRESENT when the validate_sibling check passed', async () => {
    const r = await report([writeTool()], functionExecutorWith({}));
    const block = r.tools[0]?.validatePair;
    expect(block).toBeDefined();
    expect(block?.present).toBe(true);
    expect(block?.evidence).toBe('probe_check');
    expect(block?.expectedRef).toBe('MCPFORGE_AP_VOUCHER_CREATE_EXECUTE_VALIDATE');
    expect(block?.effectiveDryRunStrategy).toBe('validate-pair');
    expect(block?.humanApprovalForced).toBe(false);
    expect(block?.enablementAction).toBeNull();
    expect(validateProbeReport(r).valid).toBe(true);
  });

  it('reports a MISSING pair with the owning team named — the enablement backlog line', async () => {
    const r = await report([writeTool()], functionExecutorWith({ [VALIDATE_SIBLING_CHECK]: 'fail' }));
    const entry = r.tools[0];
    const block = entry?.validatePair;

    expect(block?.present).toBe(false);
    expect(block?.effectiveDryRunStrategy).toBe('precondition-read');
    expect(block?.humanApprovalForced).toBe(true); // sensitivity: financial
    expect(block?.enablementAction).toContain(OWNER);
    expect(block?.enablementAction).toContain('MCPFORGE_AP_VOUCHER_CREATE_EXECUTE_VALIDATE');
    // ...and the tool's own backlog entry names the owner too, as every status does.
    expect(entry?.owningTeam).toBe(OWNER);
    expect(entry?.remediation).toContain(OWNER);
    expect(validateProbeReport(r).valid).toBe(true);
  });

  it('does not force approval for a non-financial write, but still degrades', async () => {
    const r = await report(
      [writeTool({ sensitivity: 'internal' })],
      functionExecutorWith({ [VALIDATE_SIBLING_CHECK]: 'fail' }),
    );
    const block = r.tools[0]?.validatePair;
    expect(block?.present).toBe(false);
    expect(block?.effectiveDryRunStrategy).toBe('precondition-read');
    expect(block?.humanApprovalForced).toBe(false);
    expect(block?.enablementAction).toContain(OWNER);
  });

  it('treats a check that never ran as ABSENT, never as present', async () => {
    // No executor at all — the Wave 0 reality of `forge probe` with no live
    // target. The pair's existence is unknown, and unknown is not present.
    const r = await report([writeTool()]);
    const block = r.tools[0]?.validatePair;
    expect(block?.present).toBe(false);
    expect(block?.effectiveDryRunStrategy).toBe('precondition-read');
    expect(block?.humanApprovalForced).toBe(true);
    expect(validateProbeReport(r).valid).toBe(true);
  });

  it('names an UNASSIGNED owner rather than inventing one', async () => {
    const r = await report(
      [writeTool({ owningTeam: '' })],
      functionExecutorWith({ [VALIDATE_SIBLING_CHECK]: 'fail' }),
    );
    expect(r.tools[0]?.validatePair?.enablementAction).toContain('UNASSIGNED');
  });

  it('is absent on read tools and on every non-function binding type', async () => {
    const r = await report(
      [
        writeTool({ toolId: 'jde.ap.voucher.get', write: false }),
        writeTool({ toolId: 'ebs.gl.journal.create', bindingType: 'plsql' as BindingType }),
      ],
      functionExecutorWith({}),
    );
    for (const t of r.tools) expect(t.validatePair).toBeUndefined();
    expect(validateProbeReport(r).valid).toBe(true);
  });
});

describe('W0-H2 — the block itself', () => {
  it('never claims a ref it was not given', () => {
    const block = buildValidatePairReport({
      toolId: 'jde.ap.voucher.create',
      ref: '',
      sensitivity: 'financial',
      owningTeam: OWNER,
      checks: [],
    });
    expect(block.expectedRef).toBeNull();
    expect(block.present).toBe(false);
    expect(block.evidence).toBe('not_probed');
    expect(block.detail.trim().length).toBeGreaterThan(0);
  });

  it('does not read `not_applicable` as a presence claim', () => {
    const block = buildValidatePairReport({
      toolId: 'jde.ap.voucher.create',
      ref: 'X',
      sensitivity: 'financial',
      owningTeam: OWNER,
      checks: [{ name: VALIDATE_SIBLING_CHECK, result: 'not_applicable', detail: 'n/a' }],
    });
    expect(block.present).toBe(false);
    expect(block.humanApprovalForced).toBe(true);
  });
});
