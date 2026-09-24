// W0-G7 — the five metrics, the per-role/per-category breakdowns, the
// core-hit/core-miss TTFC split, the corrected VTC, and the baseline
// regression comparison. 02 §5.7, §5.9, §5.10.
//
// Everything here runs against the SYNTHETIC fixture catalogue (fixtures.ts,
// W0-G6) plus a synthetic token model, because `manifests/`, `roles/` and
// `evals/` are still empty in this repo — Track I has not run. No number in
// this file is presented as a measurement of a real Wave 0 tool.

import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BASELINE_RELATIVE_PATH,
  BASELINE_SCHEMA_VERSION,
  BaselineReadError,
  DH_MEDIAN_TARGET,
  DH_P95_TARGET,
  META_RESIDENT_BUDGET,
  SESSION_INIT_TOKENS,
  SUMMARY_DIRECTIONS,
  TTFC_COLD_BUDGET,
  TTFC_CORE_HIT_BUDGET,
  buildBaseline,
  buildDhReport,
  buildGates,
  buildMtbReport,
  buildSummary,
  buildTokenModel,
  buildTtfcReport,
  buildVtcReport,
  compareToBaseline,
  computeSa1,
  measureIntent,
  readBaseline,
  runBenchCommand,
  runIntent,
  summarize,
  type BenchIntent,
  type BenchReport,
  type BenchTokenModel,
  type IntentMeasurement,
} from '@mcpforge/cli/commands/bench';
import { META_TOOL_COUNT, VTC_DEFAULT, VTC_HARD_CAP } from '@mcpforge/gateway/meta';
import { SUMMARY_DIRECTIONS as CI_DIRECTIONS, BASELINE_RELATIVE_PATH as CI_BASELINE_PATH } from '@mcpforge/ci';
import { buildFixtureIndex } from './fixtures.js';

// A synthetic token model: two roles, one with a core set that contains the
// AP voucher tools, one deliberately absent from the model entirely so the
// "no Role manifest" path is exercised.
const MODEL: BenchTokenModel = {
  metaResidentTokens: 315,
  roles: {
    p2p: { coreTools: ['acme.ap.voucher.create', 'acme.ap.voucher.get'], coreSetTokens: 400 },
  },
  tools: {
    'acme.ap.voucher.create': { cardTokens: 54, residentTokens: 210, describeTokens: 480 },
    'acme.ap.voucher.get': { cardTokens: 48, residentTokens: 190, describeTokens: 420 },
    'acme.ap.voucher.search': { cardTokens: 50, residentTokens: 195, describeTokens: 430 },
    'acme.fin.journal.create': { cardTokens: 52, residentTokens: 205, describeTokens: 470 },
  },
};

function measure(intent: BenchIntent): IntentMeasurement {
  const index = buildFixtureIndex();
  return measureIntent(index, MODEL, intent, runIntent(index, intent));
}

const CORE_HIT: BenchIntent = {
  intent: 'Book the invoice we just got from ACME against PO 451',
  expect: 'acme.ap.voucher.create',
  category: 'direct',
  role: 'p2p',
};
const CORE_MISS: BenchIntent = {
  intent: 'Find the payables raised last week',
  expect: 'acme.ap.voucher.search',
  category: 'direct',
  role: 'p2p',
};
const COLD: BenchIntent = {
  intent: 'Post a general ledger journal',
  expect: 'acme.fin.journal.create',
  category: 'direct',
  role: 'r2r',
  cold: true,
};
const NEGATIVE: BenchIntent = {
  intent: 'What is the weather like today?',
  expect: 'none',
  category: 'negative',
  role: 'p2p',
};

