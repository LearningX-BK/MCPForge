// MCPForge — W0-B7 tests. Every clause of the task's `done:` criterion,
// proven against the `jde.ap.voucher.create` fixture (the `bindingCustom:
// true` variant at `../../emit/fixtures-custom`, shared with W0-B5/B6).
// W0-P18 narrowed the generated contract test to what the committed
// artefacts own; the two-phase round trips are proven on the served path
// by core/gateway's suites (see the generator's header).
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
import { HANDLER_RUNTIME_EXPORTS } from '../handler.js';

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

describe('W0-B7 (narrowed by W0-P18): the generated contract test proves what the committed artefacts own', () => {
  it('pins the handler export list, the schema, the two-phase input, the custom body and the reversal argMap', async () => {
    const repoRoot = freshInRepoRoot(fixturesRepoRoot);
    await runCodegen(repoRoot);
    const source = readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/contract.test.ts`.split('/')));

    // 1. The handler artefact is not a call path: its exact runtime export list.
    expect(source).toContain('the handler artefact is not a call path');
    expect(source).toContain('Object.keys(handlerModule).sort()');
    for (const name of HANDLER_RUNTIME_EXPORTS) expect(source).toContain(`'${name}'`);

    // 2. Schema acceptance and INPUT_INVALID with a non-empty next.
    expect(source).toContain('a valid argument set passes the published schema');
    expect(source).toContain('declared error: INPUT_INVALID when "supplier_number" is missing');
    expect(source).toContain('ERROR_TAXONOMY.INPUT_INVALID.next.trim().length');

    // 3. The two-phase confirm input on a write tool (02 §3.1.1).
    expect(source).toContain('two-phase input: the schema carries confirm as optional string|null');

    // 4. The hand-owned body's exports.
    expect(source).toContain('the hand-owned binding body exports execute and dryRun');

    // 5. Reversal round trip (compensating-tool, jde.ap.voucher.cancel).
    expect(source).toContain('reversal round trip');
    expect(source).toContain('jde.ap.voucher.cancel');
    expect(source).toContain('ARG_MAP');
    expect(source).toContain('document_number');
  });

  it('W0-P18: never re-implements the served two-phase path — no handle(), no mock confirm signer, idempotency map or audit list', async () => {
    const repoRoot = freshInRepoRoot(fixturesRepoRoot);
    await runCodegen(repoRoot);
    const source = readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/contract.test.ts`.split('/')));
    expect(source).not.toMatch(/\bhandle\(ctx/);
    expect(source).not.toMatch(/import \{ handle\b/);
    expect(source).not.toContain('makeCtx');
    expect(source).not.toContain('confirmTokens');
    expect(source).not.toContain('recordBeforeInvoke');
    expect(source).not.toContain('auditRecords');
    expect(source).not.toContain("vi.mock('./binding.custom.js'");
  });
});

describe('W0-B7 DONE CRITERION: generated unit.test.ts asserts every declared error path returns a non-empty next', () => {
  it('carries an explicit assertion over every error code a call to this tool can be refused with', async () => {
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

describe('W0-B7 JUDGMENT CALL: a non-custom-binding tool still gets a contract.test.ts', () => {
  it('covers the same artefact-owned checks, without a hand-owned body to import', async () => {
    const repoRoot = freshInRepoRoot(nonCustomFixturesRepoRoot);
    const report = await runCodegen(repoRoot);
    expect(report.filesWritten).toEqual(
      expect.arrayContaining([`${TOOL_DIR}/contract.test.ts`.replace(/\\/g, '/')]),
    );
    const source = readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/contract.test.ts`.split('/')));
    expect(source).toContain('the handler artefact is not a call path');
    expect(source).toContain('two-phase input');
    expect(source).toContain('declared error: INPUT_INVALID');
    expect(source).toContain('reversal round trip');
    // No hand-owned binding module exists for a non-custom tool.
    expect(source).not.toContain("from './binding.custom.js'");
    expect(source).not.toContain('the hand-owned binding body');
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
