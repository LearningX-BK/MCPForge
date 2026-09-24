// MCPForge — `forge package <id>`. W0-K1, 02 §6.1, §6.2.
//
//   forge package jde-fin [--root <dir>] [--out <dir>] [--json]
//
// 02 §6.2's invariant: "A file present in two different catalogue artefacts
// is byte-identical in both, and identical to the same file in the full
// catalogue. The packaging step performs selection and nothing else — no
// templating, no substitution, no per-customer transformation."
//
// 02 §6.2 names exactly three things this command does:
//   1. resolve the package's server list to its manifests and generated
//      artefacts (via `generated/packages/<id>.selection.json`, W0-B8's
//      compiled selection — the union of its roles' compiled tool-id lists);
//   2. copy them unchanged (`node:fs` byte copies, never re-serialized,
//      never re-formatted — copying through the deterministic writer would
//      itself be a transformation this command is forbidden from making);
//   3. build the discovery index over just that selection — a derived file
//      whose inputs are all in the selection, so it is deterministic per
//      selection, computed the same way `forge codegen`'s pipeline computes
//      the full-catalogue index (`core/codegen/src/emit/pipeline.ts`) so
//      that, when a selection happens to equal the full catalogue, the two
//      index files are byte-identical too.
//
// The command formats and orchestrates copies; it does no manifest
// interpretation of its own beyond reading the already-compiled selection
// artefact codegen produced. Output defaults to `.forge-build/packages/<id>/`
// — lane state, not committed (CLAUDE.md §4), mirroring the repo-relative
// layout the artefact would carry inside `mcpforge-catalogue:<package>@<version>`.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
  codegenVersion,
  manifestSha256,
  provenanceJsonFields,
  serializeJsonDeterministic,
  writeGeneratedFile,
} from '@mcpforge/codegen/emit';
import { loadManifestFiles, resolvedKindAndId } from '@mcpforge/codegen/validate';
import type { CatalogueIndex, CatalogueIndexEntry } from '@mcpforge/registry/index';

export interface PackageOptions {
  readonly json: boolean;
  readonly root?: string;
  readonly out?: string;
}

export interface PackageCliError {
  readonly ok: false;
  readonly code: 'INPUT_INVALID' | 'PACKAGE_NOT_FOUND' | 'PACKAGE_ARTEFACT_MISSING';
  readonly message: string;
  readonly next: string;
}

export interface PackageReport {
  readonly ok: true;
  readonly packageId: string;
  readonly outDir: string;
  readonly servers: readonly string[];
  readonly roles: readonly string[];
  readonly toolIds: readonly string[];
  /** Repo-relative (to `outDir`), forward-slash paths, sorted. */
  readonly filesCopied: readonly string[];
  readonly indexFile: string;
}

const USAGE_EXIT_CODE = 64;

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function usageError(message: string): PackageCliError {
  return {
    ok: false,
    code: 'INPUT_INVALID',
    message,
    next: 'Run "forge package <packageId> [--root <dir>] [--out <dir>] [--json]".',
  };
}

