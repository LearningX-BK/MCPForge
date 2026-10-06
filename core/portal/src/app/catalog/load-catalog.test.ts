// MCPForge — W0-P3e: the Catalog is this repository's committed manifests,
// with runtime facets from /api/v1 and nothing invented in between.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/viewer/session', () => ({
  sessionIdFromCookies: () => Promise.resolve(undefined),
}));

import type { CallsPage, EnablementResponse } from '@mcpforge/shared/api/v1';
import type { ReadResult } from '@/lib/gateway-client/read-client';

import { resolveRepoRoot } from '../build/_lib/repo-root';
import {
  CONSUMPTION_PAGE_CAP,
  loadCatalogData,
  loadCatalogDefinitions,
  loadToolConsumption,
} from './load-catalog';

const ROOT = resolveRepoRoot();
const NOW = new Date('2026-09-30T12:00:00.000Z');

function enablement(
  tools: EnablementResponse['tools'],
): () => Promise<ReadResult<EnablementResponse>> {
  return () =>
    Promise.resolve({ kind: 'ok', data: { asOf: NOW.toISOString(), probe: null, tools } });
}

const tool = (toolId: string, status: string | null) => ({
  toolId,
  status,
  bindingType: 'function',
  failingCheck: null,
  remediation: null,
  owningTeam: null,
});

describe('loadCatalogDefinitions — git', () => {
  const defs = loadCatalogDefinitions(ROOT);

  it('lists exactly the committed tool manifests', () => {
    const ids = defs.tools.map((t) => t.manifest.id);
    expect(ids).toContain('jde.ap.voucher.create');
    expect(ids).toHaveLength(11);
  });

  it('gives each tool the git blob sha of its manifest file', () => {
    const expected = execFileSync(
      'git',
      ['hash-object', join('manifests', 'jde', 'fin', 'ap', 'voucher.create.tool.yaml')],
      { cwd: ROOT, encoding: 'utf8' },
    ).trim();
    const found = defs.tools.find((t) => t.manifest.id === 'jde.ap.voucher.create');
    expect(found?.manifestSha).toBe(expected);
  });

  it('takes packages, roles and the deployed package from the compiled artefacts and overlay', () => {
    expect(defs.tools.every((t) => t.packages.includes('jde-fin'))).toBe(true);
    const p2p = defs.roles.find((r) => r.id === 'p2p');
    expect(p2p?.toolIds).toContain('jde.ap.voucher.create');
    expect(defs.deployment.deployedPackageId).toBe('jde-fin');
    expect(defs.deployment.deploymentLabel).toContain('JD Edwards Financials');
  });

  it('asserts no probe identity: nothing serves it yet', () => {
    expect(defs.tools.every((t) => t.probeIdentity === null)).toBe(true);
  });
});

describe('loadCatalogData — git + /api/v1', () => {
  it('maps reported statuses, null to not_probed, and unreported tools to unknown', async () => {
    const data = await loadCatalogData({
      repoRoot: ROOT,
      enablement: enablement([
        tool('jde.ap.voucher.create', 'resolved'),
        tool('jde.ap.voucher.search', null),
      ]),
      draftStates: () => Promise.resolve(new Map([['jde.ap.voucher.get', 'in_review' as const]])),
    });
    const status = (id: string) => data.tools.find((t) => t.manifest.id === id)?.probeStatus;
    expect(status('jde.ap.voucher.create')).toBe('resolved');
    expect(status('jde.ap.voucher.search')).toBe('not_probed');
    expect(status('jde.fin.journal.create')).toBe('unknown');
    expect(data.runtimeNotice).toBeUndefined();
    const change = (id: string) => data.tools.find((t) => t.manifest.id === id)?.changeState;
    expect(change('jde.ap.voucher.get')).toBe('in_review');
    expect(change('jde.ap.voucher.create')).toBe('merged');
  });

  it('still renders from git when the gateway is down, with every status unknown and the reason', async () => {
    const data = await loadCatalogData({
      repoRoot: ROOT,
      enablement: () =>
        Promise.resolve({
          kind: 'gateway-down',
          endpoint: 'http://127.0.0.1:3939',
          next: 'Start the gateway.',
        }),
      draftStates: () => Promise.resolve(new Map()),
    });
    expect(data.tools).toHaveLength(11);
    expect(data.tools.every((t) => t.probeStatus === 'unknown')).toBe(true);
    expect(data.runtimeNotice?.kind).toBe('gateway-down');
  });
});

describe('loadToolConsumption — /api/v1/calls', () => {
  const call = (id: string, ts: string, consumerId: string): CallsPage['items'][number] => ({
    id,
    ts,
    callerSubject: 'local:x',
    callerDisplay: null,
    consumerId,
    toolId: 'jde.ap.voucher.create',
    verb: 'create',
    isWrite: true,
    phase: 'execute',
    outcome: 'ok',
    targetEnv: null,
    latencyMsTotal: null,
    resultKeys: [],
    reversesCallId: null,
    reversedByCallId: null,
    deploymentId: 'local',
  });

  function pages(...items: (readonly ReturnType<typeof call>[])[]) {
    let i = 0;
    return vi.fn((): Promise<ReadResult<CallsPage>> => {
      const page = items[i] ?? [];
      i += 1;
      return Promise.resolve({
        kind: 'ok',
        data: {
          asOf: NOW.toISOString(),
          items: [...page],
          nextCursor: i < items.length ? `c${i}` : null,
        },
      });
    });
  }

  it('counts the last 30 days by consumer, newest first, and stops at older calls', async () => {
    const calls = pages([
      call('c3', '2026-09-29T00:00:00.000Z', 'portal-local'),
      call('c2', '2026-09-20T00:00:00.000Z', 'test-agent'),
      call('c1', '2026-08-01T00:00:00.000Z', 'test-agent'),
    ]);
    const result = await loadToolConsumption('jde.ap.voucher.create', {
      calls: calls as never,
      now: () => NOW,
      repoRoot: ROOT,
    });
    expect(result).toMatchObject({
      kind: 'counted',
      last30dCalls: 2,
      lastCallAt: '2026-09-29T00:00:00.000Z',
    });
    if (result.kind !== 'counted') return;
    expect(result.consumers.map((c) => [c.id, c.calls30d])).toEqual([
      ['portal-local', 1],
      ['test-agent', 1],
    ]);
    expect(result.consumers.find((c) => c.id === 'portal-local')?.platform).toBe(
      'MCPForge Portal (local)',
    );
  });

  it('says "at least" when it reaches the page cap', async () => {
    const full = Array.from({ length: CONSUMPTION_PAGE_CAP + 1 }, (_, p) => [
      call(`c${p}`, '2026-09-29T00:00:00.000Z', 'portal-local'),
    ]);
    const result = await loadToolConsumption('jde.ap.voucher.create', {
      calls: pages(...full) as never,
      now: () => NOW,
      repoRoot: ROOT,
    });
    expect(result).toMatchObject({
      kind: 'counted',
      last30dCalls: CONSUMPTION_PAGE_CAP,
      atLeast: true,
    });
  });

  it('is unavailable, with the next, when the calls cannot be read', async () => {
    const result = await loadToolConsumption('jde.ap.voucher.create', {
      calls: (() => Promise.resolve({ kind: 'signed-out', next: 'Sign in.' })) as never,
      now: () => NOW,
      repoRoot: ROOT,
    });
    expect(result).toEqual({
      kind: 'unavailable',
      message: 'Sign in to see who has called this tool.',
      next: 'Sign in.',
    });
  });
});
