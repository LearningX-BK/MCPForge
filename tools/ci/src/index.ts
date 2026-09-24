import { findRepoRoot } from './repo-root.js';
import { STAGES, type StageStatus } from './stages.js';

export { findRepoRoot } from './repo-root.js';
export { runPnpmScript, tail } from './run-pnpm-script.js';
export { STAGES, type StageDefinition, type StageOutcome, type StageStatus } from './stages.js';
export {
  runOverlayPurityCheck,
  checkOverlayFileTypes,
  checkForLeakedSecrets,
  formatOverlayPurityReport,
  type OverlayPurityReport,
  type OverlayPurityViolation,
} from './overlay-purity.js';
export {
  runBenchRegressionGate,
  evaluateBenchGate,
  formatVerdict,
  BASELINE_RELATIVE_PATH,
  SUMMARY_DIRECTIONS,
  type BenchGateVerdict,
  type BenchJsonReport,
  type BaselineJson,
  type BenchRunner,
} from './bench-gate.js';

export interface CiStageReport {
  readonly id: number;
  readonly name: string;
  readonly failsOn: string;
  readonly status: StageStatus;
  readonly detail: string;
}

export interface CiReport {
  readonly ok: boolean;
  readonly stages: readonly CiStageReport[];
  readonly summary: { readonly passed: number; readonly failed: number; readonly notImplemented: number };
}

/** Run every stage, in order, unconditionally — no stopping at the first failure, so one run gives the full picture. */
export async function runCiPipeline(repoRoot: string = findRepoRoot()): Promise<CiReport> {
  const stages: CiStageReport[] = [];
  for (const stage of STAGES) {
    const outcome = await stage.run(repoRoot);
    stages.push({ id: stage.id, name: stage.name, failsOn: stage.failsOn, ...outcome });
  }

  const summary = {
    passed: stages.filter((s) => s.status === 'passed').length,
    failed: stages.filter((s) => s.status === 'failed').length,
    notImplemented: stages.filter((s) => s.status === 'not_implemented').length,
  };

  // Only a stage that actually ran and actually failed may fail the build —
  // a stage that has not been built yet is not "allowed to fail" (that
  // phrase describes a gate that ran and was told to ignore its result);
  // it simply has not run.
  return { ok: summary.failed === 0, stages, summary };
}

export function formatCiReportHuman(report: CiReport): string {
  const lines: string[] = [];
  for (const stage of report.stages) {
    const marker = stage.status === 'passed' ? 'PASS' : stage.status === 'failed' ? 'FAIL' : 'SKIP';
    lines.push(`[${marker}] ${stage.id}. ${stage.name}`);
    if (stage.status !== 'passed') {
      lines.push(`       ${stage.detail.split('\n').join('\n       ')}`);
    }
  }
  lines.push('');
  lines.push(
    `${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.notImplemented} not yet implemented.`,
  );
  lines.push(report.ok ? 'forge ci: OK — no implemented stage failed.' : 'forge ci: FAILED.');
  return lines.join('\n');
}