describe('W0-G7 — TTFC follows 02 §5.7 Case A and Case B arithmetic', () => {
  it('a core-hit intent costs init + meta + the role core set, and nothing else (02 §5.7 Case A)', () => {
    const m = measure(CORE_HIT);
    expect(m.bucket).toBe('coreHit');
    expect(m.ttfc).toBe(SESSION_INIT_TOKENS + MODEL.metaResidentTokens + 400);
    expect(m.findTokens).toBe(0);
    expect(m.dh).toBe(1);
  });

  it('a core-miss intent adds exactly one forge.find round trip, measured from the real payload', () => {
    const m = measure(CORE_MISS);
    expect(m.bucket).toBe('coreMiss');
    expect(m.findTokens).toBeGreaterThan(0);
    expect(m.ttfc).toBe(SESSION_INIT_TOKENS + MODEL.metaResidentTokens + 400 + m.findTokens);
    expect(m.dh).toBe(2);
  });

  it('a cold intent charges no resident role set and adds find + describe (02 §5.7 Case B)', () => {
    const m = measure(COLD);
    expect(m.bucket).toBe('cold');
    expect(m.describeCharge).toBe('measured');
    expect(m.ttfc).toBe(SESSION_INIT_TOKENS + MODEL.metaResidentTokens + m.findTokens + 470);
    expect(m.dh).toBe(3);
  });

  it('a cold intent for a tool with no manifest charges the 600-token describe CEILING, never an invented number', () => {
    const index = buildFixtureIndex();
    const intent: BenchIntent = { ...COLD, expect: 'acme.ap.voucher.search' };
    const bare: BenchTokenModel = { metaResidentTokens: 315, roles: {}, tools: {} };
    const m = measureIntent(index, bare, intent, runIntent(index, intent));
    expect(m.describeCharge).toBe('budget-ceiling');
    expect(m.ttfc).toBe(SESSION_INIT_TOKENS + 315 + m.findTokens + 600);
  });

  it('a negative intent has no TTFC and no DH — its correct outcome is a refusal (judgment call g)', () => {
    const m = measure(NEGATIVE);
    expect(m.bucket).toBeNull();
    expect(m.ttfc).toBeNull();
    expect(m.dh).toBeNull();
  });

  it('reports core-hit and core-miss SEPARATELY, and the ≤2,000 gate binds only core-hit', () => {
    const ms = [CORE_HIT, CORE_MISS, COLD, NEGATIVE].map(measure);
    const ttfc = buildTtfcReport(MODEL, ms);
    expect(ttfc.coreHit.n).toBe(1);
    expect(ttfc.coreMiss.n).toBe(1);
    expect(ttfc.cold.n).toBe(1);
    expect(ttfc.excludedNoCorrectCall).toBe(1);

    const gates = buildGates(ttfc, buildVtcReport(MODEL, ttfc), buildDhReport(ms), buildMtbReport(MODEL));
    const coreHitGate = gates.find((g) => g.id === 'ttfc.core-hit')!;
    expect(coreHitGate.limit).toBe(TTFC_CORE_HIT_BUDGET);
    expect(coreHitGate.observed).toBe(ttfc.coreHit.max);
    expect(gates.find((g) => g.id === 'ttfc.cold')!.limit).toBe(TTFC_COLD_BUDGET);
    expect(gates.some((g) => g.id === 'ttfc.core-miss')).toBe(false);
  });

  it('reports TTFC PER ROLE — 02 §5.10\'s closing sentence — including roles with no Role manifest', () => {
    const ms = [CORE_HIT, CORE_MISS, COLD].map(measure);
    const ttfc = buildTtfcReport(MODEL, ms);
    expect(Object.keys(ttfc.byRole).sort()).toEqual(['p2p', 'r2r']);
    expect(ttfc.byRole['p2p']!.residentSetKnown).toBe(true);
    expect(ttfc.byRole['p2p']!.coreHit.n).toBe(1);
    expect(ttfc.byRole['r2r']!.residentSetKnown).toBe(false);
    expect(ttfc.byRole['r2r']!.residentTokens).toBe(0);
  });

  it('breaches the core-hit gate when a role core set is genuinely too expensive', () => {
    const fat: BenchTokenModel = {
      ...MODEL,
      roles: { p2p: { coreTools: ['acme.ap.voucher.create'], coreSetTokens: 5000 } },
    };
    const index = buildFixtureIndex();
    const m = measureIntent(index, fat, CORE_HIT, runIntent(index, CORE_HIT));
    const ttfc = buildTtfcReport(fat, [m]);
    const gates = buildGates(ttfc, buildVtcReport(fat, ttfc), buildDhReport([m]), buildMtbReport(fat));
    expect(gates.find((g) => g.id === 'ttfc.core-hit')!.ok).toBe(false);
  });
});

