// MCPForge — W0-J19: `/home` — a worklist, not a dashboard (03 §5.3 "Home").
// W0-P3b: live, composed by the portal from `/api/v1` calls, approvals,
// integrity and enablement, plus open change proposals from git (the owner's
// 27 Sep endpoint decision: Home has no endpoint of its own). If any runtime
// read fails, Home shows that instead of columns: "nothing broke" must never
// be what an unreachable gateway looks like.

import * as React from 'react';

import { LiveStateNotice } from '@/components/live/live-state-notice';
import { serverChangeHost } from '@/lib/change-host/server';
import {
  readApprovals,
  readAuditVerify,
  readCalls,
  readEnablement,
} from '@/lib/gateway-client/read-client';

import { HomeView } from './home-view';
import { buildHomeWorklist } from './live';
import type { HomeWorklist } from './types';

const NO_WORKLIST: HomeWorklist = {
  myQueue: [],
  whatBroke: [],
  whatChanged: [],
  kpis: { toolsResolved: 0, toolsTotal: 0, approvalsOpen: 0, writesExecuted7d: 0, reversals7d: 0 },
};

export const dynamic = 'force-dynamic';

export default async function HomePage(): Promise<React.ReactElement> {
  const [approvals, calls, verify, enablement, proposals] = await Promise.all([
    readApprovals('pending'),
    readCalls({ limit: 200 }),
    readAuditVerify(),
    readEnablement(),
    serverChangeHost.listProposals().catch(() => null),
  ]);

  for (const r of [approvals, calls, verify, enablement]) {
    if (r.kind !== 'ok') {
      return (
        <HomeView
          worklist={NO_WORKLIST}
          notice={<LiveStateNotice state={r} subject="Your worklist" />}
        />
      );
    }
  }
  if (
    approvals.kind !== 'ok' ||
    calls.kind !== 'ok' ||
    verify.kind !== 'ok' ||
    enablement.kind !== 'ok'
  ) {
    throw new Error('unreachable: every read was checked above');
  }

  return (
    <HomeView
      worklist={buildHomeWorklist({
        approvals: approvals.data,
        calls: calls.data,
        verify: verify.data,
        enablement: enablement.data,
        proposals: proposals?.ok === true ? proposals.value : [],
        now: Date.now(),
      })}
    />
  );
}
