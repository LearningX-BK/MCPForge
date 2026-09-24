// MCPForge — W0-B7 tests. Every clause of the task's `done:` criterion,
// proven against the `jde.ap.voucher.create` fixture (the `bindingCustom:
// true` variant at `../../emit/fixtures-custom`, shared with W0-B5/B6,
// since the handler must demonstrably dispatch into `binding.custom.ts`).
//
// Two layers of proof, matching the rigor W0-B6's own `templates.test.ts`
// used for the generated handler:
//   1. Static assertions on the generated `contract.test.ts` SOURCE, proving
//      every one of the seven concerns 02 §2.3's artefact-table row names is
//      demonstrably present (not string soup — checked via the actual
//      test-name strings and the actual assertion calls each section emits).
//   2. An end-to-end run: the generated `contract.test.ts` is written into a
//      throwaway directory INSIDE this repo (so Node's module resolution
//      walks up to the real, pnpm-linked `node_modules/@mcpforge/shared`),
//      and is then actually executed by a real `vitest run` subprocess —
//      proving the generated tests are runnable code that passes, not just
//      plausible-looking text.

import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runCodegen } from '../../emit/pipeline.js';
import { readGeneratedFile } from '../../emit/writer.js';

const here = dirname(fileURLToPath(import.meta.url));
// core/codegen/src/emit/fixtures-custom — the bindingCustom: true fixture.
const fixturesRepoRoot = join(here, '..', '..', 'emit', 'fixtures-custom');
// core/codegen/src/emit/fixtures — the bindingCustom: false variant, for the
// non-custom-tool judgment-call path.
const nonCustomFixturesRepoRoot = join(here, '..', '..', 'emit', 'fixtures');
const TOOL_ID = 'jde.ap.voucher.create';
const TOOL_DIR = join('generated', 'tools', TOOL_ID);
const REPO_ROOT = join(here, '..', '..', '..', '..', '..'); // core/codegen/src/templates/tests -> repo root

const tmpDirs: string[] = [];

/**
 * A throwaway repo root INSIDE the real repository tree (not `os.tmpdir()`),
 * so a generated file's `import ... from '@mcpforge/shared/errors'` resolves
 * to the real, pnpm-workspace-linked `node_modules/@mcpforge/shared` by
 * ordinary upward Node module resolution.
 */
function freshInRepoRoot(fixtures: string): string {
  const dir = mkdtempSync(join(REPO_ROOT, 'core', 'codegen', '.contract-probe-'));
  tmpDirs.push(dir);
  cpSync(join(fixtures, 'manifests'), join(dir, 'manifests'), { recursive: true });
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('W0-B7 DONE CRITERION: contract.test.ts is generated for a write tool', () => {
  it('is written to generated/tools/<id>/contract.test.ts alongside the other six artefacts', async () => {
    const repoRoot = freshInRepoRoot(fixturesRepoRoot);
    const report = await runCodegen(repoRoot);
    expect(report.ok).toBe(true);
    expect(report.filesWritten).toEqual(
      expect.arrayContaining([`${TOOL_DIR}/contract.test.ts`.replace(/\\/g, '/')]),
    );
  });
});

describe('W0-B7 DONE CRITERION: every one of the seven concerns is demonstrably present in the generated source', () => {
  it('covers happy path, every declared error, dry-run shape, confirm-token binding, argument-mismatch refusal, idempotent replay and the reversal round trip', async () => {
    const repoRoot = freshInRepoRoot(fixturesRepoRoot);
    await runCodegen(repoRoot);
    const source = readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/contract.test.ts`.split('/')));

    // 1. Happy path.
    expect(source).toContain('happy path: plan then execute with a valid confirmToken succeeds');
    expect(source).toContain("status: 'confirm_required'");

    // 2. Every declared error path — INPUT_INVALID, POLICY_GUARDRAIL_BREACH
    // (this fixture declares a maxNumeric guardrail on `amount`),
    // PLAN_ARGUMENT_MISMATCH, and TARGET_ERROR (via the mocked binding) —
    // each asserted with a non-empty `next`.
    expect(source).toContain('declared error: INPUT_INVALID on schema violation');
    expect(source).toContain("code: 'INPUT_INVALID'");
    expect(source).toContain('declared error: POLICY_GUARDRAIL_BREACH');
    expect(source).toContain("code: 'POLICY_GUARDRAIL_BREACH'");
    expect(source).toContain('declared error: PLAN_ARGUMENT_MISMATCH');
    expect(source).toContain('declared error: an unmapped target failure maps to TARGET_ERROR');
    expect(source).toContain("code: 'TARGET_ERROR'");
    // Every one of those assertions carries a non-empty next.
    expect((source.match(/next: expect\.stringMatching\(\/\\S\//g) ?? []).length).toBeGreaterThanOrEqual(4);

    // 3. Dry-run shape.
    expect(source).toContain('dry-run shape: the plan-phase response carries status/plan/confirmToken/expiresAt/next');
    expect(source).toContain('confirmToken: expect.any(String)');
    expect(source).toContain('expiresAt: expect.any(String)');

    // 4. Confirm-token binding.
    expect(source).toContain('confirm-token binding: a token minted for one argument set is refused against a different one');

    // 5. Argument-mismatch refusal (explicit and separately assertable, per the done criterion's own wording).
    expect(source).toContain('argument-mismatch refusal: execute is refused, not silently re-planned');

    // 6. Idempotent replay.
    expect(source).toContain('idempotent replay: executing twice with the same confirmToken returns the original result with replayed: true');
    expect(source).toContain('replayed).toBe(true)');

    // 7. Reversal round trip (this fixture's writeSafety.reversal.class is compensating-tool, tool jde.ap.voucher.cancel).
    expect(source).toContain('reversal round trip');
    expect(source).toContain('jde.ap.voucher.cancel');
    expect(source).toContain('ARG_MAP');
    expect(source).toContain('document_number');
  });
});

describe('W0-B7 DONE CRITERION: generated unit.test.ts asserts every declared error path returns a non-empty next', () => {
  it('carries an explicit assertion over every error code this handler is generated to throw', async () => {
    const repoRoot = freshInRepoRoot(fixturesRepoRoot);
    await runCodegen(repoRoot);
    const source = readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/unit.test.ts`.split('/')));
    expect(source).toContain("import { ERROR_TAXONOMY } from '@mcpforge/shared/errors'");
    expect(source).toContain('every declared error path');
    expect(source).toContain('carries a non-empty, agent-actionable next');
    expect(source).toContain('spec.next.trim().length).toBeGreaterThan(0)');
    expect(source).toContain("'INPUT_INVALID'");
    expect(source).toContain("'POLICY_GUARDRAIL_BREACH'");
    expect(source).toContain("'PLAN_ARGUMENT_MISMATCH'");
    expect(source).toContain("'TARGET_ERROR'");
  });
});

