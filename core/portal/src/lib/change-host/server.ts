// MCPForge — W0-P3b: the ChangeHost's READ surface for server components.
//
// 02 §10.1 item 1: nothing above `src/lib/change-host` may know which host is
// in use. `default-host.ts` is the client-side seam; this is its server-side
// twin, for pages that read definitional state (open proposals, the remote)
// while they render. Which host answers is decided here and nowhere else.
// Reads only: a server component never proposes or merges.

import type { ActionResult } from './local-git-actions';
import { changeHostDescribeRemote, changeHostListProposals } from './local-git-actions';
import type { ChangeProposal, RemoteInfo } from './types';

export const serverChangeHost = {
  listProposals(): Promise<ActionResult<readonly ChangeProposal[]>> {
    return changeHostListProposals();
  },
  describeRemote(): Promise<RemoteInfo> {
    return changeHostDescribeRemote();
  },
};