describe('failingIntents — Sa1Report carries real per-intent failure detail', () => {
  // `deriveNearMissIntents` (this same module) auto-derives exactly this
  // query for the `voucher` entity and asserts it resolves to `get` — reused
  // here (rather than a hand-picked string) so this test's ranker behaviour
  // is known-real, not guessed.
  const REAL_GET_QUERY = 'Show me that voucher again';

  it('a near-miss confusion names both the expected and the actually-returned tool', () => {
    const index = buildFixtureIndex();
    // `expect` is deliberately the WRONG sibling tool for this query — the
    // ranker genuinely returns `get` rank-1 for it (asserted below before
    // trusting the failure), so this is a real, deterministic near-miss
    // confusion, not a fabricated one.
    const nearMiss: BenchIntent = {
      intent: REAL_GET_QUERY,
      expect: 'acme.ap.voucher.search',
      category: 'near_miss',
      role: 'p2p',
    };
    const result = runIntent(index, nearMiss);
    expect(result.actual).toBe('acme.ap.voucher.get');
    expect(result.hit).toBe(false);

    const sa1 = computeSa1([result]);
    expect(sa1.failingIntents).toEqual([
      {
        intent: nearMiss.intent,
        category: 'near_miss',
        role: 'p2p',
        expect: 'acme.ap.voucher.search',
        actual: 'acme.ap.voucher.get',
      },
    ]);
  });

  it('a negative wrongly answered with a real tool shows that tool as `actual`', () => {
    const index = buildFixtureIndex();
    const wronglyAnswered: BenchIntent = {
      intent: REAL_GET_QUERY,
      expect: 'none',
      category: 'negative',
      role: 'p2p',
    };
    const result = runIntent(index, wronglyAnswered);
    expect(result.actual).toBe('acme.ap.voucher.get');
    expect(result.hit).toBe(false);

    const sa1 = computeSa1([result]);
    expect(sa1.failingIntents).toHaveLength(1);
    expect(sa1.failingIntents[0]!.category).toBe('negative');
    expect(sa1.failingIntents[0]!.expect).toBe('none');
    expect(sa1.failingIntents[0]!.actual).toBe('acme.ap.voucher.get');
  });

  it('a hit produces no failingIntents entry, and existing aggregate fields are unchanged', () => {
    const hitIntent: BenchIntent = {
      intent: REAL_GET_QUERY,
      expect: 'acme.ap.voucher.get',
      category: 'direct',
      role: 'p2p',
    };
    const sa1 = computeSa1([runIntent(buildFixtureIndex(), hitIntent)]);
    expect(sa1.failingIntents).toEqual([]);
    expect(sa1.n).toBe(1);
    expect(sa1.hits).toBe(1);
    expect(sa1.sa1).toBe(1);
  });

  it('is reachable through the real BenchReport shape returned by `forge bench --json` (metrics.sa1, overall, and per-server)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forge-bench-failing-'));
    const evalsDir = join(root, 'evals');
    mkdirSync(join(evalsDir, 'acme-ap'), { recursive: true });
    const wronglyAnswered: BenchIntent = {
      intent: REAL_GET_QUERY,
      expect: 'none',
      category: 'negative',
      role: 'p2p',
    };
    writeFileSync(
      join(evalsDir, 'acme-ap', 'intents.yaml'),
      [
        `- intent: ${JSON.stringify(wronglyAnswered.intent)}`,
        `  expect: ${JSON.stringify(wronglyAnswered.expect)}`,
        `  category: ${wronglyAnswered.category}`,
        `  role: ${wronglyAnswered.role}`,
      ].join('\n'),
      'utf8',
    );
    const index = buildFixtureIndex();
    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => {
      chunks.push(s);
      return true;
    }) as typeof process.stdout.write;
    let code: number;
    try {
      code = await runBenchCommand(
        { json: true, root, evals: evalsDir },
        { loadIndex: () => index, tokenModel: () => MODEL },
      );
    } finally {
      process.stdout.write = write;
    }
    expect(code).toBe(0);
    const report = JSON.parse(chunks.join('').trim().split(/\r?\n/).at(-1)!) as BenchReport;
    rmSync(root, { recursive: true, force: true });

    expect(report.metrics.sa1.failingIntents).toHaveLength(1);
    expect(report.metrics.sa1.failingIntents[0]!.category).toBe('negative');
    expect(report.overall.failingIntents).toEqual(report.metrics.sa1.failingIntents);
    expect(report.servers[0]!.report.failingIntents).toEqual(report.metrics.sa1.failingIntents);
  });
});

