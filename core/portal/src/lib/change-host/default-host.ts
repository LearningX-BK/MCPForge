// MCPForge — the client-safe `ChangeHost` every real route composes
// (`local-git-actions.ts`'s header explains why the boundary is server
// actions, not a constructed instance passed as a prop).
//
// This module carries no `'use client'`/`'use server'` directive of its own:
// it is plain glue that calls the imported server actions, so wherever it
// lands (client bundle or server) it is just function calls — no `LocalGit`,
// no `node:fs`, no `node:child_process` name appears here, and nothing here
// closes over Node state. It lives inside `lib/change-host/` so it remains an
// allowed namer of the implementation per `vocabulary.test.tsx`'s "no file
// outside src/lib/change-host names LocalGit or HostedGit" — it does not name
// either, but the rule's spirit (nothing ABOVE the interface knows) is kept:
// callers import `defaultChangeHost` as one more `ChangeHost` value, exactly
// as they would a test's `stubHost()`.
import {
  changeHostCurrentBranch,
  changeHostDescribeRemote,
  changeHostDiff,
  changeHostDiscard,
  changeHostGetProposal,
  changeHostListProposals,
  changeHostPropose,
  changeHostSaveDraft,
  type ActionResult,
} from './local-git-actions';
import {
  ChangeHostError,
  type ChangeDiffSet,
  type ChangeHost,
  type ChangeProposal,
  type ProposeInput,
  type RemoteInfo,
  type SaveDraftInput,
} from './types';

function unwrap<T>(result: ActionResult<T>): T {
  if (result.ok) return result.value;
  throw new ChangeHostError(result.code, result.message, result.next);
}

/**
 * The `LocalGit`-backed `ChangeHost` every real route gets by default (root
 * layout composes it via `AppChangeHostProvider`). Tests and Storybook keep
 * injecting `stubHost()` or another `ChangeHost` directly — this is one more
 * value of that same interface, never a special case.
 */
export const defaultChangeHost: ChangeHost = {
  currentBranch(): Promise<string> {
    return changeHostCurrentBranch();
  },
  describeRemote(): Promise<RemoteInfo> {
    return changeHostDescribeRemote();
  },
  async saveDraft(input: SaveDraftInput): Promise<ChangeProposal> {
    return unwrap(await changeHostSaveDraft(input));
  },
  async propose(input: ProposeInput): Promise<ChangeProposal> {
    return unwrap(await changeHostPropose(input));
  },
  async discard(id: string): Promise<void> {
    return unwrap(await changeHostDiscard(id));
  },
  async listProposals(): Promise<readonly ChangeProposal[]> {
    return unwrap(await changeHostListProposals());
  },
  async getProposal(id: string): Promise<ChangeProposal | undefined> {
    return unwrap(await changeHostGetProposal(id));
  },
  async diff(id: string): Promise<ChangeDiffSet> {
    return unwrap(await changeHostDiff(id));
  },
};
