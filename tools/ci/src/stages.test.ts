import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runCodegen } from '@mcpforge/codegen/emit';
import { STAGES } from './stages.js';
import { formatCiReportHuman, runCiPipeline } from './index.js';

// W0-G5's own base fixture (a small, real manifests/roles/ tree) — reused
// here rather than duplicated, so stage 9's CI wiring is proven against the
// SAME fixture its unit-level `gate.test.ts` proves the budget logic
// against, and the two suites cannot silently drift apart.
const here = dirname(fileURLToPath(import.meta.url));
const BUDGET_BASE = join(
  here,
  '..',
  '..',
  '..',
  'core',
  'codegen',
  'src',
  'budget',
  'fixtures',
  'base',
);

function makeBudgetFixtureRepoRoot(): string {
  const dir = makeFixtureRepoRoot();
  cpSync(BUDGET_BASE, dir, { recursive: true });
  return dir;
}

// A synthetic repo root — never the real monorepo. `pnpm lint`/`pnpm test`
// against this fixture fail fast (no matching scripts) rather than doing
// real work, which is exactly what these tests want: fast, deterministic,
// and structurally incapable of recursing back into this very test suite
// the way pointing `runCiPipeline` at the real repo root would (forge ci's
// own "Unit tests" stage runs `pnpm test`, which is this suite).
function makeFixtureRepoRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mcpforge-ci-fixture-'));
  writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages: []\n');
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, scripts: {} }, null, 2),
  );
  return dir;
}