describe('W0-G7 — VTC is measured against 02 §5.10\'s CORRECTED ≤16 default / 30 hard cap', () => {
  it('takes the numbers from the gateway module that owns them, not a second copy', () => {
    expect(VTC_DEFAULT).toBe(16);
    expect(VTC_HARD_CAP).toBe(30);
  });

  it('counts the four meta-tools inside VTC (02 §5.10: "4 meta + ≤12 role core")', () => {
    const ttfc = buildTtfcReport(MODEL, [measure(CORE_HIT)]);
    expect(buildVtcReport(MODEL, ttfc).byRole['p2p']).toBe(META_TOOL_COUNT + 2);
  });

  it('flags a role over the ≤16 default and, separately, one over the 30 hard cap', () => {
    const wide = (n: number): BenchTokenModel => ({
      ...MODEL,
      roles: { p2p: { coreTools: Array.from({ length: n }, (_, i) => `t${i}`), coreSetTokens: 100 } },
    });
    const over = wide(20);
    const overTtfc = buildTtfcReport(over, []);
    const overVtc = buildVtcReport(over, overTtfc);
    expect(overVtc.rolesOverDefault).toEqual(['p2p']);
    expect(overVtc.rolesOverHardCap).toEqual([]);
    const gates = buildGates(overTtfc, overVtc, buildDhReport([]), buildMtbReport(over));
    expect(gates.find((g) => g.id === 'vtc.default-target')!.ok).toBe(false);
    expect(gates.find((g) => g.id === 'vtc.hard-cap')!.ok).toBe(true);

    const huge = wide(40);
    const hugeVtc = buildVtcReport(huge, buildTtfcReport(huge, []));
    expect(hugeVtc.rolesOverHardCap).toEqual(['p2p']);
  });

  it('covers a role that has a manifest but no intents authored for it yet', () => {
    const model: BenchTokenModel = {
      ...MODEL,
      roles: { ...MODEL.roles, o2c: { coreTools: ['a', 'b', 'c'], coreSetTokens: 300 } },
    };
    const vtc = buildVtcReport(model, buildTtfcReport(model, [measure(CORE_HIT)]));
    expect(vtc.byRole['o2c']).toBe(META_TOOL_COUNT + 3);
  });
});

