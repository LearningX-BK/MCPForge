import { findRepoRoot } from '@mcpforge/ci';
import {
  acceptContract,
  findToolManifest,
  formatContractDriftHuman,
  runCodegen,
  type AcceptContractResult,
  type CodegenReport,
} from '@mcpforge/codegen/emit';

/** Human-readable rendering, mirroring `formatValidationReportHuman`'s shape. */
export function formatCodegenReportHuman(report: CodegenReport): string {
  if (!report.ok) {
    // 02 §2.4's worked failure block, one per drifted tool.
    return [
      `forge codegen: FAILED — ${report.contractDrift.length} hand-owned binding contract(s) drifted. No hand-owned file was written.`,
      ...report.contractDrift.map((d) => formatContractDriftHuman(d)),
    ].join('\n\n');
  }
  const lines = [
    `forge codegen: OK — ${report.manifestsProcessed} tool manifest(s) processed, ${report.filesWritten.length} file(s) written.`,
  ];
  for (const f of report.filesWritten) {
    lines.push(`  ${f}`);
  }
  for (const id of report.customBindingsCreated) {
    lines.push(`  created hand-owned binding stub for ${id} — codegen will never write it again.`);
  }
  return lines.join('\n');
}

/** Human-readable rendering of an `--accept-contract` run. */
export function formatAcceptContractHuman(result: AcceptContractResult): string {
  if (result.ok) {
    return [
      `forge codegen --accept-contract ${result.toolId}: OK — hash comment rewritten, nothing else in the file touched.`,
      `  file:  ${result.file}`,
      `  hash:  ${result.previousHash ?? '(none)'} -> ${result.acceptedHash}`,
    ].join('\n');
  }
  return [
    `forge codegen --accept-contract ${result.toolId}: REFUSED`,
    `  ${result.message}`,
    `  next: ${result.next}`,
  ].join('\n');
}

/**
 * `forge codegen` (W0-B4) and `forge codegen --accept-contract <id>` (W0-B5).
 *
 * SCOPE: the pipeline writes one placeholder artefact per Tool manifest,
 * proving the deterministic-writer + provenance-header + manifest-sha256
 * chain; the real per-tool artefact set (`schema.json`, `tool.ts`,
 * `handler.generated.ts`, tests, docs, discovery card, role scope) is W0-B6.
 * What IS real here is 02 §2.4's three-file split: the hand-owned
 * `binding.custom.ts` is created once and thereafter never written while its
 * contract hash holds, and a drifted contract fails this command.
 *
 * `--accept-contract <id>` deliberately does NOT run the pipeline: it is a
 * single, surgical, human/agent act on one file, refused when `CI=true`.
 */
export async function runCodegenCommand(opts: {
  readonly json: boolean;
  readonly acceptContract?: string;
}): Promise<number> {
  const repoRoot = findRepoRoot();

  if (opts.acceptContract !== undefined) {
    const toolId = opts.acceptContract;
    const manifest = findToolManifest(repoRoot, toolId);
    if (manifest === null) {
      const refusal = {
        ok: false as const,
        code: 'ACCEPT_CONTRACT_REFUSED' as const,
        toolId,
        message: `No Tool manifest with id ${toolId} was found under manifests/.`,
        next: 'Check the tool id, or run `forge validate` to list the manifests the repo actually contains.',
      };
      if (opts.json) process.stdout.write(`${JSON.stringify(refusal)}\n`);
      else process.stderr.write(`${formatAcceptContractHuman(refusal)}\n`);
      return 1;
    }
    const result = await acceptContract({ repoRoot, toolId, doc: manifest.doc });
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else if (result.ok) {
      process.stdout.write(`${formatAcceptContractHuman(result)}\n`);
    } else {
      process.stderr.write(`${formatAcceptContractHuman(result)}\n`);
    }
    return result.ok ? 0 : 1;
  }

  const report = await runCodegen(repoRoot);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else if (report.ok) {
    process.stdout.write(`${formatCodegenReportHuman(report)}\n`);
  } else {
    process.stderr.write(`${formatCodegenReportHuman(report)}\n`);
  }
  return report.ok ? 0 : 1;
}
