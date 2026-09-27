// MCPForge — W0-J17: `/environments/enablement` (03 §5.3 item 2). The concept
// console's Application Enablement page, made real by the probe report.
// W0-P3b: live, from `/api/v1/enablement`: only tools in the viewer's read
// authority, with `null` (not probed) where no probe report names a tool.

import * as React from 'react';

import { LiveStateNotice } from '@/components/live/live-state-notice';
import { readEnablement } from '@/lib/gateway-client/read-client';

import { toBacklog } from '../live';
import { EnablementBacklogView } from './backlog-view';

export const dynamic = 'force-dynamic';

export default async function EnablementPage(): Promise<React.ReactElement> {
  const result = await readEnablement();
  return result.kind === 'ok' ? (
    <EnablementBacklogView groups={toBacklog(result.data)} toolsInScope={result.data.tools.length} />
  ) : (
    <EnablementBacklogView
      groups={[]}
      notice={<LiveStateNotice state={result} subject="Enablement backlog" />}
    />
  );
}
