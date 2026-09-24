// `forge package jde-fin` — W0-K1, 02 §6.1, §6.2.
//
// Runs against THIS repo's real, checked-in manifests/generated/ tree (there
// is exactly one package at Wave 0, `jde-fin`, and its selection currently
// equals the full catalogue) rather than a synthetic fixture repo — the
// `done:` criterion is specifically that every file the command copies is
// byte-identical to "the same file in the full catalogue", and the full
// catalogue here is this repo.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findRepoRoot } from '@mcpforge/ci';
import { runPackageCommand } from './package.js';

const repoRoot = findRepoRoot();
const dirs: string[] = [];

function captureStdout(): { text: () => string; restore: () => void } {
  let buf = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    buf += String(chunk);
    return true;
  });
  return { text: () => buf, restore: () => spy.mockRestore() };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('forge package', () => {
  it('refuses a missing package id', async () => {
    const code = await runPackageCommand(undefined, { json: true });
    expect(code).toBe(64);
  });

  it('refuses an unknown package', async () => {
    const out = captureStdout();
    const code = await runPackageCommand('no-such-package', { json: true, root: repoRoot });
    out.restore();
    expect(code).toBe(64);
    const parsed = JSON.parse(out.text()) as { code: string };
    expect(parsed.code).toBe('PACKAGE_NOT_FOUND');
  });

  it('resolves jde-fin to its manifests and generated artefacts, copies them unchanged, and builds a selection-scoped index', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'mcpforge-package-'));
    dirs.push(outDir);

    const out = captureStdout();
    const code = await runPackageCommand('jde-fin', {
      json: true,
      root: repoRoot,
      out: outDir,
    });
    out.restore();
    expect(code).toBe(0);

    const report = JSON.parse(out.text()) as {
      readonly ok: true;
      readonly packageId: string;
      readonly outDir: string;
      readonly servers: readonly string[];
      readonly roles: readonly string[];
      readonly toolIds: readonly string[];
      readonly filesCopied: readonly string[];
    };
    expect(report.ok).toBe(true);
    expect(report.packageId).toBe('jde-fin');
    expect(report.servers).toEqual(['jde-fin-ap', 'jde-fin-gl', 'jde-scm-po']);
    expect(report.roles).toEqual(['p2p']);
    expect(report.toolIds.length).toBeGreaterThan(0);
    expect(report.filesCopied.length).toBeGreaterThan(0);

    // Expected fixed members of the selection, independent of the derived list.
    expect(report.filesCopied).toContain('packages/jde-fin.yaml');
    expect(report.filesCopied).toContain('roles/p2p.yaml');
    expect(report.filesCopied).toContain('generated/roles/p2p.scope.json');
    expect(report.filesCopied).toContain('generated/packages/jde-fin.selection.json');
    expect(report.filesCopied).toContain('generated/index/catalogue-index.json');
    expect(report.filesCopied).toContain('manifests/_servers/jde-fin-ap.server.yaml');
    expect(report.filesCopied).toContain(
      'generated/tools/jde.ap.voucher.get/handler.generated.ts',
    );

    // THE core assertion: every file the artefact copied out of manifests/ or
    // generated/ (i.e. everything except the derived, package-scoped index,
    // which is built rather than copied) is byte-identical to the same file
    // in the full catalogue (this repo). No templating, no substitution.
    for (const relPath of report.filesCopied) {
      if (relPath === 'generated/index/catalogue-index.json') continue; // asserted separately below
      const artefactPath = join(outDir, relPath);
      const sourcePath = join(repoRoot, relPath);
      expect(existsSync(artefactPath)).toBe(true);
      expect(existsSync(sourcePath)).toBe(true);
      const artefactBytes = readFileSync(artefactPath);
      const sourceBytes = readFileSync(sourcePath);
      expect(artefactBytes.equals(sourceBytes)).toBe(true);
    }

    // The selection-scoped index: jde-fin's selection currently equals the
    // full catalogue's tool set, so the index built "over just that
    // selection" must be byte-identical to the full-catalogue index too —
    // exercising 02 §6.2's invariant on the one derived file in the artefact.
    const packageIndexPath = join(outDir, 'generated', 'index', 'catalogue-index.json');
    const fullIndexPath = join(repoRoot, 'generated', 'index', 'catalogue-index.json');
    expect(readFileSync(packageIndexPath).equals(readFileSync(fullIndexPath))).toBe(true);
  });

  it('is a pure selection: re-running it twice produces byte-identical artefacts', async () => {
    const outA = mkdtempSync(join(tmpdir(), 'mcpforge-package-a-'));
    const outB = mkdtempSync(join(tmpdir(), 'mcpforge-package-b-'));
    dirs.push(outA, outB);

    const out1 = captureStdout();
    await runPackageCommand('jde-fin', { json: true, root: repoRoot, out: outA });
    out1.restore();
    const out2 = captureStdout();
    await runPackageCommand('jde-fin', { json: true, root: repoRoot, out: outB });
    out2.restore();

    const filesA = (JSON.parse(out1.text()) as { filesCopied: readonly string[] }).filesCopied;
    const filesB = (JSON.parse(out2.text()) as { filesCopied: readonly string[] }).filesCopied;
    expect(filesA).toEqual(filesB);
    for (const rel of filesA) {
      expect(readFileSync(join(outA, rel)).equals(readFileSync(join(outB, rel)))).toBe(true);
    }
  });
});
