// MCPForge — W0-J20 (reduced scope): the default `InsightsSource` (03 §5.3
// "Insights"). Named `fixtures.ts` for consistency with every other J-track
// page (`home/fixtures.ts` et al. are real loaders too, not invented data —
// see that file's header), not because anything here is fabricated.
//
// This runs the REAL `forge bench` rank-1 pipeline — `loadCatalogueIndex`,
// `loadAllIntents`, `buildTokenModel`, `runRank1`, `measureIntent`,
// `computeSa1`, `buildTtfcReport`, `buildVtcReport`, `buildDhReport`,
// `buildMtbReport`, `buildGates`, `buildSummary` — against the REAL
// `generated/index/catalogue-index.json` and the REAL `evals/**/intents.yaml`
// this repo already has, exactly as `governance`'s Roles tab runs the real
// `runTokenBudgetGate`/`compileRoleScope` rather than a stand-in.
//
// JUDGMENT CALL (CLAUDE.md §8): this module deliberately does NOT call
// `runBenchCommand` (`@mcpforge/cli/commands/bench`) directly, because that
// function's first step — `generateIntentsSkeletons` — WRITES a new
// `evals/<server>/intents.yaml` for any module server the catalogue names
// that does not already have one. A portal page rendering on a GET request
// must not have a file-writing side effect. So this composes the same
// pipeline `runBenchCommand` composes, minus that one write, from the exact
// same exported functions — never a re-implementation of the arithmetic.
//
// Reused verbatim from `@mcpforge/cli/commands/bench`, so this page and
// `forge bench --json` can never disagree about what a metric means.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatalogueIndex } from '@mcpforge/registry/index/server';
import {
  loadAllIntents,
  buildTokenModel,
  runRank1,
  measureIntent,
  computeSa1,
  buildTtfcReport,
  buildVtcReport,
  buildDhReport,
  buildMtbReport,
  buildGates,
  buildSummary,
  readBaseline,
  compareToBaseline,
  BASELINE_RELATIVE_PATH,
  type BenchIntent,
  type BenchServerReport,
  type BenchReport,
  type BenchBaseline,
} from '@mcpforge/cli/commands/bench';
import { runTokenBudgetGate } from '@mcpforge/codegen/budget/server';

import { resolveRepoRoot } from '../build/_lib/repo-root';
import type { InsightsSource } from './types';

const RANK1_NOTE =
  'rank-1 mode (02 §5.9): deterministic, no model in the loop. Computed live from this repo’s real catalogue index and evals/**/intents.yaml.';

export function loadInsightsSource(repoRoot: string = resolveRepoRoot()): InsightsSource {
  const index = loadCatalogueIndex(repoRoot);
  const evalsRoot = join(repoRoot, 'evals');
  const loaded = loadAllIntents(evalsRoot);
  const model = buildTokenModel(repoRoot);

  const measure = (intents: readonly BenchIntent[]) =>
    runRank1(index, intents).map((result) => measureIntent(index, model, result.intent, result));

  const servers: BenchServerReport[] = loaded.map(({ serverId, intents }) => {
    const ms = measure(intents);
    return {
      serverId,
      report: computeSa1(ms.map((m) => m.result)),
      ttfc: buildTtfcReport(model, ms),
      dh: buildDhReport(ms),
    };
  });

  const all = loaded.flatMap(({ intents }) => measure(intents));
  const overall = computeSa1(all.map((m) => m.result));
  const ttfc = buildTtfcReport(model, all);
  const vtc = buildVtcReport(model, ttfc);
  const dh = buildDhReport(all);
  const mtb = buildMtbReport(model);
  const gates = buildGates(ttfc, vtc, dh, mtb);
  const summary = buildSummary(overall, ttfc, vtc, dh, mtb);

  const report: BenchReport = {
    ok: true,
    mode: 'rank-1',
    generated: { created: [], skipped: [] },
    servers,
    overall,
    metrics: { sa1: overall, ttfc, vtc, dh, mtb },
    gates,
    summary,
    assumptions: [],
    note: RANK1_NOTE,
  };

  const baselinePath = join(repoRoot, BASELINE_RELATIVE_PATH);
  let baseline: BenchBaseline | null = null;
  if (existsSync(baselinePath)) {
    try {
      baseline = readBaseline(baselinePath);
    } catch {
      baseline = null;
    }
  }
  const comparison = baseline ? compareToBaseline(baseline, summary) : null;
  const budget = runTokenBudgetGate(repoRoot);

  return { report, baseline, comparison, budget };
}

/** Insights' default `InsightsSource` — same injectable-source seam every J-track page follows. */
export const fixtureInsightsSource: () => InsightsSource = () => loadInsightsSource();
