// MCPForge — `forge slice-diff` — W0-K5, 02 §6.4.
//
// Wave 0 has exactly one real package (`jde-fin`), so the "explained by the
// server-list difference" path is exercised against a synthetic second
// package, `jde-fin-ap-only`, added ONLY inside a temp copy of the repo
// (never to the real `packages/` directory) selecting a strict subset of
// jde-fin's servers. Its `generated/packages/<id>.selection.json` is
// hand-written rather than produced by `forge codegen`, matching how
// `package.test.ts` treats that file as already-compiled input this command
// reads, never re-derives.

import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findRepoRoot } from '@mcpforge/ci';
import { runSliceDiffCommand } from './slice-diff.js';

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

/** A temp copy of the real repo's manifests/generated/roles/packages, plus a synthetic subset package. */
function tempRepoWithSubsetPackage(): string {
  const root = mkdtempSync(join(tmpdir(), 'forge-slice-diff-'));
  for (const dir of ['manifests', 'generated', 'roles', 'packages', 'enums']) {
    if (existsSync(join(repoRoot, dir))) {
      cpSync(join(repoRoot, dir), join(root, dir), { recursive: true });
    }
  }
  writeFileSync(
    join(root, 'packages', 'jde-fin-ap-only.yaml'),
    [
      'apiVersion: mcpforge/v1',
      'kind: Package',
      'id: jde-fin-ap-only',
      'label: JD Edwards AP only (test fixture)',
      'blurb: A strict subset of jde-fin, selecting only the AP server.',
      'servers: [jde-fin-ap]',
      'roles:   [p2p]',
      'portal:  optional',
      '',
    ].join('\n'),
    'utf8',
  );
  mkdirSync(join(root, 'generated', 'packages'), { recursive: true });
  writeFileSync(
    join(root, 'generated', 'packages', 'jde-fin-ap-only.selection.json'),
    JSON.stringify({
      packageId: 'jde-fin-ap-only',
      label: 'JD Edwards AP only (test fixture)',
      portal: 'optional',
      servers: ['jde-fin-ap'],
      roles: ['p2p'],
      // ALL of the jde-fin-ap server's tools, since this fixture selects that
      // server whole. Keep this in step with manifests/jde/fin/ap/** — a tool
      // missing here is not a slice-diff failure, it is a stale fixture.
      toolIds: [
        'jde.ap.voucher.cancel',
        'jde.ap.voucher.create',
        'jde.ap.voucher.get',
        'jde.ap.voucher.search',
      ],
      unresolvedRoles: [],
    }),
    'utf8',
  );
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('forge slice-diff', () => {
  it('refuses when either package id is missing', async () => {
    const codeNoArgs = await runSliceDiffCommand(undefined, undefined, { json: true });
    expect(codeNoArgs).toBe(64);
    const codeOneArg = await runSliceDiffCommand('jde-fin', undefined, { json: true });
    expect(codeOneArg).toBe(64);
  });

  it('refuses an unknown package on either side, naming which side', async () => {
    const out = captureStdout();
    const code = await runSliceDiffCommand('jde-fin', 'no-such-package', {
      json: true,
      root: repoRoot,
    });
    out.restore();
    expect(code).toBe(64);
    const parsed = JSON.parse(out.text()) as { code: string; message: string };
    expect(parsed.code).toBe('PACKAGE_NOT_FOUND');
    expect(parsed.message).toContain('side B');
  });

  it('diffing a package against itself: every file matches, no unexplained difference', async () => {
    const out = mkdtempSync(join(tmpdir(), 'mcpforge-slice-diff-self-'));
    dirs.push(out);

    const captured = captureStdout();
    const code = await runSliceDiffCommand('jde-fin', 'jde-fin', {
      json: true,
      root: repoRoot,
      out,
    });
    captured.restore();
    expect(code).toBe(0);

    const report = JSON.parse(captured.text()) as {
      ok: true;
      onlyInA: string[];
      onlyInB: string[];
      files: { path: string; inA: boolean; inB: boolean; identical: boolean }[];
      serverDiff: { onlyInA: string[]; onlyInB: string[] };
      reportFile: string;
      markdown: string;
    };
    expect(report.ok).toBe(true);
    expect(report.onlyInA).toEqual([]);
    expect(report.onlyInB).toEqual([]);
    expect(report.serverDiff.onlyInA).toEqual([]);
    expect(report.serverDiff.onlyInB).toEqual([]);
    expect(report.files.length).toBeGreaterThan(0);
    for (const f of report.files) {
      expect(f.inA).toBe(true);
      expect(f.inB).toBe(true);
      expect(f.identical).toBe(true);
    }
    // The short markdown report, emitted as evidence (02 §6.4).
    expect(existsSync(report.reportFile)).toBe(true);
    expect(readFileSync(report.reportFile, 'utf8')).toBe(report.markdown);
    expect(report.markdown).toContain('Verdict: PASS');
  });

  it('a genuine subset package: the difference is exactly explained by the server-list difference', async () => {
    const root = tempRepoWithSubsetPackage();
    dirs.push(root);
    const out = mkdtempSync(join(tmpdir(), 'mcpforge-slice-diff-subset-'));
    dirs.push(out);

    const captured = captureStdout();
    const code = await runSliceDiffCommand('jde-fin', 'jde-fin-ap-only', {
      json: true,
      root,
      out,
    });
    captured.restore();
    expect(code).toBe(0);

    const report = JSON.parse(captured.text()) as {
      ok: true;
      onlyInA: string[];
      onlyInB: string[];
      serverDiff: { onlyInA: string[]; onlyInB: string[] };
    };
    expect(report.ok).toBe(true);
    // jde-fin has jde-fin-gl and jde-scm-po that jde-fin-ap-only lacks.
    expect(report.serverDiff.onlyInA.sort()).toEqual(['jde-fin-gl', 'jde-scm-po']);
    expect(report.serverDiff.onlyInB).toEqual([]);
    // Every file only in jde-fin must belong to one of those two servers
    // (its manifest file, or a GL/PO tool's manifest or generated artefacts)
    // or be the package's own identity/derived-index files.
    expect(report.onlyInA.length).toBeGreaterThan(0);
    for (const path of report.onlyInA) {
      const isServerManifest =
        path === 'manifests/_servers/jde-fin-gl.server.yaml' ||
        path === 'manifests/_servers/jde-scm-po.server.yaml';
      // Membership is decided by the tool's SERVER, not by an enumerated list
      // of the tools that happened to exist when this test was written — an
      // enumeration goes stale the moment a GL or PO tool is added (it did,
      // at W0-I3/W0-I5), and a stale enumeration turns a correct slice diff
      // into a red test. Generated artefacts are keyed by tool id; source
      // manifests live under the server's own directory.
      const isGlOrPoTool =
        path.includes('/jde.fin.') ||
        path.includes('/jde.scm.') ||
        path.startsWith('manifests/jde/fin/gl/') ||
        path.startsWith('manifests/jde/scm/po/');
      const isPackageIdentity =
        path === 'packages/jde-fin.yaml' || path === 'generated/packages/jde-fin.selection.json';
      const isDerivedIndex = path === 'generated/index/catalogue-index.json';
      expect(isServerManifest || isGlOrPoTool || isPackageIdentity || isDerivedIndex).toBe(true);
    }
    // B's own package-identity files are always only-in-B (its id is
    // embedded in the filename), never a proof failure.
    expect(report.onlyInB.sort()).toEqual([
      'generated/packages/jde-fin-ap-only.selection.json',
      'packages/jde-fin-ap-only.yaml',
    ]);
  });

  it('fails closed when a file present on both sides has different bytes (SLICE_HASH_MISMATCH)', async () => {
    const rootA = repoRoot;
    const rootB = mkdtempSync(join(tmpdir(), 'forge-slice-diff-tampered-'));
    dirs.push(rootB);
    for (const dir of ['manifests', 'generated', 'roles', 'packages', 'enums']) {
      if (existsSync(join(repoRoot, dir))) {
        cpSync(join(repoRoot, dir), join(rootB, dir), { recursive: true });
      }
    }
    // Tamper a byte-copied manifest file that both sides would otherwise
    // share verbatim, WITHOUT changing the package/server selection itself
    // — a build-pipeline bug, not a package-authoring one.
    const tamperedPath = join(rootB, 'manifests', 'jde', 'fin', 'ap', 'voucher.get.tool.yaml');
    writeFileSync(
      tamperedPath,
      `${readFileSync(tamperedPath, 'utf8')}\n# tampered for test\n`,
      'utf8',
    );

    const out = mkdtempSync(join(tmpdir(), 'mcpforge-slice-diff-mismatch-'));
    dirs.push(out);

    const captured = captureStdout();
    const code = await runSliceDiffCommand('jde-fin', 'jde-fin', {
      json: true,
      aRoot: rootA,
      bRoot: rootB,
      out,
    });
    captured.restore();
    expect(code).toBe(1);
    const parsed = JSON.parse(captured.text()) as { ok: false; code: string; message: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('SLICE_HASH_MISMATCH');
    expect(parsed.message).toContain('voucher.get.tool.yaml');
  });

  it('fails closed when a difference is not explained by the server-list difference (SLICE_UNEXPLAINED_DIFFERENCE)', async () => {
    const root = tempRepoWithSubsetPackage();
    dirs.push(root);
    // A second subset package, declaring the SAME server list as
    // jde-fin-ap-only but quietly widening its tool selection to a GL tool
    // it never declared jde-fin-gl for — exactly the hidden per-customer
    // transformation this proof exists to catch: the file difference this
    // creates cannot be attributed to any server-list difference, because
    // there isn't one.
    writeFileSync(
      join(root, 'packages', 'jde-fin-ap-only-wide.yaml'),
      [
        'apiVersion: mcpforge/v1',
        'kind: Package',
        'id: jde-fin-ap-only-wide',
        'label: JD Edwards AP only, quietly widened (test fixture)',
        'blurb: Same server list as jde-fin-ap-only, one extra tool not covered by it.',
        'servers: [jde-fin-ap]',
        'roles:   [p2p]',
        'portal:  optional',
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      join(root, 'generated', 'packages', 'jde-fin-ap-only-wide.selection.json'),
      JSON.stringify({
        packageId: 'jde-fin-ap-only-wide',
        label: 'JD Edwards AP only, quietly widened (test fixture)',
        portal: 'optional',
        servers: ['jde-fin-ap'],
        roles: ['p2p'],
        toolIds: [
          'jde.ap.voucher.cancel',
          'jde.ap.voucher.create',
          'jde.ap.voucher.get',
          'jde.ap.voucher.search',
          'jde.fin.gl_journal.search',
        ],
        unresolvedRoles: [],
      }),
      'utf8',
    );
    const out = mkdtempSync(join(tmpdir(), 'mcpforge-slice-diff-unexplained-'));
    dirs.push(out);

    const captured = captureStdout();
    const code = await runSliceDiffCommand('jde-fin-ap-only', 'jde-fin-ap-only-wide', {
      json: true,
      root,
      out,
    });
    captured.restore();
    expect(code).toBe(1);
    const parsed = JSON.parse(captured.text()) as { ok: false; code: string; message: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('SLICE_UNEXPLAINED_DIFFERENCE');
    expect(parsed.message).toContain('gl_journal');
  });
});
