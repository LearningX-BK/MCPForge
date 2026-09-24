// MCPForge — the change proposal a consumer-registry change produces. W0-N1.
//
// 02 §11.2 / 05 §1.3.2: a consumer registration is a GRANT, and a grant is a
// git artefact changed only through the change-proposal → approval → merge
// flow. "Registration needs no new governance machinery at all — it inherits
// the change model, the approvals queue, the approval record and the
// compiled-artefact diff discipline unchanged."
//
// THE STRUCTURAL POINT OF THIS FILE: there is no direct-write path. Every
// mutation this module can express is staged under
// `.mcpforge/proposals/<proposalId>/files/<target path>` and NEVER written to
// its target path. `assertProposalOnly` refuses any absolute path outside the
// proposal directory, and `consumer.proposal.test.ts` proves that running
// every lifecycle command leaves `consumers/**` and `approvals/**` byte-identical.
//
// WHAT IS DEFERRED, EXPLICITLY: turning a staged proposal into a branch, a
// commit and a review is `ChangeHost` (`LocalGit` now, `HostedGit` later),
// which is W0-J12 and does not exist yet — and this repository is not a git
// repository at all today. So this module produces the proposal CONTENT and
// its manifest; the act of proposing it into git is the seam W0-J12 fills.
// A staged, unproposed draft lives under `.mcpforge/` and is therefore
// disposable, exactly like an uncommitted working tree.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** A file the proposal proposes, addressed by its REPO-RELATIVE TARGET path. */
export interface ProposedFile {
  /** e.g. `consumers/agent-x.consumer.yaml`, `approvals/2026-09-06-....yaml`. */
  readonly path: string;
  readonly content: string;
}

export type ConsumerChangeKind =
  'consumer-registration' | 'consumer-suspend' | 'consumer-retire' | 'consumer-rotate';

export interface ChangeProposal {
  readonly id: string;
  readonly kind: ConsumerChangeKind;
  readonly consumerId: string;
  readonly summary: string;
  /** `Principal.subject` of whoever is asking. Never defaulted (CLAUDE.md #1). */
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly reason?: string;
  readonly files: readonly ProposedFile[];
}

export interface WrittenProposalFile {
  /** Where the file is STAGED (absolute). */
  readonly stagedPath: string;
  /** Where it is proposed to land, once reviewed, approved and merged. */
  readonly targetPath: string;
}

export interface WrittenProposal {
  readonly proposalId: string;
  readonly directory: string;
  readonly manifestPath: string;
  readonly files: readonly WrittenProposalFile[];
}

/** Paths a proposal may propose to change. Anything else is refused. */
const PROPOSABLE_PREFIXES = ['consumers/', 'approvals/'] as const;

export class DirectWriteRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DirectWriteRefusedError';
  }
}

export function proposalsRoot(repoRoot: string): string {
  return join(repoRoot, '.mcpforge', 'proposals');
}

export function proposalDirectory(repoRoot: string, proposalId: string): string {
  return join(proposalsRoot(repoRoot), proposalId);
}

/**
 * Refuse any write that would land outside this proposal's staging directory.
 * The guard is by resolved path, not by string prefix, so `..` in a target
 * path cannot escape into `consumers/` or anywhere else in the working tree.
 */
export function assertProposalOnly(repoRoot: string, proposalId: string, absPath: string): void {
  const root = resolve(proposalDirectory(repoRoot, proposalId));
  const target = resolve(absPath);
  const rel = relative(root, target);
  if (rel === '' || rel.startsWith('..') || rel.startsWith(`..${sep}`)) {
    throw new DirectWriteRefusedError(
      `Refused to write ${target}: a consumer-registry change is a grant and may only be staged under ${root} as a change proposal. There is no direct-write path to consumers/ or approvals/ (02 §11.2).`,
    );
  }
}

function assertProposable(file: ProposedFile): void {
  const normalised = file.path.split('\\').join('/');
  if (normalised !== file.path || normalised.startsWith('/') || normalised.includes('..')) {
    throw new DirectWriteRefusedError(
      `Proposed file path ${JSON.stringify(file.path)} is not a normalised repo-relative POSIX path.`,
    );
  }
  if (!PROPOSABLE_PREFIXES.some((p) => normalised.startsWith(p))) {
    throw new DirectWriteRefusedError(
      `A consumer change proposal may only propose files under ${PROPOSABLE_PREFIXES.join(' or ')} — ${JSON.stringify(file.path)} is neither.`,
    );
  }
}

/**
 * Stage the proposal. Writes only under `.mcpforge/proposals/<id>/`; the
 * target paths are recorded, never opened.
 */
export function writeChangeProposal(repoRoot: string, proposal: ChangeProposal): WrittenProposal {
  for (const file of proposal.files) assertProposable(file);

  const directory = proposalDirectory(repoRoot, proposal.id);
  const written: WrittenProposalFile[] = [];

  for (const file of proposal.files) {
    const stagedPath = join(directory, 'files', ...file.path.split('/'));
    assertProposalOnly(repoRoot, proposal.id, stagedPath);
    mkdirSync(dirname(stagedPath), { recursive: true });
    writeFileSync(stagedPath, file.content, 'utf8');
    written.push({ stagedPath, targetPath: file.path });
  }

  const manifestPath = join(directory, 'proposal.json');
  assertProposalOnly(repoRoot, proposal.id, manifestPath);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        proposalId: proposal.id,
        kind: proposal.kind,
        consumerId: proposal.consumerId,
        summary: proposal.summary,
        requestedBy: proposal.requestedBy,
        requestedAt: proposal.requestedAt,
        ...(proposal.reason === undefined ? {} : { reason: proposal.reason }),
        files: written.map((f) => f.targetPath),
        state: 'draft',
        note:
          'Staged, not applied. Nothing under consumers/ or approvals/ has been written. ' +
          'Proposing this into a branch for review is the ChangeHost seam (W0-J12); until then, ' +
          'a human applies these files in a change proposal and the named approver completes the approval record.',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return { proposalId: proposal.id, directory, manifestPath, files: written };
}
