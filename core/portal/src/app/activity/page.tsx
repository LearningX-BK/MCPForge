// MCPForge — W0-J16: `/activity` — the run explorer over `audit_call` (03
// §5.3 "Activity"). W0-P3b: live. The calls and the integrity result are read
// from the gateway's `/api/v1` as the signed-in viewer, through the portal's
// registered consumer, and filtered by the gateway to what the viewer may see.
// A read that fails renders its own notice: never an empty table.

import * as React from 'react';

import { LiveStateNotice } from '@/components/live/live-state-notice';
import { readAuditVerify, readCalls } from '@/lib/gateway-client/read-client';
import { getViewer } from '@/lib/viewer/session';

import { ActivityView } from './activity-view';
import { toCallSummaryView, toIntegrityView } from './live';

export const dynamic = 'force-dynamic';

export default async function ActivityPage(): Promise<React.ReactElement> {
  const [viewer, calls, verify] = await Promise.all([getViewer(), readCalls(), readAuditVerify()]);

  return (
    <>
      {calls.kind === 'ok' ? (
        <ActivityView
          calls={calls.data.items.map(toCallSummaryView)}
          verifications={verify.kind === 'ok' ? verify.data.chains.map(toIntegrityView) : []}
          currentSubject={viewer?.subject ?? ''}
          integrityNotice={
            verify.kind === 'ok' ? undefined : <LiveStateNotice state={verify} subject="Integrity" />
          }
        />
      ) : (
        <main className="flex flex-col gap-6 px-6 py-6">
          <div>
            <h1 className="mb-1 font-display text-xl text-text-1">Activity</h1>
            <p className="max-w-[70ch] text-[13px] text-text-2">
              Audit and consumption, in one dataset. Every call the gateway made a decision about —
              planned, executed, rejected or reversed.
            </p>
          </div>
          <LiveStateNotice state={calls} subject="Calls" />
        </main>
      )}
    </>
  );
}
