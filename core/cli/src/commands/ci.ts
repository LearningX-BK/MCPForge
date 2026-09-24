import { formatCiReportHuman, runCiPipeline } from '@mcpforge/ci';

/** `forge ci` — runs the local, host-agnostic CI pipeline (02 §7.2 stages 1-11) and reports the result. */
export async function runCiCommand(opts: { readonly json: boolean }): Promise<number> {
  const report = await runCiPipeline();
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(`${formatCiReportHuman(report)}\n`);
  }
  return report.ok ? 0 : 1;
}
