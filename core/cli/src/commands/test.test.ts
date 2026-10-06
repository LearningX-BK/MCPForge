import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTestCommand, type FileResult, type TestRunner } from './test.js';

function repoWith(tools: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'forge-test-cmd-'));
  for (const id of tools) {
    const dir = join(root, 'generated', 'tools', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'contract.test.ts'), '');
    writeFileSync(join(dir, 'unit.test.ts'), '');
  }
  return root;
}

/** A fake runner: every file passes except those of the tools named in `failing`. */
const fake = (failing: readonly string[], seen: string[][] = []): TestRunner => (_root, files) => {
  seen.push([...files]);
  return files.map<FileResult>((file) => {
    const bad = failing.some((id) => file.includes(`/${id}/`));
    return { file, passed: !bad, failures: bad ? ['unit: expected next to be non-empty'] : [] };
  });
};

describe('forge test', () => {
  let out: string;
  beforeEach(() => {
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => ((out += String(c)), true));
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('one tool: runs only that tool\'s two generated files and exits 0', async () => {
    const root = repoWith(['a.b.c.get', 'a.b.c.list']);
    const seen: string[][] = [];
    const code = await runTestCommand(['a.b.c.get'], { json: true, root }, fake([], seen));
    expect(code).toBe(0);
    expect(seen[0]).toEqual(['generated/tools/a.b.c.get/contract.test.ts', 'generated/tools/a.b.c.get/unit.test.ts']);
    expect(JSON.parse(out)).toMatchObject({ ok: true, passed: 1, failed: 0, tools: [{ toolId: 'a.b.c.get', status: 'passed' }] });
  });

  it('all tools when none are named; a failure is reported per tool and exits non-zero', async () => {
    const root = repoWith(['a.b.c.get', 'a.b.c.list']);
    const code = await runTestCommand([], { json: true, root }, fake(['a.b.c.list']));
    expect(code).toBe(1);
    const r = JSON.parse(out) as { passed: number; failed: number; tools: { toolId: string; status: string }[]; next: string };
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.tools.map((t) => `${t.toolId}:${t.status}`)).toEqual(['a.b.c.get:passed', 'a.b.c.list:failed']);
    expect(r.next).toContain('a.b.c.list');
  });

  it('human output names pass/fail per tool', async () => {
    const root = repoWith(['a.b.c.get', 'a.b.c.list']);
    expect(await runTestCommand([], { json: false, root }, fake(['a.b.c.get']))).toBe(1);
    expect(out).toMatch(/FAIL {2}a\.b\.c\.get/);
    expect(out).toMatch(/PASS {2}a\.b\.c\.list/);
  });

  it('an unknown tool id fails with a next and runs nothing', async () => {
    const root = repoWith(['a.b.c.get']);
    const seen: string[][] = [];
    const code = await runTestCommand(['x.y.z.get'], { json: true, root }, fake([], seen));
    expect(code).toBe(64);
    expect(seen).toEqual([]);
    const e = JSON.parse(out) as { code: string; next: string };
    expect(e.code).toBe('INPUT_INVALID');
    expect(e.next).toMatch(/forge codegen|generated\/tools/);
  });

  it('a file the runner never reported counts as a failure, not a pass', async () => {
    const root = repoWith(['a.b.c.get']);
    const code = await runTestCommand([], { json: true, root }, () => []);
    expect(code).toBe(1);
  });
});
