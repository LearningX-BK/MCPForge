// MCPForge — W0-P3c: `/environments/packages` reads git, not a fixture.
//
// W0-P2 §7 item 2 (owner decision, 25 Sep 2026): definitional reads stay on
// git. A package is `packages/<id>.yaml` (the selection a human wrote) plus
// `generated/packages/<id>.selection.json` (what codegen compiled it to, the
// committed and CI-verified artefact). Every number on the page is counted from
// those two files and the tool manifests they name. Nothing is typed in:
//
//  - servers, tool count, roles: the compiled selection;
//  - binding types present: the `binding.type` of each selected tool's manifest;
//  - not included: module servers defined in `manifests/_servers/` that this
//    package does not select. That is what "not included" can honestly mean
//    from git; a list of product names nobody wrote down is not.
//
// Server-only (`node:fs`).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifestFiles } from '@mcpforge/codegen/validate';
import { parse as parseYaml } from 'yaml';

import { resolveRepoRoot } from '../../build/_lib/repo-root';
import type { PackageSummary } from '../types';

interface PackageFile {
  readonly id?: unknown;
  readonly label?: unknown;
  readonly blurb?: unknown;
}

interface SelectionFile {
  readonly servers?: unknown;
  readonly roles?: unknown;
  readonly toolIds?: unknown;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

/** Every package in `packages/`, summarised from git. Sorted by id. */
export function loadPackagesFromGit(
  repoRoot: string = resolveRepoRoot(),
): readonly PackageSummary[] {
  const dir = join(repoRoot, 'packages');
  if (!existsSync(dir)) return [];

  // One pass over the manifests: tool id -> binding type, and every server id.
  const bindingTypeByTool = new Map<string, string>();
  const allServers = new Set<string>();
  for (const file of loadManifestFiles(repoRoot)) {
    const doc = file.doc as
      { kind?: unknown; id?: unknown; binding?: { type?: unknown } } | null | undefined;
    if (doc === null || doc === undefined || typeof doc.id !== 'string') continue;
    if (doc.kind === 'Tool' && typeof doc.binding?.type === 'string') {
      bindingTypeByTool.set(doc.id, doc.binding.type);
    } else if (doc.kind === 'Server') {
      allServers.add(doc.id);
    }
  }

  const summaries: PackageSummary[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;
    const pkg = (parseYaml(readFileSync(join(dir, entry), 'utf8')) ?? {}) as PackageFile;
    if (typeof pkg.id !== 'string') continue;

    const selectionPath = join(repoRoot, 'generated', 'packages', `${pkg.id}.selection.json`);
    const selection: SelectionFile = existsSync(selectionPath)
      ? (JSON.parse(readFileSync(selectionPath, 'utf8')) as SelectionFile)
      : {};
    const servers = strings(selection.servers);
    const toolIds = strings(selection.toolIds);
    const bindingTypes = [
      ...new Set(
        toolIds.map((id) => bindingTypeByTool.get(id)).filter((t): t is string => t !== undefined),
      ),
    ].sort();

    summaries.push({
      id: pkg.id,
      label: text(pkg.label, pkg.id),
      blurb: text(pkg.blurb, ''),
      servers,
      roleCount: strings(selection.roles).length,
      bindingTypesPresent: bindingTypes,
      toolCount: toolIds.length,
      notIncluded: [...allServers].filter((s) => !servers.includes(s)).sort(),
      compiled: existsSync(selectionPath),
    });
  }
  return summaries;
}
