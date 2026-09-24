// MCPForge — `forge slice-diff <a> <b>`. W0-K5, 02 §6.4.
//
//   forge slice-diff <packageA> <packageB> [--root <dir>] [--out <dir>] [--json]
//
// 02 §6.4 names four things the P1 proof produces. This command produces the
// three of them that are in scope at Wave 0 (02 §10.5 records why item 1,
// container-digest equality, is a Wave 1 upgrade — there is no image
// registry yet, so `forge package`'s local build output is compared by file
// hash instead, "the same invariant one notch weaker"):
//
//   2. Manifest hash table — every file `forge package` copied for A and for
//      B, sha256'd. Every path present in both must be byte-identical.
//   3. The difference, characterised — the set difference between A's and
//      B's file sets must be EXACTLY the set difference of their package
//      server lists, expanded to files. A file in the difference this
//      command cannot attribute to a server present in one side and absent
//      from the other is a proof failure (`SLICE_UNEXPLAINED_DIFFERENCE`).
//   4. Overlay diff is out of scope here — Wave 0 has no per-deployment
//      overlay wired to a package selection yet; nothing in 02 §6.4 or §10.5
//      asks this command to invent one.
//
// This command builds both sides itself, through `buildPackageArtifact` —
// the exact function `forge package` calls — so there is exactly one code
// path that resolves a package selection and copies its files, never a
// second, diff-specific reimplementation of that logic.
//
// Two paths are deliberately EXCLUDED from the "must be identical" and
// "must be explained by the server-list diff" checks, both because they are
// by-construction always different between two DIFFERENT package ids rather
// than being part of "the difference" 02 §6.4 item 3 means:
//   - `packages/<id>.yaml` and `generated/packages/<id>.selection.json` —
//     the package's own id is embedded in the filename, so these two paths
//     never collide between A and B in the first place.
//   - `generated/index/catalogue-index.json` — 02 §6.2 states this file is
//     DERIVED per selection ("deterministic per selection... when a
//     selection happens to equal the full catalogue, the two index files
//     are byte-identical too"), i.e. it is expected to differ whenever the
//     selections differ. It is still reported in the hash table (so a
//     reader can see it), but a mismatch there is informational, never a
//     proof failure, and it plays no part in the "explained by server-list
//     diff" accounting below.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifestFiles, resolvedKindAndId } from '@mcpforge/codegen/validate';
import { buildPackageArtifact, type PackageCliError, type PackageReport } from './package.js';

export interface SliceDiffOptions {
  readonly json: boolean;
  /** Repo root for both sides, unless overridden per side below. */
  readonly root?: string;
  /** Override which repo checkout side A builds from. Default: `root`. */
  readonly aRoot?: string;
  /** Override which repo checkout side B builds from. Default: `root`. Two deployments normally share one catalogue commit — this exists for comparing across checkouts (e.g. two deployed commits) rather than being routine. */
  readonly bRoot?: string;
  readonly out?: string;
}

export interface SliceDiffCliError {
  readonly ok: false;
  readonly code:
    | 'INPUT_INVALID'
    | 'PACKAGE_NOT_FOUND'
    | 'PACKAGE_ARTEFACT_MISSING'
    | 'SLICE_HASH_MISMATCH'
    | 'SLICE_UNEXPLAINED_DIFFERENCE';
  readonly message: string;
  readonly next: string;
}

interface FileHashRow {
  /** Repo-relative (to each artefact's outDir), forward-slash path. */
  readonly path: string;
  readonly inA: boolean;
  readonly inB: boolean;
  readonly shaA: string | null;
  readonly shaB: string | null;
  /** `true` for a path present in both with equal hashes, or absent from one side. `false` is a real byte mismatch. */
  readonly identical: boolean;
  /** The derived, selection-scoped index — excluded from the identical/explained checks (see file header). */
  readonly derivedIndex: boolean;
}

interface SideSummary {
  readonly packageId: string;
  readonly servers: readonly string[];
  readonly roles: readonly string[];
  readonly toolIds: readonly string[];
}

