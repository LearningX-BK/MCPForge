// MCPForge — W0-J12: the `ChangeHost` seam (02 §10.1 item 1).
//
// "the portal and the `forge` CLI reach git through a `ChangeHost` interface
// with two implementations — `LocalGit` (branch + commit + a review record
// committed under `approvals/`) and, later, `HostedGit` (branch + commit + a
// real PR through the host's API). Nothing above that interface knows which
// is in use, exactly as `IdentityProvider` (§4.4) works for identity."
//
// The rules that shape this file:
//
//  1. NOTHING ABOVE THE INTERFACE MAY LEARN THE IMPLEMENTATION. There is
//     deliberately no `kind`/`isLocal`/`flavour` field on `ChangeHost` and
//     no discriminant on any value it returns. The UI's one legitimate
//     branch — the no-remote copy of 03 §11.3 — keys off `RemoteInfo`,
//     which is a property of the *repository* and not of the
//     implementation: a `LocalGit` against a repo that has an `origin` is
//     configured; a hypothetical `HostedGit` is not distinguishable here.
//  2. VOCABULARY IS FIXED (03 §6.2, CLAUDE.md §3.1). The domain nouns are
//     "change proposal", "draft", "review record". The word "pull request"
//     appears nowhere in this module's type names, field names or copy.
//     `ChangeProposal.url` is optional precisely because a local-only
//     proposal has none.
//  3. STATE COMES FROM ONE VOCABULARY. `ChangeState` is
//     `@mcpforge/shared`'s `CHANGE_STATE` (03 §6.1) — this module does not
//     invent a parallel status enum. `merged` and `deployed` are separate
//     members and no helper here collapses them.
import { z } from 'zod';
import { CHANGE_STATES, type ChangeState } from '@mcpforge/shared';

export type { ChangeState };

// ---------------------------------------------------------------------------
// Remote
// ---------------------------------------------------------------------------

/**
 * What the repository knows about a push target. 03 §11.3: the branch chip
 * shows the remote or *"local only — no remote configured"*, and the Propose
 * dialog carries the one-line note only while `configured` is false.
 */
export const remoteInfoSchema = z.union([
  z.object({ configured: z.literal(false) }),
  z.object({
    configured: z.literal(true),
    /** e.g. `origin`. */
    name: z.string().min(1),
    /** The fetch URL, when git reports one. */
    url: z.string().optional(),
  }),
]);
export type RemoteInfo = z.infer<typeof remoteInfoSchema>;

// ---------------------------------------------------------------------------
// Diffs — 03 §6.5's three questions
// ---------------------------------------------------------------------------

export const diffFileStatuses = ['added', 'modified', 'deleted', 'renamed'] as const;
export type DiffFileStatus = (typeof diffFileStatuses)[number];

