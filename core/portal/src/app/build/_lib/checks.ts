'use server';
// MCPForge — W0-J14: the right pane's composite "Run checks" action.
//
// Builds ONE sandbox copy of the real definitional trees (see
// `repo-validate.ts`'s header for why a sandbox, not the live repo) and runs
// every REAL, already-existing mechanism against it:
//   - `validateRepo`            -> validate rules (structural + referential + policy)
//   - `runTokenBudgetGate`      -> token budget AND role budget impact, together,
//                                  because the gate computes both from the same
//                                  pass (02 §5.3(d)'s role core-set sum is a
//                                  function of every tool's measured resident
//                                  cost, including this draft's)
//   - `runCodegen`              -> codegen report for this draft (files it would
//                                  write, and any CUSTOM_BINDING_CONTRACT_DRIFT)
// One honestly-scoped gap, disclosed rather than faked (CLAUDE.md §8): this
// does not EXECUTE the generated contract test (that needs a running
// vitest process per check, which is out of this task's touches: scope) —
// it reports whether codegen could emit one without contract drift, and
// names the generated file a human/CI would run.
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateRepo, type ValidationFailure } from '@mcpforge/codegen/validate';
import { runTokenBudgetGate, type BudgetFailure } from '@mcpforge/codegen/budget/server';
import { runCodegen, type CodegenReport } from '@mcpforge/codegen/emit';
import { resolveRepoRoot } from './repo-root';

const COPY_DIRS = ['manifests', 'roles', 'packages', 'consumers', 'enums'] as const;

export interface DraftChecksResult {
  readonly ok: boolean;
  readonly validate: {
    readonly failures: readonly (ValidationFailure & { readonly concernsDraft: boolean })[];
    readonly warnings: readonly (ValidationFailure & { readonly concernsDraft: boolean })[];
  };
  readonly tokenBudget: {
    readonly toolMeasurement: { readonly cardTokens: number; readonly residentTokens: number; readonly describeTokens: number } | undefined;
    readonly failures: readonly BudgetFailure[];
  };
  readonly roleBudgetImpact: readonly { readonly roleId: string; readonly coreSetTokens: number; readonly overBudget: boolean }[];
  readonly codegen: {
    readonly ok: boolean;
    readonly filesWritten: readonly string[];
    readonly contractDrift: CodegenReport['contractDrift'];
  };
  readonly sandboxError?: string;
}

async function withSandbox<T>(
  manifestPath: string,
  yamlText: string,
  fn: (sandbox: string) => Promise<T>,
): Promise<T> {
  const repoRoot = resolveRepoRoot();
  const sandbox = mkdtempSync(join(tmpdir(), 'mcpforge-build-checks-'));
  try {
    for (const dir of COPY_DIRS) {
      const src = join(repoRoot, dir);
      if (existsSync(src)) cpSync(src, join(sandbox, dir), { recursive: true });
    }
    const draftAbsPath = join(sandbox, manifestPath);
    mkdirSync(dirname(draftAbsPath), { recursive: true });
    writeFileSync(draftAbsPath, yamlText, 'utf8');
    return await fn(sandbox);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

export async function runDraftChecks(
  manifestPath: string,
  yamlText: string,
  toolId: string,
): Promise<DraftChecksResult> {
  try {
    return await withSandbox(manifestPath, yamlText, async (sandbox) => {
      const draftFile = manifestPath.split('\\').join('/');
      const report = validateRepo(sandbox);
      const tag = (f: ValidationFailure) => ({ ...f, concernsDraft: f.file === draftFile });

      const gate = runTokenBudgetGate(sandbox);
      const toolMeasurement = gate.tools[toolId];
      const gateFailuresForTool = gate.failures.filter((f) => f.id === toolId || f.kind === 'roleCoreSet');
      const roleBudgetImpact = Object.entries(gate.roles)
        .filter(([, r]) => r.coreTools.includes(toolId))
        .map(([roleId, r]) => ({ roleId, coreSetTokens: r.coreSetTokens, overBudget: r.coreSetTokens > 1300 }));

      let codegen: CodegenReport | undefined;
      let codegenError: string | undefined;
      try {
        codegen = await runCodegen(sandbox);
      } catch (err) {
        codegenError = err instanceof Error ? err.message : String(err);
      }

      return {
        ok: report.ok,
        validate: {
          failures: report.failures.map(tag),
          warnings: report.warnings.map(tag),
        },
        tokenBudget: { toolMeasurement, failures: gateFailuresForTool },
        roleBudgetImpact,
        codegen: codegen
          ? { ok: codegen.ok, filesWritten: codegen.filesWritten, contractDrift: codegen.contractDrift }
          : { ok: false, filesWritten: [], contractDrift: [] },
        ...(codegenError ? { sandboxError: codegenError } : {}),
      } satisfies DraftChecksResult;
    });
  } catch (err) {
    return {
      ok: false,
      validate: { failures: [], warnings: [] },
      tokenBudget: { toolMeasurement: undefined, failures: [] },
      roleBudgetImpact: [],
      codegen: { ok: false, filesWritten: [], contractDrift: [] },
      sandboxError: err instanceof Error ? err.message : String(err),
    };
  }
}
