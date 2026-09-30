// MCPForge — W0-J19: `/requests` (03 §5.3 "Requests").
//
// W0-P3c: a server page. The ask box ranks over the committed discovery
// index (`./source.ts`), the one `forge.find` serves. There are no tracked
// requests to show: nothing records a request yet (W0-Q4 designs where one
// lives), and a seeded list beside a live search would read as fact.

import * as React from 'react';

import { RequestsView } from './requests-view';
import { loadRequestCatalog } from './source';

export const dynamic = 'force-dynamic';

export default function RequestsPage(): React.ReactElement {
  return <RequestsView catalog={loadRequestCatalog()} requests={[]} />;
}