export interface SliceDiffReport {
  readonly ok: true;
  readonly a: SideSummary;
  readonly b: SideSummary;
  /** Sorted by path. */
  readonly files: readonly FileHashRow[];
  readonly onlyInA: readonly string[];
  readonly onlyInB: readonly string[];
  readonly serverDiff: { readonly onlyInA: readonly string[]; readonly onlyInB: readonly string[] };
  readonly markdown: string;
  readonly reportFile: string;
}

const USAGE_EXIT_CODE = 64;
const PROOF_FAILURE_EXIT_CODE = 1;
const DERIVED_INDEX_PATH = 'generated/index/catalogue-index.json';

function usageError(message: string): SliceDiffCliError {
  return {
    ok: false,
    code: 'INPUT_INVALID',
    message,
    next: 'Run "forge slice-diff <packageA> <packageB> [--root <dir>] [--out <dir>] [--json]".',
  };
}

function fromPackageError(side: 'A' | 'B', error: PackageCliError): SliceDiffCliError {
  return { ok: false, code: error.code, message: `[side ${side}] ${error.message}`, next: error.next };
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function emitError(error: SliceDiffCliError, json: boolean, exitCode: number): number {
  if (json) {
    process.stdout.write(`${JSON.stringify(error)}\n`);
  } else {
    process.stderr.write(`forge: slice-diff — ${error.message}\n`);
    process.stderr.write(`forge: next — ${error.next}\n`);
  }
  return exitCode;
}

function toSummary(report: PackageReport): SideSummary {
  return { packageId: report.packageId, servers: report.servers, roles: report.roles, toolIds: report.toolIds };
}

/**
 * Which server "owns" a copied file, for the purpose of explaining a set
 * difference. Returns `null` for a file this command cannot attribute to
 * any single server (a role-owned file, or anything unrecognised) — such a
 * file can never be "explained by the server-list difference" and, if it
 * turns up only on one side, is a proof failure.
 */
function buildFileOwners(
  root: string,
  report: PackageReport,
): { readonly ownerByFile: ReadonlyMap<string, string> } {
  const files = loadManifestFiles(root);
  const toolServerById = new Map<string, string>();
  for (const file of files) {
    const resolved = resolvedKindAndId(file);
    if (!resolved || resolved.kind !== 'Tool') continue;
    const doc = file.doc as { server?: unknown } | null;
    if (typeof doc?.server === 'string') toolServerById.set(resolved.id, doc.server);
  }

  const ownerByFile = new Map<string, string>();
  for (const server of report.servers) {
    ownerByFile.set(`manifests/_servers/${server}.server.yaml`, server);
  }
  for (const toolId of report.toolIds) {
    const server = toolServerById.get(toolId);
    if (!server) continue;
    for (const path of report.filesCopied) {
      if (
        path === `generated/tools/${toolId}` ||
        path.startsWith(`generated/tools/${toolId}/`) ||
        path === `generated/cards/${toolId}.json` ||
        path === `generated/docs/tools/${toolId}.md`
      ) {
        ownerByFile.set(path, server);
      }
      // The tool's own manifest file — found by scanning is unnecessary;
      // `resolvedKindAndId`'s file path is already repo-relative and posix.
    }
  }
  for (const file of files) {
    const resolved = resolvedKindAndId(file);
    if (resolved?.kind === 'Tool' && toolServerById.has(resolved.id)) {
      ownerByFile.set(file.file, toolServerById.get(resolved.id)!);
    }
  }
  return { ownerByFile };
}

function isPackageIdentityFile(path: string, packageId: string): boolean {
  return path === `packages/${packageId}.yaml` || path === `generated/packages/${packageId}.selection.json`;
}

function buildMarkdown(
  report: {
    readonly a: SideSummary;
    readonly b: SideSummary;
    readonly files: readonly FileHashRow[];
    readonly onlyInA: readonly string[];
    readonly onlyInB: readonly string[];
    readonly serverDiff: { readonly onlyInA: readonly string[]; readonly onlyInB: readonly string[] };
  },
  verdict: 'PASS',
): string {
  const identicalCount = report.files.filter((f) => f.inA && f.inB && !f.derivedIndex).length;
  const lines: string[] = [
    `# slice-diff: ${report.a.packageId} vs ${report.b.packageId}`,
    '',
    `**Verdict: ${verdict}** — the P1 no-fork proof (02 §6.4), Wave 0 file-hash form (02 §10.5).`,
    '',
    `- Files common to both, byte-identical: ${identicalCount}`,
    `- Files only in ${report.a.packageId}: ${report.onlyInA.length}`,
    `- Files only in ${report.b.packageId}: ${report.onlyInB.length}`,
    `- Server-list difference: only in ${report.a.packageId} = [${report.serverDiff.onlyInA.join(', ')}], only in ${report.b.packageId} = [${report.serverDiff.onlyInB.join(', ')}]`,
    '',
    'Every file the set difference contains is explained by the server-list',
    'difference above. Container-digest equality (02 §6.4 item 1) is a Wave 1',
    'upgrade once a registry exists (02 §10.5) — this proof compares local',
    '`forge package` build output by sha256 instead.',
  ];
  if (report.onlyInA.length > 0) {
    lines.push('', `## Only in ${report.a.packageId}`, ...report.onlyInA.map((p) => `- ${p}`));
  }
  if (report.onlyInB.length > 0) {
    lines.push('', `## Only in ${report.b.packageId}`, ...report.onlyInB.map((p) => `- ${p}`));
  }
  return `${lines.join('\n')}\n`;
}

function formatReportHuman(report: SliceDiffReport): string {
  return [
    `forge slice-diff ${report.a.packageId} ${report.b.packageId}: OK — no-fork proof holds.`,
    `  files common & identical: ${report.files.filter((f) => f.inA && f.inB && !f.derivedIndex).length}`,
    `  only in ${report.a.packageId}: ${report.onlyInA.length}`,
    `  only in ${report.b.packageId}: ${report.onlyInB.length}`,
    `  report: ${report.reportFile}`,
  ].join('\n');
}

/**
 * `forge slice-diff <a> <b> [--root <dir>] [--out <dir>] [--json]`.
 *
 * Builds both packages via `buildPackageArtifact`, sha256's every file
 * either side copied, asserts every path present in both is byte-identical
 * (the derived selection-scoped index excepted — see file header), and
 * asserts the set difference is exactly explained by the two packages'
 * server-list difference, expanded to files. Emits a short markdown report
 * alongside the JSON/human summary.
 */
export async function runSliceDiffCommand(
  aId: string | undefined,
  bId: string | undefined,
  opts: SliceDiffOptions,
): Promise<number> {
  const json = opts.json;
  const a = aId?.trim();
  const b = bId?.trim();
  if (!a || !b) {
    return emitError(
      usageError('Two package ids are required, e.g. "forge slice-diff jde-fin jde-fin".'),
      json,
      USAGE_EXIT_CODE,
    );
  }

  const root = opts.root?.trim() || process.cwd();
  const rootA = opts.aRoot?.trim() || root;
  const rootB = opts.bRoot?.trim() || root;
  const base = opts.out?.trim() || join(root, '.forge-build', 'slice-diff', `${a}__${b}`);
  const outA = join(base, 'a');
  const outB = join(base, 'b');

  const [reportA, reportB] = await Promise.all([
    buildPackageArtifact(a, { root: rootA, out: outA }),
    buildPackageArtifact(b, { root: rootB, out: outB }),
  ]);
  if (!reportA.ok) return emitError(fromPackageError('A', reportA), json, USAGE_EXIT_CODE);
  if (!reportB.ok) return emitError(fromPackageError('B', reportB), json, USAGE_EXIT_CODE);

  // 1. The manifest hash table.
  const pathsA = new Set(reportA.filesCopied);
  const pathsB = new Set(reportB.filesCopied);
  const allPaths = [...new Set([...pathsA, ...pathsB])].sort();

  const files: FileHashRow[] = allPaths.map((path) => {
    const inA = pathsA.has(path);
    const inB = pathsB.has(path);
    const shaA = inA ? sha256File(join(outA, path)) : null;
    const shaB = inB ? sha256File(join(outB, path)) : null;
    const derivedIndex = path === DERIVED_INDEX_PATH;
    const identical = derivedIndex ? true : !inA || !inB || shaA === shaB;
    return { path, inA, inB, shaA, shaB, identical, derivedIndex };
  });

  // 2. Every file present in both must be byte-identical (derived index excepted).
  const mismatches = files.filter((f) => f.inA && f.inB && !f.identical);
  if (mismatches.length > 0) {
    return emitError(
      {
        ok: false,
        code: 'SLICE_HASH_MISMATCH',
        message: `${mismatches.length} file(s) present in both "${a}" and "${b}" have different bytes: ${mismatches
          .map((m) => m.path)
          .join(', ')}.`,
        next:
          '02 §6.2\'s invariant is that a file present in two selections is byte-identical in both. Investigate why forge codegen or forge package produced different bytes for the same repo-relative path — this is a build-pipeline bug, not a package-authoring one.',
      },
      json,
      PROOF_FAILURE_EXIT_CODE,
    );
  }

  // 3. The difference, characterised — must equal the server-list difference, expanded to files.
  const onlyInA = files.filter((f) => f.inA && !f.inB).map((f) => f.path);
  const onlyInB = files.filter((f) => f.inB && !f.inA).map((f) => f.path);

  const serversA = new Set(reportA.servers);
  const serversB = new Set(reportB.servers);
  const serverOnlyInA = reportA.servers.filter((s) => !serversB.has(s));
  const serverOnlyInB = reportB.servers.filter((s) => !serversA.has(s));

  const { ownerByFile: ownerByFileA } = buildFileOwners(rootA, reportA);
  const { ownerByFile: ownerByFileB } = buildFileOwners(rootB, reportB);
  const serverOnlyInASet = new Set(serverOnlyInA);
  const serverOnlyInBSet = new Set(serverOnlyInB);

  const unexplainedInA = onlyInA.filter((path) => {
    if (path === DERIVED_INDEX_PATH || isPackageIdentityFile(path, a)) return false;
    const owner = ownerByFileA.get(path);
    return !owner || !serverOnlyInASet.has(owner);
  });
  const unexplainedInB = onlyInB.filter((path) => {
    if (path === DERIVED_INDEX_PATH || isPackageIdentityFile(path, b)) return false;
    const owner = ownerByFileB.get(path);
    return !owner || !serverOnlyInBSet.has(owner);
  });

  if (unexplainedInA.length > 0 || unexplainedInB.length > 0) {
    const named = [
      ...unexplainedInA.map((p) => `${p} (only in ${a})`),
      ...unexplainedInB.map((p) => `${p} (only in ${b})`),
    ];
    return emitError(
      {
        ok: false,
        code: 'SLICE_UNEXPLAINED_DIFFERENCE',
        message: `${named.length} file(s) differ between "${a}" and "${b}" without being explained by their server-list difference (only-in-${a}: [${serverOnlyInA.join(', ')}], only-in-${b}: [${serverOnlyInB.join(', ')}]): ${named.join(', ')}.`,
        next:
          'This is the P1 proof failing (02 §6.4 item 3): a per-customer transformation or a role-list divergence that a package server-list diff alone does not account for. Fix the package definitions so servers are the only thing that differs, or, if a role divergence is deliberate, that is a design decision this task is not authorized to make silently — flag it.',
      },
      json,
      PROOF_FAILURE_EXIT_CODE,
    );
  }

  const summaryA = toSummary(reportA);
  const summaryB = toSummary(reportB);
  const serverDiff = { onlyInA: serverOnlyInA, onlyInB: serverOnlyInB };
  const markdown = buildMarkdown(
    { a: summaryA, b: summaryB, files, onlyInA, onlyInB, serverDiff },
    'PASS',
  );
  const reportFile = join(base, 'slice-diff-report.md');
  mkdirSync(base, { recursive: true });
  writeFileSync(reportFile, markdown, 'utf8');

  const report: SliceDiffReport = {
    ok: true,
    a: summaryA,
    b: summaryB,
    files,
    onlyInA,
    onlyInB,
    serverDiff,
    markdown,
    reportFile,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(`${formatReportHuman(report)}\n`);
  }
  return 0;
}
