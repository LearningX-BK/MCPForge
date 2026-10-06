// MCPForge — `forge test`. W0-Q7, 02 §2.3 and §8.
//
//   forge test [<toolId>…] [--json] [--root <dir>]
//
// Runs the generated `contract.test.ts` and `unit.test.ts` under
// `generated/tools/<id>/` for the named tools (every tool when none is named),
// through the repo's own Vitest, and reports pass/fail per tool. Exits non-zero
// when any tool fails or when a named tool is unknown. It runs the committed
// generated tests; it does not regenerate them (that is `forge codegen`).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findDefinitionsRoot } from '@mcpforge/ci';

export interface TestCommandOptions {
  readonly json: boolean;
  readonly root?: string;
}

/** One test file's outcome, as the runner reports it. */
export interface FileResult {
  /** Absolute or repo-relative path of the test file. */
  readonly file: string;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

export type TestRunner = (root: string, files: readonly string[]) => FileResult[] | Promise<FileResult[]>;

export interface ToolTestResult {
  readonly toolId: string;
  readonly status: 'passed' | 'failed' | 'missing';
  readonly files: readonly string[];
  readonly failures: readonly string[];
}

const USAGE_EXIT_CODE = 64;
const TEST_FILES = ['contract.test.ts', 'unit.test.ts'] as const;

export function listGeneratedToolIds(root: string): string[] {
  const dir = join(root, 'generated', 'tools');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** The default runner: the repo's Vitest, JSON reporter, one process for all files. */
export const vitestRunner: TestRunner = (root, files) => {
  const outDir = mkdtempSync(join(tmpdir(), 'forge-test-'));
  const outFile = join(outDir, 'report.json');
  try {
    const entry = createRequire(join(root, 'package.json')).resolve('vitest/vitest.mjs');
    spawnSync(
      process.execPath,
      [entry, 'run', '--reporter=json', `--outputFile=${outFile}`, ...files],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'] },
    );
    if (!existsSync(outFile)) {
      return files.map((file) => ({
        file,
        passed: false,
        failures: ['Vitest produced no report; run "pnpm test" to see the runner error.'],
      }));
    }
    const report = JSON.parse(readFileSync(outFile, 'utf8')) as {
      testResults: {
        name: string;
        status: string;
        message?: string;
        assertionResults: { status: string; fullName: string; failureMessages?: string[] }[];
      }[];
    };
    return report.testResults.map((t) => ({
      file: t.name,
      passed: t.status === 'passed',
      failures: [
        ...t.assertionResults
          .filter((a) => a.status === 'failed')
          .map((a) => `${a.fullName}: ${(a.failureMessages?.[0] ?? '').split('\n')[0]}`),
        ...(t.status !== 'passed' && t.assertionResults.every((a) => a.status !== 'failed')
          ? [(t.message ?? 'test file failed to run').split('\n')[0] ?? 'test file failed to run']
          : []),
      ],
    }));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
};

const norm = (p: string): string => p.split('\\').join('/');

export async function runTestCommand(
  toolIds: readonly string[],
  opts: TestCommandOptions,
  runner: TestRunner = vitestRunner,
): Promise<number> {
  const root = opts.root !== undefined ? resolve(opts.root) : findDefinitionsRoot();
  const known = listGeneratedToolIds(root);
  const unknown = toolIds.filter((id) => !known.includes(id));
  if (unknown.length > 0) {
    const error = {
      ok: false as const,
      code: 'INPUT_INVALID' as const,
      message: `Unknown tool id(s): ${unknown.join(', ')}. No generated tests exist for them.`,
      next:
        known.length === 0
          ? 'Run "forge codegen" to generate the per-tool tests, then re-run "forge test".'
          : `Run "forge codegen" if the manifest is new, or pick an id from generated/tools/ (e.g. ${known[0]}).`,
    };
    if (opts.json) process.stdout.write(`${JSON.stringify(error)}\n`);
    else {
      process.stderr.write(`forge: test — ${error.message}\n`);
      process.stderr.write(`forge: next — ${error.next}\n`);
    }
    return USAGE_EXIT_CODE;
  }

  const targets = toolIds.length > 0 ? [...new Set(toolIds)] : known;
  const filesFor = (id: string): string[] =>
    TEST_FILES.map((f) => `generated/tools/${id}/${f}`).filter((f) => existsSync(join(root, f)));
  const all = targets.flatMap(filesFor);
  const results = all.length > 0 ? await runner(root, all) : [];

  const tools: ToolTestResult[] = targets.map((toolId) => {
    const files = filesFor(toolId);
    if (files.length === 0) {
      return { toolId, status: 'missing', files, failures: ['No generated test files for this tool.'] };
    }
    const mine = files.map((f) => {
      const hit = results.find((r) => norm(r.file).endsWith(f));
      return hit ?? { file: f, passed: false, failures: ['The runner did not report this file.'] };
    });
    const failures = mine.filter((m) => !m.passed).flatMap((m) => m.failures);
    return { toolId, status: failures.length === 0 && mine.every((m) => m.passed) ? 'passed' : 'failed', files, failures };
  });

  const failed = tools.filter((t) => t.status !== 'passed');
  const ok = failed.length === 0;
  const payload = {
    ok,
    passed: tools.length - failed.length,
    failed: failed.length,
    tools,
    next: ok
      ? 'All named tools pass. Run "forge validate" and "forge ci" before proposing.'
      : `Fix the failing tool(s): ${failed.map((t) => t.toolId).join(', ')}. Re-run "forge test ${failed[0]!.toolId}" after editing its manifest or binding.custom.ts and running "forge codegen".`,
  };
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    for (const t of tools) {
      process.stdout.write(`${t.status === 'passed' ? 'PASS' : 'FAIL'}  ${t.toolId}\n`);
      for (const f of t.failures) process.stdout.write(`        ${f}\n`);
    }
    process.stdout.write(`forge test: ${payload.passed} passed, ${payload.failed} failed.\n`);
    if (!ok) process.stdout.write(`forge: next — ${payload.next}\n`);
  }
  return ok ? 0 : 1;
}