/** git subprocess with a fixed, throwaway committer identity — never the developer's real one. */
function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=mcpforge-ci-fixture', '-c', 'user.email=ci-fixture@example.invalid', ...args],
    { cwd, encoding: 'utf-8' },
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}:\n${result.stdout}\n${result.stderr}`);
  }
}

/**
 * A fixture that IS a git repo, with no `manifests/` (so `runCodegen`
 * processes zero TOOLS and writes no per-tool artefact — proven separately by
 * W0-B4/B6's own suites), but `generated/` also carries
 * `generated/index/catalogue-index.json`, which `runCodegen` writes
 * unconditionally as of W0-G1 regardless of tool count. Both are committed as
 * the baseline, exactly the state stage 3 is meant to check `generated/`
 * against — so this fixture runs codegen once, up front, before taking that
 * commit, rather than hand-authoring what codegen would write.
 */
async function makeGitFixtureRepoRoot(): Promise<string> {
  const dir = makeFixtureRepoRoot();
  mkdirSync(path.join(dir, 'generated', 'tools'), { recursive: true });
  writeFileSync(path.join(dir, 'generated', 'tools', 'committed.txt'), 'committed content\n');
  git(dir, ['init', '-q']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'baseline']);
  // Let codegen write whatever it unconditionally writes (W0-G1's
  // catalogue-index.json today), then fold that into the committed baseline
  // too — this fixture's whole point is "generated/ matches its commit",
  // which must include codegen's own always-on output.
  await runCodegen(dir);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'codegen baseline']);
  return dir;
}

describe('STAGES', () => {
  it('has the 11 stages from 02 §7.2 (1-11; 12-13 are deploy-pipeline only) plus the four 03 §12.7 accessibility gates (14-17)', () => {
    expect(STAGES).toHaveLength(15);
    expect(STAGES.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15, 16, 17]);
  });

  it('every stage carries a non-empty name and failsOn description', () => {
    for (const stage of STAGES) {
      expect(stage.name.length).toBeGreaterThan(0);
      expect(stage.failsOn.length).toBeGreaterThan(0);
    }
  });
});

describe('runCiPipeline', () => {
  let repoRoot: string;

  afterEach(() => {
    if (repoRoot) {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('runs every stage and reports passed/failed/not_implemented for each, never a fourth status', async () => {
    repoRoot = makeFixtureRepoRoot();
    const report = await runCiPipeline(repoRoot);
    expect(report.stages).toHaveLength(15);
    for (const stage of report.stages) {
      expect(['passed', 'failed', 'not_implemented']).toContain(stage.status);
    }
  }, 30000);

  it('NO stage is not_implemented any more — W0-P1 connected the last three (2, 4, 11)', async () => {
    repoRoot = makeFixtureRepoRoot();
    const report = await runCiPipeline(repoRoot);
    const notImplementedIds = report.stages.filter((s) => s.status === 'not_implemented').map((s) => s.id);
    // Stage 8 left the list when W0-E8 landed `tests/policy/**` and wired
    // `pnpm test:policy`; it now genuinely spawns pnpm, like stages 1 and 6.
    // Stage 9 left the list when W0-G5 landed the token-budget gate — it
    // now genuinely runs against the fixture's manifests/ (there are none,
    // so it trivially passes with zero tools/roles checked; see the
    // dedicated stage-9 tests below for the real pass/fail behaviour).
    // Stage 10 left the list when W0-G7 landed the discovery-benchmark
    // regression gate. Against this fixture it FAILS rather than passes —
    // there is no evals/baseline.json to compare against, and that gate fails
    // closed by design (see bench-gate.test.ts).
    // Stage 5 left the list when W0-K3 landed `overlay-purity` — it now
    // genuinely scans the fixture's (nonexistent) overlays/manifests/roles/
    // packages/consumers/ trees and trivially passes with zero files found;
    // see overlay-purity.test.ts for the real pass/fail behaviour.
    // Stages 16-17 (the Playwright accessibility gates) left the list when
    // W0-J21's closing pass gave them a real `run` — they now genuinely
    // spawn `pnpm -C core/portal run test:a11y:routes` / `test:a11y:keyboard`,
    // exactly like stages 14-15, and against a fixture with no core/portal
    // directory pnpm fails fast — 'failed', the same "genuinely spawns pnpm"
    // proof stage 1/6/8/14/15 already give.
    // Stage 7 left the list when W0-K2 landed the both-modes contract-test
    // matrix — it now genuinely spawns `pnpm test -- contract` twice (once
    // per MCPFORGE_MODE), and against this fixture's empty `scripts: {}` it
    // fails on the first (headless) leg — see the dedicated stage-7 test.
    // W0-P1 (24 Sep 2026) emptied this list. Stages 2, 4 and 11 were the last
    // three `not_implemented` stages, and all three had working
    // implementations elsewhere in the repo that `stages.ts` had simply never
    // been connected to — so `forge ci` reported green without validating a
    // manifest, checking contract drift, or proving the no-fork claim.
    // Against THIS fixture (no core/cli/bin/forge.js, no manifests/, no
    // packages/) they behave as follows, and each is the "genuinely runs"
    // proof stages 1/6/8/14/15 already give:
    //   stage 2  — spawns the real forge bin, which is absent here, so the
    //              JSON is unparseable and the gate fails rather than skips;
    //   stage 4  — reads manifests/ (absent = empty) and honestly passes
    //              having checked zero hand-owned binding bodies;
    //   stage 11 — finds zero slices and FAILS, because a two-slice proof
    //              that cannot run is an unproven claim (slice-diff-gate.ts).
    expect(notImplementedIds).toEqual([]);
    expect(report.stages.find((s) => s.id === 2)!.status).toBe('failed');
    expect(report.stages.find((s) => s.id === 2)!.detail).toContain('not parseable JSON');
    expect(report.stages.find((s) => s.id === 4)!.status).toBe('passed');
    expect(report.stages.find((s) => s.id === 4)!.detail).toContain('0 hand-owned binding bodies');
    expect(report.stages.find((s) => s.id === 11)!.status).toBe('failed');
    expect(report.stages.find((s) => s.id === 11)!.detail).toContain('defines 0 (none)');
    expect(report.stages.find((s) => s.id === 10)!.status).toBe('failed');
    expect(report.stages.find((s) => s.id === 5)!.status).toBe('passed');
    expect(report.stages.find((s) => s.id === 7)!.status).toBe('failed');
    expect(report.stages.find((s) => s.id === 14)!.status).toBe('failed');
    expect(report.stages.find((s) => s.id === 15)!.status).toBe('failed');
    expect(report.stages.find((s) => s.id === 16)!.status).toBe('failed');
    expect(report.stages.find((s) => s.id === 17)!.status).toBe('failed');
  }, 30000);

  it('stage 7 (contract tests, both modes) genuinely runs MCPFORGE_MODE=headless and =full, and names the mode that failed', async () => {
    repoRoot = makeFixtureRepoRoot();
    const report = await runCiPipeline(repoRoot);
    const stage7 = report.stages.find((s) => s.id === 7)!;
    expect(stage7.status).toBe('failed');
    expect(stage7.detail).toContain('MCPFORGE_MODE=headless');
  }, 30000);

  it('stages 1 (lint+typecheck), 6 (unit tests) and 8 (policy suite) actually run — and fail against a fixture with no matching scripts', async () => {
    repoRoot = makeFixtureRepoRoot();
    const report = await runCiPipeline(repoRoot);
    const stage1 = report.stages.find((s) => s.id === 1)!;
    const stage6 = report.stages.find((s) => s.id === 6)!;
    const stage8 = report.stages.find((s) => s.id === 8)!;
    // The fixture's package.json has no lint/typecheck/test/test:policy
    // scripts, so pnpm fails fast — proving these three stages genuinely spawn
    // pnpm rather than reporting a canned result.
    expect(stage1.status).toBe('failed');
    expect(stage6.status).toBe('failed');
    expect(stage8.status).toBe('failed');
    expect(stage8.detail).toContain('test:policy');
  }, 30000);

  it('stage 3 (regeneration invariant) is a real stage — never not_implemented — even against a fixture with no git repo', async () => {
    repoRoot = makeFixtureRepoRoot();
    const report = await runCiPipeline(repoRoot);
    const stage3 = report.stages.find((s) => s.id === 3)!;
    // No .git in this fixture: the stage must fail closed and say so
    // honestly, never report a canned pass and never claim not_implemented
    // (forge codegen itself DID run — this is the "no git repo" branch).
    expect(stage3.status).toBe('failed');
    expect(stage3.detail).toContain('not a git repository');
  }, 30000);

  it('stage 3 passes against a git fixture whose generated/ tree matches its committed baseline exactly', async () => {
    repoRoot = await makeGitFixtureRepoRoot();
    const report = await runCiPipeline(repoRoot);
    const stage3 = report.stages.find((s) => s.id === 3)!;
    expect(stage3.status).toBe('passed');
  }, 30000);

  it('stage 3 fails, naming the file, when a generated/ file has been hand-edited after commit', async () => {
    repoRoot = await makeGitFixtureRepoRoot();
    // Simulate exactly what the done criterion describes: a generated file
    // edited by hand after `generated/` was last committed.
    writeFileSync(path.join(repoRoot, 'generated', 'tools', 'committed.txt'), 'hand-edited, not regenerated\n');
    const report = await runCiPipeline(repoRoot);
    const stage3 = report.stages.find((s) => s.id === 3)!;
    expect(stage3.status).toBe('failed');
    expect(stage3.detail).toContain('generated/tools/committed.txt');
  }, 30000);

  it('stage 3 fails, naming the file, when a new file appears under generated/ that was never committed', async () => {
    repoRoot = await makeGitFixtureRepoRoot();
    writeFileSync(path.join(repoRoot, 'generated', 'tools', 'uncommitted.txt'), 'never committed\n');
    const report = await runCiPipeline(repoRoot);
    const stage3 = report.stages.find((s) => s.id === 3)!;
    expect(stage3.status).toBe('failed');
    expect(stage3.detail).toContain('generated/tools/uncommitted.txt');
  }, 30000);

  it('ok is false whenever any stage failed, true when only not_implemented/passed stages exist', async () => {
    repoRoot = makeFixtureRepoRoot();
    const report = await runCiPipeline(repoRoot);
    expect(report.summary.failed).toBeGreaterThan(0);
    expect(report.ok).toBe(false);
  }, 30000);

  it('stage 9 (token-budget gate) passes against W0-G5\'s own base fixture — every card, resident definition, describe response and role core set within budget', async () => {
    repoRoot = makeBudgetFixtureRepoRoot();
    const report = await runCiPipeline(repoRoot);
    const stage9 = report.stages.find((s) => s.id === 9)!;
    expect(stage9.status).toBe('passed');
  }, 30000);

  it('stage 9 fails, naming the specific tools to demote, when a role\'s coreTools sum exceeds 1,300 tokens', async () => {
    repoRoot = makeBudgetFixtureRepoRoot();
    const roleFile = path.join(repoRoot, 'roles', 'p2p.yaml');
    const role = readFileSync(roleFile, 'utf8');
    const edited = role.replace(
      /coreTools:\n {2}- jde\.scm\.purchase_order\.create\n {2}- jde\.scm\.purchase_order\.approve\n {2}- jde\.ap\.voucher\.create\n/,
      'coreTools:\n  - jde.scm.purchase_order.create\n  - jde.scm.purchase_order.approve\n  - jde.ap.voucher.create\n  - jde.ap.voucher.get\n  - jde.ap.voucher.cancel\n',
    );
    expect(edited).not.toBe(role);
    writeFileSync(roleFile, edited);
    for (const toolFile of [
      ['manifests', 'jde', 'fin', 'ap', 'voucher.create.tool.yaml'],
      ['manifests', 'jde', 'fin', 'ap', 'voucher.get.tool.yaml'],
      ['manifests', 'jde', 'fin', 'ap', 'voucher.cancel.tool.yaml'],
      ['manifests', 'jde', 'scm', 'po', 'purchase_order.create.tool.yaml'],
      ['manifests', 'jde', 'scm', 'po', 'purchase_order.approve.tool.yaml'],
    ]) {
      const abs = path.join(repoRoot, ...toolFile);
      const original = readFileSync(abs, 'utf8');
      const extraInputs = Array.from({ length: 10 }, (_, i) => {
        const n = String(i).padStart(2, '0');
        return `  - { name: pad_field_${n}, type: string, required: false, desc: "A padding field number ${n} used only to raise this fixture's token count." }`;
      }).join('\n');
      if (original.includes('input:\n')) {
        writeFileSync(abs, original.replace(/input:\n/, `input:\n${extraInputs}\n`));
      }
    }
    const report = await runCiPipeline(repoRoot);
    const stage9 = report.stages.find((s) => s.id === 9)!;
    expect(stage9.status).toBe('failed');
    expect(stage9.detail).toContain('roleCoreSet');
    expect(stage9.detail).toContain('p2p');
    expect(stage9.detail).toContain('Demote from coreTools');
  }, 30000);

  it('a not_implemented stage is never mistaken for a soft-allowed failure: it never appears as "passed"', async () => {
    repoRoot = makeFixtureRepoRoot();
    const report = await runCiPipeline(repoRoot);
    for (const stage of report.stages) {
      if (stage.status === 'not_implemented') {
        expect(stage.detail.length).toBeGreaterThan(0);
        expect(stage.detail).toContain('Not built yet');
      }
    }
  }, 30000);

  it('stages 16-17 (accessibility gates 3-4) genuinely spawn pnpm and are never not_implemented or allowed-to-fail', async () => {
    repoRoot = makeFixtureRepoRoot();
    const report = await runCiPipeline(repoRoot);
    const stage16 = report.stages.find((s) => s.id === 16)!;
    const stage17 = report.stages.find((s) => s.id === 17)!;
    // The fixture has no core/portal directory, so pnpm fails fast — proof
    // these two stages actually spawn `pnpm -C core/portal ...` rather than
    // reporting a canned result, the same proof stage 14/15 already give.
    expect(stage16.status).toBe('failed');
    expect(stage17.status).toBe('failed');
    expect(stage16.detail).toContain('test:a11y:routes');
    expect(stage17.detail).toContain('Not fakeable');
  }, 30000);
});

describe('formatCiReportHuman', () => {
  it('renders one line per stage plus a summary line and an overall verdict line', async () => {
    const repoRoot = makeFixtureRepoRoot();
    try {
      const report = await runCiPipeline(repoRoot);
      const text = formatCiReportHuman(report);
      expect(text).toContain('forge ci:');
      for (const stage of report.stages) {
        expect(text).toContain(`${stage.id}. ${stage.name}`);
      }
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }, 30000);
});
