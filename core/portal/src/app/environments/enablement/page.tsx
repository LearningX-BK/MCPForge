// MCPForge — W0-J17: `/environments/enablement` (03 §5.3 item 2). The concept
// console's Application Enablement page, made real by the probe report.
// W0-P3b: live, from `/api/v1/enablement`: only tools in the viewer's read
// authority, with `null` (not probed) where no probe report names a tool.
// W0-P33d: a super admin may start the probe from here (decision D of the
// W0-P33 design note). Showing the panel is a convenience read from the git
// mapping; whether the run happens is the gateway's call.

import * as React from 'react';

import { LiveStateNotice } from '@/components/live/live-state-notice';
import { readEnablement } from '@/lib/gateway-client/read-client';
import { holdsSuperAdmin } from '@/lib/viewer/mapping';
import { getViewer } from '@/lib/viewer/session';

import { toBacklog } from '../live';
import { runProbeAction } from './actions';
import { EnablementBacklogView } from './backlog-view';
import { ProbeRunPanel } from './probe-run-panel';

export const dynamic = 'force-dynamic';

export default async function EnablementPage(): Promise<React.ReactElement> {
  const [result, viewer] = await Promise.all([readEnablement(), getViewer()]);
  const probeRun =
    viewer !== null && holdsSuperAdmin(viewer) ? (
      <ProbeRunPanel action={runProbeAction} />
    ) : undefined;
  return result.kind === 'ok' ? (
    <EnablementBacklogView
      groups={toBacklog(result.data)}
      toolsInScope={result.data.tools.length}
      probeRun={probeRun}
    />
  ) : (
    <EnablementBacklogView
      groups={[]}
      notice={<LiveStateNotice state={result} subject="Enablement backlog" />}
      probeRun={probeRun}
    />
  );
}