function emitError(error: PackageCliError, json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify(error)}\n`);
  } else {
    process.stderr.write(`forge: package — ${error.message}\n`);
    process.stderr.write(`forge: next — ${error.next}\n`);
  }
  return USAGE_EXIT_CODE;
}

function formatReportHuman(report: PackageReport): string {
  return [
    `forge package ${report.packageId}: OK — selection only, ${report.filesCopied.length} file(s) copied unchanged.`,
    `  out: ${report.outDir}`,
    `  servers: ${report.servers.join(', ')}`,
    `  roles: ${report.roles.join(', ')}`,
    `  tools: ${report.toolIds.length}`,
    `  index: ${report.indexFile}`,
  ].join('\n');
}

/** Recursively collect every file under `dir` (absolute paths), skipping nothing — this is a package artefact copy, not manifest discovery. */
function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

/** Byte-copy `srcAbsPath` (found at `repoRelPath` under `root`) into `outDir` at the same repo-relative path — never re-serialized. */
function copyUnchanged(root: string, outDir: string, repoRelPath: string, copied: Set<string>): void {
  const posixRel = toPosix(repoRelPath);
  if (copied.has(posixRel)) return;
  const src = join(root, repoRelPath);
  const dest = join(outDir, repoRelPath);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
  copied.add(posixRel);
}

/**
 * Resolve `packageId`'s selection, copy its files unchanged into `outDir` and
 * build the selection-scoped index — the same three steps `forge package`
 * performs, factored out so `forge slice-diff` (W0-K5) can build both sides
 * of a diff through this identical code path rather than re-deriving
 * selection or copy logic of its own.
 *
 * Returns the same success/error shapes `runPackageCommand` emits, with no
 * stdout/stderr side effect of its own — the caller decides how to present
 * them. Refuses (`PACKAGE_NOT_FOUND`) when `packages/<id>.yaml` does not
 * exist, and (`PACKAGE_ARTEFACT_MISSING`) when `forge codegen` has not yet
 * compiled `generated/packages/<id>.selection.json` — this reads that
 * compiled selection rather than re-deriving role globs itself, so codegen
 * remains the one place role-to-tool resolution happens.
 */
export async function buildPackageArtifact(
  packageId: string | undefined,
  opts: { readonly root?: string; readonly out?: string },
): Promise<PackageReport | PackageCliError> {
  const id = packageId?.trim();
  if (!id) {
    return usageError('A package id is required, e.g. "forge package jde-fin".');
  }

  const root = opts.root?.trim() || process.cwd();
  const outDir = opts.out?.trim() || join(root, '.forge-build', 'packages', id);

  const packageManifestRel = `packages/${id}.yaml`;
  if (!existsSync(join(root, packageManifestRel))) {
    return {
      ok: false,
      code: 'PACKAGE_NOT_FOUND',
      message: `No package manifest at "${packageManifestRel}".`,
      next: `Create packages/${id}.yaml (02 §6.1: servers + roles only — no code, no manifests, no transformation), then re-run.`,
    };
  }

  const selectionRel = `generated/packages/${id}.selection.json`;
  const selectionAbs = join(root, selectionRel);
  if (!existsSync(selectionAbs)) {
    return {
      ok: false,
      code: 'PACKAGE_ARTEFACT_MISSING',
      message: `${selectionRel} does not exist.`,
      next: 'Run "forge codegen" first — it compiles the package selection (02 §6.1) that "forge package" copies from.',
    };
  }
  const selection = JSON.parse(readFileSync(selectionAbs, 'utf8')) as {
    readonly packageId: string;
    readonly servers: readonly string[];
    readonly roles: readonly string[];
    readonly toolIds: readonly string[];
    readonly unresolvedRoles: readonly string[];
  };

  const files = loadManifestFiles(root);
  const toolFileById = new Map<string, string>();
  const serverFileById = new Map<string, string>();
  const roleFileById = new Map<string, string>();
  for (const file of files) {
    const resolved = resolvedKindAndId(file);
    if (!resolved) continue;
    if (resolved.kind === 'Tool') toolFileById.set(resolved.id, file.file);
    else if (resolved.kind === 'Server') serverFileById.set(resolved.id, file.file);
    else if (resolved.kind === 'Role') roleFileById.set(resolved.id, file.file);
  }

  const copied = new Set<string>();

  // 1+2. Resolve the selection's manifests and generated artefacts; copy unchanged.
  copyUnchanged(root, outDir, packageManifestRel, copied);

  for (const roleId of selection.roles) {
    const roleFile = roleFileById.get(roleId);
    if (roleFile) copyUnchanged(root, outDir, roleFile, copied);
    const scopeRel = `generated/roles/${roleId}.scope.json`;
    if (existsSync(join(root, scopeRel))) copyUnchanged(root, outDir, scopeRel, copied);
  }

  for (const serverId of selection.servers) {
    const serverFile = serverFileById.get(serverId);
    if (serverFile) copyUnchanged(root, outDir, serverFile, copied);
  }

  for (const toolId of selection.toolIds) {
    const toolFile = toolFileById.get(toolId);
    if (toolFile) copyUnchanged(root, outDir, toolFile, copied);

    const toolDirRel = `generated/tools/${toolId}`;
    const toolDirAbs = join(root, toolDirRel);
    for (const absFile of walkFiles(toolDirAbs)) {
      copyUnchanged(root, outDir, toPosix(relative(root, absFile)), copied);
    }

    const cardRel = `generated/cards/${toolId}.json`;
    if (existsSync(join(root, cardRel))) copyUnchanged(root, outDir, cardRel, copied);

    const docsRel = `generated/docs/tools/${toolId}.md`;
    if (existsSync(join(root, docsRel))) copyUnchanged(root, outDir, docsRel, copied);
  }

  copyUnchanged(root, outDir, selectionRel, copied);

  // 3. Build the discovery index over just this selection — same computation
  // `forge codegen`'s pipeline uses for the full catalogue, restricted to
  // the selected tool ids, so a selection equal to the full catalogue
  // produces a byte-identical index file.
  const fullIndexRel = 'generated/index/catalogue-index.json';
  const fullIndexAbs = join(root, fullIndexRel);
  if (!existsSync(fullIndexAbs)) {
    return {
      ok: false,
      code: 'PACKAGE_ARTEFACT_MISSING',
      message: `${fullIndexRel} does not exist.`,
      next: 'Run "forge codegen" first — it builds generated/index/catalogue-index.json (W0-G1), which "forge package" derives the selection index from.',
    };
  }
  const fullIndex = JSON.parse(readFileSync(fullIndexAbs, 'utf8')) as CatalogueIndex;
  const selectedIds = new Set(selection.toolIds);
  const selectedEntries: CatalogueIndexEntry[] = fullIndex.tools
    .filter((t) => selectedIds.has(t.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  const toolShas: { readonly id: string; readonly sha256: string }[] = [];
  for (const toolId of selection.toolIds) {
    const toolFile = toolFileById.get(toolId);
    if (!toolFile) continue;
    const src = readFileSync(join(root, toolFile), 'utf8');
    toolShas.push({ id: toolId, sha256: manifestSha256(src) });
  }
  const combinedHash = manifestSha256(
    [...toolShas].sort((a, b) => a.id.localeCompare(b.id)).map((t) => t.sha256).join('\n'),
  );
  const version = codegenVersion();
  const indexProvenance = provenanceJsonFields({
    // Deliberately the SAME literal `manifestPath` the full-catalogue index
    // uses (`core/codegen/src/emit/pipeline.ts`) rather than a
    // selection-specific string — when the selection equals the full
    // catalogue (as it does for the only package that exists at Wave 0) the
    // two provenance headers, and therefore the two files, must be
    // byte-identical (02 §6.2's invariant), not merely equivalent.
    manifestPath: 'manifests/**/*.tool.yaml',
    manifestSha256: combinedHash,
    codegenVersion: version,
  });
  const indexContent = await serializeJsonDeterministic(
    { ...indexProvenance, tools: selectedEntries },
    root,
  );
  const outIndexAbs = join(outDir, fullIndexRel);
  writeGeneratedFile(outIndexAbs, indexContent);
  copied.add(fullIndexRel);

  const filesCopied = [...copied].sort();

  const report: PackageReport = {
    ok: true,
    packageId: id,
    outDir,
    servers: [...selection.servers].sort(),
    roles: [...selection.roles].sort(),
    toolIds: [...selection.toolIds].sort(),
    filesCopied,
    indexFile: fullIndexRel,
  };

  return report;
}

/**
 * `forge package <packageId> [--root <dir>] [--out <dir>] [--json]`.
 *
 * Refuses (64, `INPUT_INVALID`) on a missing id. Thin CLI wrapper over
 * `buildPackageArtifact` — see that function for what building the
 * selection actually does.
 */
export async function runPackageCommand(
  packageId: string | undefined,
  opts: PackageOptions,
): Promise<number> {
  const json = opts.json;
  const result = await buildPackageArtifact(packageId, opts);
  if (!result.ok) {
    return emitError(result, json);
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(`${formatReportHuman(result)}\n`);
  }
  return 0;
}
