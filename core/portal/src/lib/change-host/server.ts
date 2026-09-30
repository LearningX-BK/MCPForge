// MCPForge — W0-P3b: the ChangeHost's READ surface for server components.
//
// 02 §10.1 item 1: nothing above `src/lib/change-host` may know which host is
// in use. `default-host.ts` is the client-side seam; this is its server-side
// twin, for pages that read definitional state (open proposals, the remote)
// while they render. Which host answers is decided here and nowhere else.
// Reads only: a server component never proposes or merges.
//
// W0-P3c adds `getProposal`, `diff` and `readFile`, so Build can list its
// drafts and reopen one's manifest from the branch that holds it.

import type { ActionResult } from './local-git-actions';
import {
  changeHostDescribeRemote,
  changeHostDiff,
  changeHostGetProposal,
  changeHostListProposals,
  changeHostReadFile,
} from './local-git-actions';
import type { ChangeDiffSet, ChangeProposal, RemoteInfo } from './types';

export const serverChangeHost = {
  listProposals(): Promise<ActionResult<readonly ChangeProposal[]>> {
    return changeHostListProposals();
  },
  getProposal(id: string): Promise<ActionResult<ChangeProposal | undefined>> {
    return changeHostGetProposal(id);
  },
  diff(id: string): Promise<ActionResult<ChangeDiffSet>> {
    return changeHostDiff(id);
  },
  readFile(id: string, filePath: string): Promise<ActionResult<string | undefined>> {
    return changeHostReadFile(id, filePath);
  },
  describeRemote(): Promise<RemoteInfo> {
    return changeHostDescribeRemote();
  },
};