export const diffFileSchema = z.object({
  path: z.string().min(1),
  status: z.enum(diffFileStatuses),
  /** Unified patch text as git produced it. May be empty for a binary file. */
  patch: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type DiffFile = z.infer<typeof diffFileSchema>;

/**
 * The third diff (03 §6.5 item 3) is not a text diff — it is the *grant*
 * delta, computed from the compiled `generated/roles/<id>.scope.json`
 * artefacts on each side. "A tool addition that silently widens a role shows
 * up here and nowhere else."
 */
export const roleScopeDeltaSchema = z.object({
  roleId: z.string().min(1),
  label: z.string().optional(),
  /** Tool ids present on the proposal side and absent on the base side. */
  toolsAdded: z.array(z.string()),
  toolsRemoved: z.array(z.string()),
  /** Binding grants (CLAUDE.md non-negotiable 7) gained or lost. */
  bindingGrantsAdded: z.array(z.string()),
  bindingGrantsRemoved: z.array(z.string()),
});
export type RoleScopeDelta = z.infer<typeof roleScopeDeltaSchema>;

export const changeDiffSetSchema = z.object({
  /** 1. What a human wrote. Shown expanded. */
  manifest: z.array(diffFileSchema),
  /** 2. What codegen produced. Collapsed by default, but always present. */
  generated: z.array(diffFileSchema),
  /** 3. Which grants changed. NEVER collapsed. */
  roleScope: z.array(roleScopeDeltaSchema),
  /**
   * Everything else in the change that is neither a manifest, a generated
   * artefact nor a role scope (roles/, consumers/, overlays/, docs). Kept
   * separate so the three headline diffs stay exactly three.
   */
  other: z.array(diffFileSchema),
});
export type ChangeDiffSet = z.infer<typeof changeDiffSetSchema>;

// ---------------------------------------------------------------------------
// Proposals and review records
// ---------------------------------------------------------------------------

export const reviewRecordSchema = z.object({
  id: z.string().min(1),
  /** `change/<branch>` — mirrors `approvals/*.yaml`'s `subject:` convention. */
  subject: z.string().min(1),
  decision: z.enum(['proposed', 'approved', 'changes_requested', 'withdrawn']),
  requestedBy: z.string().min(1),
  requestedAt: z.string().min(1),
  branch: z.string().min(1),
  baseBranch: z.string().min(1),
  /** The proposal title — the human-readable "what and why". */
  scope: z.string().min(1),
  files: z.array(z.string()),
});
export type ReviewRecord = z.infer<typeof reviewRecordSchema>;

export const changeProposalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  branch: z.string().min(1),
  baseBranch: z.string().min(1),
  state: z.enum(CHANGE_STATES),
  author: z.string().min(1),
  createdAt: z.string().min(1),
  /**
   * Repo-relative path of the committed review record, when one exists. A
   * draft has none; a proposal always does (02 §10.1 item 1: "a review
   * record committed under `approvals/`").
   */
  reviewRecordPath: z.string().optional(),
  /**
   * The review URL when the repository has a host that produced one.
   * Absent for a local-only proposal — 03 §11.3: "Once a remote exists, the
   * note disappears and the PR link appears in its place."
   */
  url: z.string().optional(),
});
export type ChangeProposal = z.infer<typeof changeProposalSchema>;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface SaveDraftInput {
  /** Human title for the change; also the commit subject. */
  title: string;
  /** Branch name, e.g. `forge/W0-J12-change-host`. */
  branch: string;
  /** Files to write, keyed by repo-relative path. */
  files: Readonly<Record<string, string>>;
  author: string;
}

export interface ProposeInput {
  /** The draft's proposal id, as returned by `saveDraft`. */
  id: string;
  /** Optional richer description recorded alongside the review record. */
  description?: string;
  author: string;
}

/** The closed failure vocabulary for this seam (CLAUDE.md §5: no bare Errors). */
export const changeHostErrorCodes = [
  'CHANGE_NOT_FOUND',
  'CHANGE_BRANCH_EXISTS',
  'CHANGE_NOTHING_TO_COMMIT',
  'CHANGE_HOST_UNAVAILABLE',
  'CHANGE_HOST_NOT_IMPLEMENTED',
] as const;
export type ChangeHostErrorCode = (typeof changeHostErrorCodes)[number];

export class ChangeHostError extends Error {
  readonly code: ChangeHostErrorCode;
  /** CLAUDE.md non-negotiable 5: never "try again"; name an action. */
  readonly next: string;

  constructor(code: ChangeHostErrorCode, message: string, next: string) {
    super(message);
    this.name = 'ChangeHostError';
    this.code = code;
    this.next = next;
  }
}

// ---------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------

export interface ChangeHost {
  /** The branch the portal is reading definitional data from (03 §6.4). */
  currentBranch(): Promise<string>;
  /** 03 §11.3 — drives the branch-chip tooltip and the Propose dialog note. */
  describeRemote(): Promise<RemoteInfo>;
  /** Save draft — branch + commit. Reversible, private, cheap (03 §6.2). */
  saveDraft(input: SaveDraftInput): Promise<ChangeProposal>;
  /** Propose — commits the review record and moves the change to `in_review`. */
  propose(input: ProposeInput): Promise<ChangeProposal>;
  /** Discard — deletes the branch (03 §6.2; the confirm belongs to the UI). */
  discard(id: string): Promise<void>;
  listProposals(): Promise<readonly ChangeProposal[]>;
  getProposal(id: string): Promise<ChangeProposal | undefined>;
  /** The three diffs of 03 §6.5, always computed together. */
  diff(id: string): Promise<ChangeDiffSet>;
}
