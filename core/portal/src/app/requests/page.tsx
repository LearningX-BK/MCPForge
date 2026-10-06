// MCPForge — W0-J19 / W0-Q5: `/requests` (03 §5.3 "Requests").
//
// A server page. The ask box ranks over the committed discovery index
// (`./source.ts`), the one `forge.find` serves. Tracked requests are read from
// `requests/` in git, with their status derived from the real change, approval
// and probe (`./_lib/load-requests.ts`); nothing is stored here.

import * as React from 'react';

import { resolveRepoRoot } from '../build/_lib/repo-root';
import { indexDigest, loadRequests } from './_lib/load-requests';
import { toSummary } from './_lib/summary';
import { RequestsView } from './requests-view';
import { loadRequestCatalog } from './source';

export const dynamic = 'force-dynamic';

export default async function RequestsPage(): Promise<React.ReactElement> {
  const snapshot = await loadRequests();
  return (
    <RequestsView
      catalog={loadRequestCatalog()}
      requests={snapshot.requests.map(toSummary)}
      problems={snapshot.problems}
      indexDigest={indexDigest(resolveRepoRoot())}
    />
  );
}