describe('W0-G7 — DH and MTB', () => {
  it('DH is 1 for a core hit, 2 for a core miss, 3 for a cold session, and meets 02 §5.7\'s targets', () => {
    const ms = [CORE_HIT, CORE_MISS, COLD, NEGATIVE].map(measure);
    const dh = buildDhReport(ms);
    expect(dh.n).toBe(3);
    expect(dh.median).toBeLessThanOrEqual(DH_MEDIAN_TARGET);
    expect(dh.p95).toBeLessThanOrEqual(DH_P95_TARGET);
    expect(dh.byRole['p2p']!.n).toBe(2);
    expect(dh.byCategory.negative.n).toBe(0);
  });

  it('MTB re-reports W0-G5\'s measurements against the same ceilings, and the meta-tools against ~440', () => {
    const mtb = buildMtbReport(MODEL);
    expect(mtb.maxCardTokens).toBe(54);
    expect(mtb.maxResidentTokens).toBe(210);
    expect(mtb.maxDescribeTokens).toBe(480);
    expect(mtb.maxRoleCoreSetTokens).toBe(400);
    expect(mtb.limits).toEqual({ card: 60, resident: 400, describe: 600, roleCoreSet: 1300, metaResident: 440 });
  });

  it('the real four meta-tools measure at or under 440 with the pinned counter (02 §5.2)', () => {
    const model = buildTokenModel(mkdtempSync(join(tmpdir(), 'forge-bench-empty-')));
    expect(model.metaResidentTokens).toBeLessThanOrEqual(META_RESIDENT_BUDGET);
    expect(model.metaResidentTokens).toBeGreaterThan(0);
  });

  it('breaches an MTB gate when a tool is over its ceiling', () => {
    const bad: BenchTokenModel = {
      ...MODEL,
      tools: { 'x.y.z.get': { cardTokens: 90, residentTokens: 210, describeTokens: 480 } },
    };
    const ttfc = buildTtfcReport(bad, []);
    const gates = buildGates(ttfc, buildVtcReport(bad, ttfc), buildDhReport([]), buildMtbReport(bad));
    expect(gates.find((g) => g.id === 'mtb.card')!.ok).toBe(false);
  });
});

describe('W0-G7 — summarize', () => {
  it('is nearest-rank: the p95 of a small suite is one of its own values', () => {
    const s = summarize([10, 20, 30, 40]);
    expect(s).toEqual({ n: 4, max: 40, mean: 25, median: 20, p95: 40 });
  });

  it('an empty sample is all null, never NaN', () => {
    expect(summarize([])).toEqual({ n: 0, max: null, mean: null, median: null, p95: null });
  });
});

