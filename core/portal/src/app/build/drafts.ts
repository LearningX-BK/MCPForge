// MCPForge — W0-P3c: where Build's drafts come from. Server-only.
//
// W0-P2 §7 item 2: definitional reads stay on git. A Build draft IS a change
// proposal: `DraftEditor`'s Save draft commits the manifest to a
// `forge/build-<tool>` branch through the ChangeHost. So the draft list is the
// ChangeHost's open proposals on those branches, and a draft's text is the
// manifest file as its branch holds it. No draft is ever typed into this file.
//
// `/build/new?from=<toolId>` starts a draft from a tool's COMMITTED manifest,
// read straight from `manifests/**` in this working tree.

import { readFileSync } from 'node:fs';
import { loadManifestFiles } from '@mcpforge/codegen/validate';
import { parse as parseYaml } from 'yaml';

import { serverChangeHost } from '@/lib/change-host/server';
import type { ChangeProposal } from '@/lib/change-host/types';

import { resolveRepoRoot } from './_lib/repo-root';
import type { BuildDraft } from './types';

/** The branch prefix `DraftEditor` saves Build drafts under. */
export const BUILD_BRANCH_PREFIX = 'forge/build-';

type HostRead<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string; readonly next: string };

/** The read surface this module needs: `serverChangeHost`, or a test double. */
export interface DraftHost {
  listProposals(): Promise<HostRead<readonly ChangeProposal[]>>;
  getProposal(id: string): Promise<HostRead<ChangeProposal | undefined>>;
  diff(id: string): Promise<HostRead<{ readonly manifest: readonly { readonly path: string }[] }>>;
  readFile(id: string, path: string): Promise<HostRead<string | undefined>>;
}

export type DraftListResult =
  | { readonly kind: 'ok'; readonly drafts: readonly BuildDraft[] }
  | { readonly kind: 'unavailable'; readonly message: string; readonly next: string };

function idFromYaml(yaml: string): string | undefined {
  try {
    const doc = parseYaml(yaml) as { id?: unknown } | null;
    return typeof doc?.id === 'string' ? doc.id : undefined;
  } catch {
    return undefined;
  }
}

async function toDraft(host: DraftHost, proposal: ChangeProposal): Promise<BuildDraft | undefined> {
  const diff = await host.diff(proposal.id);
  if (!diff.ok) return undefined;
  const path = diff.value.manifest.find((f) => f.path.endsWith('.tool.yaml'))?.path;
  if (path === undefined) return undefined;
  const text = await host.readFile(proposal.id, path);
  if (!text.ok || text.value === undefined) return undefined;
  return {
    id: proposal.id,
    title: proposal.title,
    branch: proposal.branch,
    state: proposal.state,
    toolId: idFromYaml(text.value) ?? proposal.branch.slice(BUILD_BRANCH_PREFIX.length),
    yaml: text.value,
    manifestPath: path,
  };
}

const isOpenBuildDraft = (p: ChangeProposal): boolean =>
  p.branch.startsWith(BUILD_BRANCH_PREFIX) && (p.state === 'draft' || p.state === 'in_review');

/**
 * Every open Build draft: a proposal on a `forge/build-*` branch that is a
 * draft or in review and changes a tool manifest. A merged one is not listed:
 * it is on the base branch now, and the Catalog shows it.
 */
export async function listBuildDrafts(host: DraftHost = serverChangeHost): Promise<DraftListResult> {
  const listed = await host.listProposals();
  if (!listed.ok) return { kind: 'unavailable', message: listed.message, next: listed.next };
  const drafts: BuildDraft[] = [];
  for (const proposal of listed.value.filter(isOpenBuildDraft)) {
    const draft = await toDraft(host, proposal);
    if (draft !== undefined) drafts.push(draft);
  }
  return { kind: 'ok', drafts };
}

/** One Build draft by proposal id, or `undefined` when there is no such open draft. */
export async function findBuildDraft(
  id: string,
  host: DraftHost = serverChangeHost,
): Promise<BuildDraft | undefined> {
  const found = await host.getProposal(id);
  if (!found.ok || found.value === undefined || !isOpenBuildDraft(found.value)) return undefined;
  return toDraft(host, found.value);
}

/**
 * A tool's committed manifest, verbatim, and where it lives: the starting
 * point for a draft that changes an existing tool. `undefined` when no
 * committed manifest has that id.
 */
export function loadCommittedManifest(
  toolId: string,
  repoRoot: string = resolveRepoRoot(),
): { readonly yaml: string; readonly path: string } | undefined {
  for (const file of loadManifestFiles(repoRoot)) {
    const doc = file.doc as { kind?: unknown; id?: unknown } | null | undefined;
    if (doc?.kind === 'Tool' && doc.id === toolId) {
      return { yaml: readFileSync(file.absPath, 'utf8'), path: file.file };
    }
  }
  return undefined;
}
