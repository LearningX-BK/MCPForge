// MCPForge — W0-Q5: read tracked requests and the facts their state derives
// from. Server-only (`node:fs`). Everything is read from git-backed artefacts;
// nothing is stored here (note §1, §3).
//
// Sources: `requests/*.request.yaml` in the working tree, plus the file on each
// open `forge/req-*` proposal branch (a submitted request is visible before it
// merges). Facts: tool manifests, `approvals/`, the committed discovery index,
// the latest probe report, and the open proposals.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { loadManifestFiles } from '@mcpforge/codegen/validate';

import { resolveRepoRoot } from '../../build/_lib/repo-root';
import { serverChangeHost } from '@/lib/change-host/server';
import { deriveRequestState, type Derivation, type RequestFacts } from './derive-state';
import {
  draftBranchForTool,
  parseRequestYaml,
  requestBranch,
  requestPath,
  type RequestFile,
} from './request-file';

export interface TrackedRequest {
  readonly request: RequestFile;
  readonly derivation: Derivation;
  /** The change proposal carrying the request file, while it is still open. */
  readonly submissionProposalId: string | undefined;
  /** The Build draft/proposal for the intended tool, once one exists. */
  readonly draftProposalId: string | undefined;
}

export interface RequestProblem {
  readonly path: string;
  readonly message: string;
  readonly next: string;
}

export interface RequestsSnapshot {
  readonly requests: readonly TrackedRequest[];
  /** Files that could not be read as a Request: shown, never silently dropped. */
  readonly problems: readonly RequestProblem[];
}

interface ProposalLite {
  readonly id: string;
  readonly branch: string;
  readonly state: string;
}

/** The change-host reads this module needs, injectable for tests. */
export interface RequestPorts {
  listProposals(): Promise<readonly ProposalLite[]>;
  readFile(proposalId: string, path: string): Promise<string | undefined>;
}

const defaultPorts: RequestPorts = {
  async listProposals() {
    const r = await serverChangeHost.listProposals();
    return r.ok ? r.value : [];
  },
  async readFile(id, path) {
    const r = await serverChangeHost.readFile(id, path);
    return r.ok ? r.value : undefined;
  },
};

function readYaml(path: string): unknown {
  try {
    return parseYaml(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Tool ids named by `approvals/*.yaml` (`subject.id`). */
function approvedToolIds(repoRoot: string): Set<string> {
  const dir = join(repoRoot, 'approvals');
  const out = new Set<string>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(f)) continue;
    const doc = readYaml(join(dir, f)) as
      { subject?: { kind?: unknown; id?: unknown }; decision?: unknown } | undefined;
    if (
      doc?.subject?.kind === 'Tool' &&
      typeof doc.subject.id === 'string' &&
      doc.decision === 'approved'
    ) {
      out.add(doc.subject.id);
    }
  }
  return out;
}

export function indexDigest(repoRoot: string): string {
  const p = join(repoRoot, 'generated', 'index', 'catalogue-index.json');
  if (!existsSync(p)) return 'sha256:absent';
  return `sha256:${createHash('sha256').update(readFileSync(p)).digest('hex')}`;
}

export async function loadRequests(
  repoRoot: string = resolveRepoRoot(),
  ports: RequestPorts = defaultPorts,
): Promise<RequestsSnapshot> {
  const problems: RequestProblem[] = [];
  const found = new Map<
    string,
    { request: RequestFile; submissionProposalId: string | undefined }
  >();

  const dir = join(repoRoot, 'requests');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.request.yaml')) continue;
      const path = `requests/${f}`;
      const parsed = parseRequestYaml(readFileSync(join(dir, f), 'utf8'), path);
      if (parsed.ok)
        found.set(parsed.request.id, { request: parsed.request, submissionProposalId: undefined });
      else problems.push({ path, message: parsed.message, next: parsed.next });
    }
  }

  const proposals = await ports.listProposals();
  for (const p of proposals) {
    if (!p.branch.startsWith('forge/req-')) continue;
    const id = p.branch.slice('forge/'.length);
    if (found.has(id)) continue; // merged: the working tree wins
    const text = await ports.readFile(p.id, requestPath(id));
    if (text === undefined) continue;
    const parsed = parseRequestYaml(text, requestPath(id));
    if (parsed.ok) found.set(id, { request: parsed.request, submissionProposalId: p.id });
    else problems.push({ path: requestPath(id), message: parsed.message, next: parsed.next });
  }

  // Facts, gathered once.
  const toolManifestIds = new Set<string>();
  for (const m of loadManifestFiles(repoRoot)) {
    const doc = m.doc as { kind?: unknown; id?: unknown } | null | undefined;
    if (doc?.kind === 'Tool' && typeof doc.id === 'string') toolManifestIds.add(doc.id);
  }
  const approved = approvedToolIds(repoRoot);
  const indexed = new Set<string>();
  const index = readYaml(join(repoRoot, 'generated', 'index', 'catalogue-index.json')) as
    { tools?: { id?: unknown }[] } | undefined;
  for (const t of index?.tools ?? []) if (typeof t.id === 'string') indexed.add(t.id);
  const probe = readYaml(join(repoRoot, '.mcpforge', 'probe-report.json')) as
    { tools?: { toolId?: unknown; status?: unknown }[] } | undefined;
  const probeStatus = new Map<string, string>();
  for (const t of probe?.tools ?? []) {
    if (typeof t.toolId === 'string' && typeof t.status === 'string')
      probeStatus.set(t.toolId, t.status);
  }

  const requests: TrackedRequest[] = [...found.values()].map(
    ({ request, submissionProposalId }) => {
      const toolId = request.governance?.intendedToolId;
      const draft =
        toolId === undefined
          ? undefined
          : proposals.find((p) => p.branch === draftBranchForTool(toolId));
      const facts: RequestFacts = {
        submissionOpen: submissionProposalId !== undefined,
        draftProposalState: draft?.state,
        manifestMerged: toolId !== undefined && toolManifestIds.has(toolId),
        approvalRecorded: toolId !== undefined && approved.has(toolId),
        inIndex: toolId !== undefined && indexed.has(toolId),
        probeStatus: toolId === undefined ? undefined : probeStatus.get(toolId),
      };
      return {
        request,
        derivation: deriveRequestState(request, facts),
        submissionProposalId,
        draftProposalId: draft?.id,
      };
    },
  );
  requests.sort((a, b) => b.request.requestedAt.localeCompare(a.request.requestedAt));
  return { requests, problems };
}

export async function loadRequest(
  id: string,
  repoRoot: string = resolveRepoRoot(),
  ports?: RequestPorts,
): Promise<TrackedRequest | undefined> {
  return (await loadRequests(repoRoot, ports)).requests.find((r) => r.request.id === id);
}

export { requestBranch };