describe('W0-B7 JUDGMENT CALL: a non-custom-binding tool still gets a contract.test.ts, scoped to what its stub body supports', () => {
  it('omits the binding-dispatch-specific cases (happy path against a real target, TARGET_ERROR, reversal round trip) that a Wave-1-scope placeholder body cannot meaningfully drive', async () => {
    const repoRoot = freshInRepoRoot(nonCustomFixturesRepoRoot);
    const report = await runCodegen(repoRoot);
    expect(report.filesWritten).toEqual(
      expect.arrayContaining([`${TOOL_DIR}/contract.test.ts`.replace(/\\/g, '/')]),
    );
    const source = readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/contract.test.ts`.split('/')));
    // Still covers the write-safety two-phase mechanics, which do not depend
    // on a real target dispatch.
    expect(source).toContain('dry-run shape');
    expect(source).toContain('confirm-token binding');
    expect(source).toContain('idempotent replay');
    expect(source).toContain('declared error: INPUT_INVALID');
    // No mocked binding module exists for a non-custom tool.
    expect(source).not.toContain("vi.mock('./binding.custom.js'");
  });
});

describe('W0-B7 END-TO-END: the generated contract.test.ts is real, runnable code that passes', () => {
  it('actually runs under vitest and every test in it passes', async () => {
    const repoRoot = freshInRepoRoot(fixturesRepoRoot);
    await runCodegen(repoRoot);
    const testFileAbs = join(repoRoot, ...`${TOOL_DIR}/contract.test.ts`.split('/'));

    // Run the generated file with the repo's own vitest binary, rooted at the
    // real repo root so its config (and node_modules resolution) apply, but
    // pointed only at this one generated file.
    const vitestBin = join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.CMD' : 'vitest');
    let output: string;
    let failed = false;
    try {
      output = execFileSync(
        vitestBin,
        ['run', testFileAbs, '--config', join(here, 'contract-probe.vitest.config.ts')],
        // shell: true is required on Windows to invoke the `.CMD` shim
        // execFileSync otherwise fails to spawn directly (EINVAL); the
        // arguments here are all generator-controlled absolute paths, not
        // untrusted input, so shell-arg-escaping is not a concern.
        {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          stdio: 'pipe',
          shell: true,
          env: { ...process.env, FORCE_COLOR: '0', CI: 'true' },
        },
      );
    } catch (err) {
      failed = true;
      output = `${(err as { stdout?: string }).stdout ?? ''}${(err as { stderr?: string }).stderr ?? ''}`;
    }
    // eslint-disable-next-line no-control-regex -- stripping ANSI colour codes from the child's terminal output
    const plain = output.replace(/\[[0-9;]*m/g, '');
    expect(failed, `generated contract.test.ts failed under real vitest execution:\n${plain}`).toBe(false);
    expect(plain).toMatch(/Tests\s+\d+\s+passed/);
  }, 30000);
});

// Sanity: the shared fixture manifest is present.
describe('fixture manifest', () => {
  it('is present, non-empty, and declares bindingCustom: true', () => {
    const content = readFileSync(
      join(fixturesRepoRoot, 'manifests', 'jde', 'fin', 'ap', 'voucher.create.tool.yaml'),
      'utf8',
    );
    expect(content).toContain('bindingCustom: true');
  });
});
