// MCPForge — W0-J20 (reduced scope): a hand-built `InsightsSource`, real
// `BenchReport`/`TokenBudgetGateResult` shape, field-for-field, for tests
// only. Never imported by `page.tsx` or `fixtures.ts`.
import type {
  BenchGate,
  BenchReport,
  InsightsSource,
  Stats,
  TokenBudgetGateResult,
} from '../types';

function stats(values: readonly number[]): Stats {
  if (values.length === 0) return { n: 0, max: null, mean: null, median: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    max: sorted[sorted.length - 1]!,
    mean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)]!,
    p95: sorted[sorted.length - 1]!,
  };
}

export function fixtureReport(): BenchReport {
  const gates: BenchGate[] = [
    { id: 'ttfc.core-hit', metric: 'TTFC', limit: 2000, observed: 1200, ok: true, source: '02 §5.7 Case A', detail: 'x' },
    { id: 'ttfc.cold', metric: 'TTFC', limit: 4000, observed: 2200, ok: true, source: '02 §5.7 Case B', detail: 'x' },
    { id: 'vtc.hard-cap', metric: 'VTC', limit: 30, observed: 14, ok: true, source: '02 §5.10', detail: 'x' },
    { id: 'vtc.default-target', metric: 'VTC', limit: 16, observed: 14, ok: true, source: '02 §5.10', detail: 'x' },
    { id: 'dh.median', metric: 'DH', limit: 2, observed: 1, ok: true, source: '02 §5.7', detail: 'x' },
    { id: 'dh.p95', metric: 'DH', limit: 3, observed: 2, ok: true, source: '02 §5.7', detail: 'x' },
    { id: 'mtb.card', metric: 'MTB', limit: 60, observed: 45, ok: true, source: '02 §5.3(a)', detail: 'x' },
    { id: 'mtb.resident', metric: 'MTB', limit: 400, observed: 320, ok: true, source: '02 §5.3(b)', detail: 'x' },
    { id: 'mtb.describe', metric: 'MTB', limit: 600, observed: 410, ok: true, source: '02 §5.3(c)', detail: 'x' },
    { id: 'mtb.role-core-set', metric: 'MTB', limit: 1300, observed: 900, ok: true, source: '02 §5.3(d)', detail: 'x' },
    { id: 'mtb.meta-resident', metric: 'MTB', limit: 440, observed: 315, ok: true, source: '02 §5.2', detail: 'x' },
  ];

  return {
    ok: true,
    mode: 'rank-1',
    generated: { created: [], skipped: [] },
    servers: [
      {
        serverId: 'jde-ap',
        report: { n: 10, hits: 9, sa1: 0.9, byCategory: { direct: { n: 6, hits: 6, sa1: 1 }, near_miss: { n: 2, hits: 1, sa1: 0.5 }, negative: { n: 1, hits: 1, sa1: 1 }, sod_negative: { n: 1, hits: 1, sa1: 1 } }, failingIntents: [{ intent: 'Show me that voucher again', category: 'near_miss', role: 'p2p', expect: 'jde.ap.voucher.get', actual: 'jde.ap.voucher.search' }] },
        ttfc: {
          coreHit: stats([1200]),
          coreMiss: stats([1600]),
          cold: stats([2200]),
          excludedNoCorrectCall: 2,
          byCategory: { direct: stats([1200]), near_miss: stats([1600]), negative: stats([]), sod_negative: stats([]) },
          byRole: {
            p2p: { coreHit: stats([1200]), coreMiss: stats([1600]), cold: stats([2200]), vtc: 14, vtcWithinDefault: true, vtcWithinHardCap: true, residentSetKnown: true, residentTokens: 900 },
          },
        },
        dh: { ...stats([1, 2]), byCategory: { direct: stats([1]), near_miss: stats([2]), negative: stats([]), sod_negative: stats([]) }, byRole: { p2p: stats([1, 2]) } },
      },
    ],
    overall: { n: 10, hits: 9, sa1: 0.9, byCategory: { direct: { n: 6, hits: 6, sa1: 1 }, near_miss: { n: 2, hits: 1, sa1: 0.5 }, negative: { n: 1, hits: 1, sa1: 1 }, sod_negative: { n: 1, hits: 1, sa1: 1 } }, failingIntents: [{ intent: 'Show me that voucher again', category: 'near_miss', role: 'p2p', expect: 'jde.ap.voucher.get', actual: 'jde.ap.voucher.search' }] },
    metrics: {
      sa1: { n: 10, hits: 9, sa1: 0.9, byCategory: { direct: { n: 6, hits: 6, sa1: 1 }, near_miss: { n: 2, hits: 1, sa1: 0.5 }, negative: { n: 1, hits: 1, sa1: 1 }, sod_negative: { n: 1, hits: 1, sa1: 1 } }, failingIntents: [{ intent: 'Show me that voucher again', category: 'near_miss', role: 'p2p', expect: 'jde.ap.voucher.get', actual: 'jde.ap.voucher.search' }] },
      ttfc: {
        coreHit: stats([1200]),
        coreMiss: stats([1600]),
        cold: stats([2200]),
        excludedNoCorrectCall: 2,
        byCategory: { direct: stats([1200]), near_miss: stats([1600]), negative: stats([]), sod_negative: stats([]) },
        byRole: {
          p2p: { coreHit: stats([1200]), coreMiss: stats([1600]), cold: stats([2200]), vtc: 14, vtcWithinDefault: true, vtcWithinHardCap: true, residentSetKnown: true, residentTokens: 900 },
          r2r: { coreHit: stats([]), coreMiss: stats([]), cold: stats([]), vtc: 4, vtcWithinDefault: true, vtcWithinHardCap: true, residentSetKnown: false, residentTokens: 0 },
        },
      },
      vtc: { default: 16, hardCap: 30, metaToolCount: 4, max: 14, byRole: { p2p: 14, r2r: 4 }, rolesOverDefault: [], rolesOverHardCap: [] },
      dh: { ...stats([1, 2]), byCategory: { direct: stats([1]), near_miss: stats([2]), negative: stats([]), sod_negative: stats([]) }, byRole: { p2p: stats([1, 2]), r2r: stats([]) } },
      mtb: {
        toolsMeasured: 3,
        rolesMeasured: 1,
        maxCardTokens: 45,
        maxResidentTokens: 320,
        maxDescribeTokens: 410,
        maxRoleCoreSetTokens: 900,
        metaResidentTokens: 315,
        limits: { card: 60, resident: 400, describe: 600, roleCoreSet: 1300, metaResident: 440 },
      },
    },
    gates,
    summary: {
      'sa1.overall': 0.9,
      'sa1.direct': 1,
      'sa1.near_miss': 0.5,
      'sa1.negative': 1,
      'sa1.sod_negative': 1,
      'ttfc.core-hit.max': 1200,
      'ttfc.core-miss.max': 1600,
      'ttfc.cold.max': 2200,
      'vtc.max': 14,
      'dh.median': 1,
      'dh.p95': 2,
      'mtb.card.max': 45,
      'mtb.resident.max': 320,
      'mtb.describe.max': 410,
      'mtb.role-core-set.max': 900,
      'mtb.meta-resident': 315,
    },
    assumptions: [],
    note: 'rank-1 mode (02 §5.9): deterministic, no model in the loop.',
  };
}

