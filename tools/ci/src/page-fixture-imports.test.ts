// MCPForge — W0-P3c. Proves "no page renders fixture data" over the REAL
// portal tree, and proves on small trees that the check catches what it claims
// to (a direct import, an import two hops away, `@/` and dynamic imports) and
// ignores what it should (type-only imports, tests).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkPageFixtureImports,
  formatFixtureImportReport,
  isFixtureFile,
} from './page-fixture-imports.js';
import { findRepoRoot } from './repo-root.js';

describe('checkPageFixtureImports — the real repo', () => {
  it('no route reaches a fixture module beyond the owned allowlist', () => {
    const report = checkPageFixtureImports(findRepoRoot());
    expect(report.entriesScanned).toBeGreaterThan(10);
    expect(formatFixtureImportReport(report)).not.toContain('renders fixture data');
    expect(report.violations).toEqual([]);
    expect(report.staleAllowances).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe('checkPageFixtureImports — small trees', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  function tree(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'mcpforge-fixture-imports-'));
    roots.push(root);
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(root, 'core', 'portal', 'src', rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }
    return root;
  }

  const FIXTURE = { 'app/x/fixtures.ts': 'export const rows = [];\n' };

  it('flags a page that imports a fixtures.ts directly', () => {
    const report = checkPageFixtureImports(
      tree({ ...FIXTURE, 'app/x/page.tsx': "import { rows } from './fixtures';\n" }),
      {},
    );
    expect(report.violations).toEqual([
      { entry: 'app/x/page.tsx', chain: ['app/x/page.tsx', 'app/x/fixtures.ts'] },
    ]);
  });

  it('flags a fixture reached two hops away, through a @/ alias, with the whole chain', () => {
    const report = checkPageFixtureImports(
      tree({
        ...FIXTURE,
        'app/x/page.tsx': "import { load } from '@/lib/loader';\n",
        'lib/loader.ts': "export { rows as load } from '../app/x/fixtures';\n",
      }),
      {},
    );
    expect(report.violations[0]?.chain).toEqual([
      'app/x/page.tsx',
      'lib/loader.ts',
      'app/x/fixtures.ts',
    ]);
  });

  it('flags a dynamic import, and a layout as well as a page', () => {
    const report = checkPageFixtureImports(
      tree({ ...FIXTURE, 'app/x/layout.tsx': "const m = import('./fixtures');\n" }),
      {},
    );
    expect(report.violations.map((v) => v.entry)).toEqual(['app/x/layout.tsx']);
  });

  it('ignores type-only imports and test files', () => {
    const report = checkPageFixtureImports(
      tree({
        ...FIXTURE,
        'app/x/page.tsx':
          "import type { Row } from './fixtures';\nimport { type Row as R } from './fixtures';\nimport { v } from './view';\n",
        'app/x/view.tsx': 'export const v = 1;\n',
        'app/x/page.test.tsx': "import { rows } from './fixtures';\n",
      }),
      {},
    );
    expect(report.ok).toBe(true);
  });

  it('admits an allowlisted edge, and fails an allowlist entry that no longer occurs', () => {
    const root = tree({ ...FIXTURE, 'app/x/page.tsx': "import { rows } from './fixtures';\n" });
    expect(
      checkPageFixtureImports(root, { 'app/x/page.tsx -> app/x/fixtures.ts': 'owned by a task' })
        .ok,
    ).toBe(true);
    const stale = checkPageFixtureImports(root, {
      'app/x/page.tsx -> app/x/fixtures.ts': 'owned',
      'app/y/page.tsx -> app/y/fixtures.ts': 'gone',
    });
    expect(stale.ok).toBe(false);
    expect(stale.staleAllowances).toEqual(['app/y/page.tsx -> app/y/fixtures.ts']);
  });

  it('knows which files are fixtures', () => {
    expect(isFixtureFile('app/a/fixtures.ts')).toBe(true);
    expect(isFixtureFile('components/change/test-fixtures.ts')).toBe(true);
    expect(isFixtureFile('app/insights/_lib/test-fixture.ts')).toBe(true);
    expect(isFixtureFile('app/insights/source.ts')).toBe(false);
    expect(isFixtureFile('app/a/fixtures-note.ts')).toBe(false);
  });
});