describe('W0-G7 — the baseline and the regression comparison', () => {
  const baselineOf = (summary: Record<string, number>) => ({
    schemaVersion: BASELINE_SCHEMA_VERSION,
    recorded: '2026-09-04',
    coverage: { toolsInCatalogue: 4, intents: 4, servers: 2, rolesWithManifest: 1 },
    summary,
    notes: [],
  });

  const current = (): Record<string, number> => {
    const ms = [CORE_HIT, CORE_MISS, COLD, NEGATIVE].map(measure);
    const ttfc = buildTtfcReport(MODEL, ms);
    return buildSummary(
      computeSa1(ms.map((m) => m.result)),
      ttfc,
      buildVtcReport(MODEL, ttfc),
      buildDhReport(ms),
      buildMtbReport(MODEL),
    ) as Record<string, number>;
  };

  it('every summary key has a declared direction — no key may be compared by guess', () => {
    for (const key of Object.keys(current())) {
      expect(SUMMARY_DIRECTIONS[key], `no direction declared for ${key}`).toBeDefined();
    }
  });

  it('`forge ci` stage 10 mirrors the CLI\'s directions and baseline path exactly (JSON process boundary)', () => {
    expect(CI_DIRECTIONS).toEqual(SUMMARY_DIRECTIONS);
    expect(CI_BASELINE_PATH).toBe(BASELINE_RELATIVE_PATH);
  });

  it('an identical run is not a regression', () => {
    const now = current();
    expect(compareToBaseline(baselineOf(now), now).ok).toBe(true);
  });

  it('a drop in SA@1 is a regression (higher is better)', () => {
    const now = current();
    const cmp = compareToBaseline(baselineOf({ ...now, 'sa1.overall': now['sa1.overall']! + 0.25 }), now);
    expect(cmp.ok).toBe(false);
    expect(cmp.regressions.map((r) => r.metric)).toEqual(['sa1.overall']);
  });

  it('a rise in any token or hop metric is a regression (lower is better)', () => {
    const now = current();
    for (const metric of ['ttfc.core-hit.max', 'ttfc.cold.max', 'vtc.max', 'dh.p95', 'mtb.describe.max']) {
      const cmp = compareToBaseline(baselineOf({ ...now, [metric]: now[metric]! - 1 }), now);
      expect(cmp.ok, `${metric} rise should regress`).toBe(false);
      expect(cmp.regressions.map((r) => r.metric)).toEqual([metric]);
    }
  });

  it('an IMPROVEMENT is never a failure — the baseline is re-recorded deliberately', () => {
    const now = current();
    const better = { ...now, 'ttfc.cold.max': now['ttfc.cold.max']! - 100, 'sa1.overall': 1 };
    expect(compareToBaseline(baselineOf(now), better).ok).toBe(true);
  });

  it('a baselined metric missing from the run is a failure, not a silent skip', () => {
    const now = current();
    const cmp = compareToBaseline(baselineOf({ ...now, 'some.retired.metric': 1 }), now);
    expect(cmp.ok).toBe(false);
    expect(cmp.missingFromCurrent).toEqual(['some.retired.metric']);
  });

  it('rejects a baseline with the wrong schema version or a non-numeric metric', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-baseline-'));
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ schemaVersion: 99, summary: {} }), 'utf8');
    expect(() => readBaseline(bad)).toThrow(BaselineReadError);
    writeFileSync(bad, JSON.stringify({ schemaVersion: 1, summary: { a: 'x' } }), 'utf8');
    expect(() => readBaseline(bad)).toThrow(BaselineReadError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('marks a baseline recorded over an empty catalogue as PROVISIONAL, in words', () => {
    const ms: IntentMeasurement[] = [];
    const ttfc = buildTtfcReport(MODEL, ms);
    const report = {
      overall: computeSa1([]),
      servers: [],
      summary: buildSummary(computeSa1([]), ttfc, buildVtcReport(MODEL, ttfc), buildDhReport(ms), buildMtbReport(MODEL)),
      assumptions: [],
    } as unknown as BenchReport;
    const baseline = buildBaseline(report, { tools: [] } as never, { ...MODEL, roles: {} }, '2026-09-04', []);
    expect(baseline.notes.join(' ')).toContain('PROVISIONAL');
    expect(baseline.notes.join(' ')).toContain('TRACK I');
  });
});