/** Same report, but a run with zero failing intents — the empty-state case for the failing-intents panel. */
export function fixtureReportNoFailingIntents(): BenchReport {
  const report = fixtureReport();
  return {
    ...report,
    overall: { ...report.overall, hits: report.overall.n, sa1: 1, failingIntents: [] },
    metrics: { ...report.metrics, sa1: { ...report.metrics.sa1, hits: report.metrics.sa1.n, sa1: 1, failingIntents: [] } },
  };
}

export function fixtureBudget(): TokenBudgetGateResult {
  return {
    ok: true,
    toolsChecked: 2,
    rolesChecked: 1,
    failures: [],
    tools: {
      'jde.ap.voucher.create': { cardTokens: 55, residentTokens: 390, describeTokens: 580 },
      'jde.ap.voucher.get': { cardTokens: 30, residentTokens: 120, describeTokens: 200 },
    },
    roles: {
      p2p: { coreTools: ['jde.ap.voucher.create', 'jde.ap.voucher.get'], coreSetTokens: 900 },
    },
  };
}

export function fixtureInsightsSourceFor(over: Partial<InsightsSource> = {}): InsightsSource {
  return {
    report: fixtureReport(),
    baseline: null,
    comparison: null,
    budget: fixtureBudget(),
    ...over,
  };
}
