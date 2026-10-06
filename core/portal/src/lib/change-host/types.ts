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
  /**
   * W0-P33b — set by Approve: the approver's `Principal.subject` (never a
   * display label, W0-P22), when, and whether the approver is also the author
   * (allowed for an admin, owner decisions W0-P4 §9-3 and W0-P32, and always
   * recorded).
   */
  approver: z.string().min(1).optional(),
  approvedAt: z.string().min(1).optional(),
  selfApproved: z.boolean().optional(),
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
}

export interface ProposeInput {
  /** The draft's proposal id, as returned by `saveDraft`. */
  id: string;
  /** Optional richer description recorded alongside the review record. */
  description?: string;
}

/**
 * W0-P5b, W0-P4 §3: **the author is never a caller's input.** The portal-facing
 * inputs above carry no `author`. The server actions in `local-git-actions.ts`
 * add the signed-in viewer's `Principal.subject` and hand these to the git
 * layer. A component, a test double or a crafted request cannot name who
 * proposed a change.
 */
export interface AuthoredSaveDraftInput extends SaveDraftInput {
  readonly author: string;
}
export interface AuthoredProposeInput extends ProposeInput {
  readonly author: string;
}

/** W0-P33b — Approve, as the git layer receives it: the approver is the session. */
export interface AuthoredApproveInput {
  readonly id: string;
  readonly approver: string;
  readonly selfApproved: boolean;
}

/**
 * W0-P33b — the checks a merge must pass, run against the branch's working
 * tree: `forge codegen`, then `forge validate`. The git layer never decides
 * what "valid" means; it is handed this.
 */
export type MergeCheck = (
  workingTree: string,
) => Promise<
  { readonly ok: true } | { readonly ok: false; readonly message: string; readonly next: string }
>;

/** W0-P33b — Merge, as the git layer receives it. */
export interface AuthoredMergeInput {
  readonly id: string;
  readonly mergedBy: string;
  readonly check: MergeCheck;
}

/** W0-P33b — what a merge produced. Merged is not deployed (03 §6.1). */
export const mergeResultSchema = z.object({
  proposal: changeProposalSchema,
  mergeCommit: z.string().min(1),
  /** True when codegen changed `generated/` and that diff was committed on the branch. */
  generatedCommitted: z.boolean(),
  next: z.string().min(1),
});
export type MergeResult = z.infer<typeof mergeResultSchema>;

/** The closed failure vocabulary for this seam (CLAUDE.md §5: no bare Errors). */
export const changeHostErrorCodes = [
  'CHANGE_NOT_FOUND',
  'CHANGE_BRANCH_EXISTS',
  'CHANGE_NOTHING_TO_COMMIT',
  'CHANGE_HOST_UNAVAILABLE',
  'CHANGE_HOST_NOT_IMPLEMENTED',
  // W0-P5b — the portal's action gates (W0-P4 §3).
  'CHANGE_SIGN_IN_REQUIRED',
  'CHANGE_NOT_PERMITTED',
  // W0-P33b — Approve and Merge.
  'CHANGE_NOT_APPROVED',
  'CHANGE_CHECKS_FAILED',
  'CHANGE_MERGE_CONFLICT',
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
  /**
   * W0-P3c — one file's contents as the proposal's branch holds it, so Build
   * can reopen a draft's manifest. `undefined` when the branch does not hold
   * that path. Only repo-relative paths under the definitional trees are
   * readable; anything else is refused with `CHANGE_NOT_PERMITTED`.
   */
  readFile(id: string, path: string): Promise<string | undefined>;
  /**
   * W0-P33b — Approve: records the approver on the review record. The
   * approver is the session, never an argument.
   */
  approve(id: string): Promise<ChangeProposal>;
  /**
   * W0-P33b — Merge an approved change into the base branch, after
   * `forge codegen` and `forge validate` pass on it. Merged is not deployed.
   */
  merge(id: string): Promise<MergeResult>;
}

/**
 * The trees a change proposal may touch and `readFile` may read. The same set
 * the portal's sandbox is seeded from (`local-git-actions.ts`).
 */
export const DEFINITIONAL_PREFIXES = [
  'manifests/',
  'roles/',
  'packages/',
  'consumers/',
  'enums/',
  'evals/',
  'approvals/',
  'generated/',
  // W0-Q5: a tracked intake request. Grants nothing; see w0-q4-intake-requests.md.
  'requests/',
] as const;

/** A repo-relative path under a definitional tree, with no traversal. */
export function isDefinitionalPath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\')) return false;
  if (path.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) {
    return false;
  }
  return DEFINITIONAL_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * The git layer: `LocalGit`, `HostedGit`, and the contract suite that holds
 * them to one behaviour. The same seam as `ChangeHost`, except that saving and
 * proposing take the author explicitly, because at this layer the author is
 * the committer. Only the server actions construct these inputs, from the
 * session (W0-P5b).
 */
export interface GitChangeHost extends Omit<
  ChangeHost,
  'saveDraft' | 'propose' | 'approve' | 'merge'
> {
  saveDraft(input: AuthoredSaveDraftInput): Promise<ChangeProposal>;
  propose(input: AuthoredProposeInput): Promise<ChangeProposal>;
  approve(input: AuthoredApproveInput): Promise<ChangeProposal>;
  merge(input: AuthoredMergeInput): Promise<MergeResult>;
}
