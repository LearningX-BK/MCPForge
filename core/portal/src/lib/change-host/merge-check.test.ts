// MCPForge — W0-P33b: the merge check is the real `forge`, not a second
// definition of "valid". Run against a copy of this repository's definitions
// (so this working tree is never touched): the untouched copy passes, and a
// copy with a broken manifest is refused with a `next`.
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveRuntimeRoot } from '../../app/build/_lib/repo-root';
import { forgeMergeCheck } from './merge-check';

const DEFINITIONS = [
  'manifests',
  'roles',
  'packages',
  'consumers',
  'enums',
  'evals',
  'approvals',
  'generated',
  'overlays',
];
const ROOT_FILES = ['.prettierrc', '.prettierignore', '.editorconfig'];

let runtimeRoot: string;
const temps: string[] = [];

function copyDefinitions(): string {
  const tree = mkdtempSync(path.join(tmpdir(), 'mcpforge-p33b-check-'));
  temps.push(tree);
  for (const dir of DEFINITIONS) {
    const src = path.join(runtimeRoot, dir);
    if (existsSync(src)) cpSync(src, path.join(tree, dir), { recursive: true });
  }
  for (const file of ROOT_FILES) {
    const src = path.join(runtimeRoot, file);
    if (existsSync(src)) cpSync(src, path.join(tree, file));
  }
  return tree;
}

beforeAll(() => {
  runtimeRoot = resolveRuntimeRoot();
});

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe('forgeMergeCheck (W0-P33b)', () => {
  it('passes on an unchanged copy of the definitions', async () => {
    const result = await forgeMergeCheck(runtimeRoot)(copyDefinitions());
    expect(result).toEqual({ ok: true });
  }, 180_000);

  it('refuses a broken manifest with the rule’s message and a next', async () => {
    const tree = copyDefinitions();
    writeFileSync(
      path.join(tree, 'manifests', 'jde', 'fin', 'ap', 'voucher.get.tool.yaml'),
      'apiVersion: mcpforge/v1\nkind: Tool\nid: not a valid id\n',
    );
    const result = await forgeMergeCheck(runtimeRoot)(tree);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.next.length).toBeGreaterThan(0);
    expect(result.next.toLowerCase()).not.toContain('try again');
  }, 180_000);
});