describe('W0-G7 — `forge bench --json` emits all five metrics', () => {
  let root: string;
  let evalsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'forge-bench-g7-'));
    evalsDir = join(root, 'evals');
    mkdirSync(join(evalsDir, 'acme-ap'), { recursive: true });
    writeFileSync(
      join(evalsDir, 'acme-ap', 'intents.yaml'),
      [CORE_HIT, CORE_MISS, COLD, NEGATIVE]
        .map((i) =>
          [
            `- intent: ${JSON.stringify(i.intent)}`,
            `  expect: ${JSON.stringify(i.expect)}`,
            `  category: ${i.category}`,
            `  role: ${i.role}`,
            ...(i.cold === undefined ? [] : [`  cold: ${i.cold}`]),
          ].join('\n'),
        )
        .join('\n'),
      'utf8',
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function runJson(extra: Record<string, unknown> = {}): Promise<BenchReport> {
    const index = buildFixtureIndex();
    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => {
      chunks.push(s);
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await runBenchCommand(
        { json: true, root, evals: evalsDir, ...extra },
        { loadIndex: () => index, tokenModel: () => MODEL },
      );
      expect(code).toBe(0);
    } finally {
      process.stdout.write = write;
    }
    return JSON.parse(chunks.join('').trim().split(/\r?\n/).at(-1)!) as BenchReport;
  }

  it('emits TTFC, VTC, DH, SA@1 and MTB with per-category and per-role breakdowns', async () => {
    const report = await runJson();
    expect(Object.keys(report.metrics).sort()).toEqual(['dh', 'mtb', 'sa1', 'ttfc', 'vtc']);
    expect(report.metrics.ttfc.coreHit.n).toBe(1);
    expect(report.metrics.ttfc.coreMiss.n).toBe(1);
    expect(report.metrics.ttfc.cold.n).toBe(1);
    expect(Object.keys(report.metrics.ttfc.byRole).sort()).toEqual(['p2p', 'r2r']);
    expect(Object.keys(report.metrics.ttfc.byCategory).sort()).toEqual([
      'direct',
      'near_miss',
      'negative',
      'sod_negative',
    ]);
    expect(report.metrics.vtc.hardCap).toBe(30);
    expect(report.metrics.vtc.default).toBe(16);
    expect(report.metrics.dh.byRole['p2p']).toBeDefined();
    expect(report.metrics.mtb.limits.roleCoreSet).toBe(1300);
    expect(report.gates.length).toBeGreaterThan(0);
    for (const gate of report.gates) expect(gate.source).toMatch(/02 §5\./);
    expect(report.assumptions.some((a) => a.includes(`${SESSION_INIT_TOKENS}`))).toBe(true);
    // Per-server breakdowns carry their own TTFC/DH, not just SA@1.
    expect(report.servers[0]!.ttfc.coreHit.n).toBe(1);
  });

  it('is deterministic — two runs produce an identical summary', async () => {
    const a = await runJson();
    const b = await runJson();
    expect(b.summary).toEqual(a.summary);
  });

  it('--record-baseline writes a baseline that compares clean against the same run', async () => {
    const baselinePath = join(root, 'baseline.json');
    await runJson({ recordBaseline: true, baseline: baselinePath });
    const written = readBaseline(baselinePath);
    expect(written.schemaVersion).toBe(BASELINE_SCHEMA_VERSION);
    const again = await runJson();
    expect(compareToBaseline(written, again.summary).ok).toBe(true);
  });

  it('--record-baseline is refused when CI=true', async () => {
    const before = process.env['CI'];
    process.env['CI'] = 'true';
    try {
      const index = buildFixtureIndex();
      const code = await runBenchCommand(
        { json: true, root, evals: evalsDir, recordBaseline: true, baseline: join(root, 'never.json') },
        { loadIndex: () => index, tokenModel: () => MODEL },
      );
      expect(code).toBe(1);
    } finally {
      if (before === undefined) delete process.env['CI'];
      else process.env['CI'] = before;
    }
  });
});

describe('W0-G7 — the committed Wave 0 baseline', () => {
  it('exists, parses, and is honest about what it actually covers', () => {
    const repoRoot = join(__dirname, '..', '..');
    const baseline = readBaseline(join(repoRoot, 'evals', 'baseline.json'));
    expect(baseline.schemaVersion).toBe(BASELINE_SCHEMA_VERSION);
    // If it was recorded over an empty catalogue it MUST say so — a zero that
    // reads as a measurement is exactly the fabrication CLAUDE.md §8 forbids.
    if (baseline.coverage.toolsInCatalogue === 0 || baseline.coverage.intents === 0) {
      expect(baseline.notes.join(' ')).toContain('PROVISIONAL');
    }
    // The one thing that is always a real measurement: the four meta-tools.
    expect(baseline.summary['mtb.meta-resident']).toBeGreaterThan(0);
    expect(baseline.summary['mtb.meta-resident']).toBeLessThanOrEqual(META_RESIDENT_BUDGET);
    expect(JSON.parse(readFileSync(join(repoRoot, 'evals', 'baseline.json'), 'utf8'))).toEqual(baseline);
  });
});
