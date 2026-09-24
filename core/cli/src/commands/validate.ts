import { findRepoRoot } from '@mcpforge/ci';
import { validateRepo, type ValidationReport } from '@mcpforge/codegen/validate';

/** Human-readable rendering: one line per failure, naming rule id, file, path and fix. */
export function formatValidationReportHuman(report: ValidationReport): string {
  const render = (f: ValidationReport['failures'][number]): string =>
    `[${f.ruleId}] ${f.file}${f.path}\n  ${f.message}\n  fix: ${f.fix}`;

  // W0-B8: warnings are REPORTED even on a passing run. 02 §4.3's declared
  // segregation-of-duties conflict produces "a build warning"; a warning that
  // is computed and then never printed is not a warning.
  const warningBlock =
    report.warnings.length === 0
      ? []
      : [
          `forge validate: ${report.warnings.length} warning(s) — reported, not failing.`,
          ...report.warnings.map(render),
        ];

  if (report.ok) {
    return [
      `forge validate: OK — ${report.filesChecked} manifest file(s) checked, 0 failures.`,
      ...warningBlock,
    ].join('\n\n');
  }
  return [
    `forge validate: FAILED — ${report.failures.length} failure(s) across ${report.filesChecked} file(s).`,
    ...report.failures.map(render),
    ...warningBlock,
  ].join('\n\n');
}

/**
 * `forge validate` — the structural + referential-integrity engine (W0-B2)
 * together with the W0-B3 policy and safety rules, which `validateRepo` runs
 * by default. One command, one report, one exit code.
 */
export function runValidateCommand(opts: { readonly json: boolean }): number {
  const repoRoot = findRepoRoot();
  const report = validateRepo(repoRoot);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(`${formatValidationReportHuman(report)}\n`);
  }
  return report.ok ? 0 : 1;
}
