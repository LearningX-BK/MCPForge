// MCPForge — W0-J12: `HostedGit`, the deliberately stubbed second
// implementation (02 §10.1 item 1: "and, later, `HostedGit` (branch + commit
// + a real PR through the host's API)").
//
// This is a STUB and is meant to stay one for Wave 0. CLAUDE.md §3.1: "No
// GitHub / GitLab / Azure DevOps assumption." Building a real host client
// would bake in exactly the assumption the decision forbids, and 02 §1's
// open question 1 records that the host is *unrecorded* — a human must name
// it. So every method fails loudly with `CHANGE_HOST_NOT_IMPLEMENTED` and a
// `next` that names the human action, rather than silently degrading to
// local behaviour (which would make the portal claim a review exists on a
// host when it does not).
//
// It exists in the tree, implementing `ChangeHost` structurally, because
// that is what proves the seam: the contract test type-checks it against
// the same interface as `LocalGit`, so the day a host is chosen the only
// file that changes is this one.
import {
  ChangeHostError,
  type ChangeDiffSet,
  type ChangeHost,
  type ChangeProposal,
  type RemoteInfo,
} from './types';

export interface HostedGitOptions {
  /** e.g. `https://dev.azure.com/ltm/mcpforge`. Recorded, never dialled. */
  hostUrl: string;
  /** `secretRef://...` — never a token value (CLAUDE.md non-negotiable 8). */
  credentialRef: string;
}

const NEXT =
  'Name the git host in 02 §1 open question 1 and implement HostedGit against it; until then configure a local repository and use LocalGit.';

function notImplemented(operation: string): ChangeHostError {
  return new ChangeHostError(
    'CHANGE_HOST_NOT_IMPLEMENTED',
    `HostedGit.${operation} is not implemented: no git host is chosen for Wave 0.`,
    NEXT,
  );
}

export class HostedGit implements ChangeHost {
  readonly #options: HostedGitOptions;

  constructor(options: HostedGitOptions) {
    this.#options = options;
  }

  /** Exposed for diagnostics only; carries a `secretRef://`, never a secret. */
  get hostUrl(): string {
    return this.#options.hostUrl;
  }

  currentBranch(): Promise<string> {
    return Promise.reject(notImplemented('currentBranch'));
  }

  describeRemote(): Promise<RemoteInfo> {
    return Promise.reject(notImplemented('describeRemote'));
  }

  // Parameters are omitted deliberately: a stub must not name arguments it
  // never reads, and fewer parameters still satisfies `ChangeHost`
  // structurally, so the day this is implemented the signatures come back
  // from the interface unchanged.
  saveDraft(): Promise<ChangeProposal> {
    return Promise.reject(notImplemented('saveDraft'));
  }

  propose(): Promise<ChangeProposal> {
    return Promise.reject(notImplemented('propose'));
  }

  discard(): Promise<void> {
    return Promise.reject(notImplemented('discard'));
  }

  listProposals(): Promise<readonly ChangeProposal[]> {
    return Promise.reject(notImplemented('listProposals'));
  }

  getProposal(): Promise<ChangeProposal | undefined> {
    return Promise.reject(notImplemented('getProposal'));
  }

  diff(): Promise<ChangeDiffSet> {
    return Promise.reject(notImplemented('diff'));
  }
}
