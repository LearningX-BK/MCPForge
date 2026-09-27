// MCPForge — W0-J16: `/activity/calls/[callId]` — call detail (03 §5.3
// "Activity"). W0-P3b: live, read from `/api/v1/calls/{id}` as the viewer.
// A call outside the viewer's read authority is indistinguishable from one
// that does not exist (the gateway answers 404 for both), and renders the
// not-found notice rather than a page: persona never hides a route (03 §2).

import * as React from 'react';

import { LiveStateNotice } from '@/components/live/live-state-notice';
import { readApproval, readCall } from '@/lib/gateway-client/read-client';

import { toCallDetailView } from '../../live';
import { CallDetailView } from './call-detail-view';

export const dynamic = 'force-dynamic';

export default async function ActivityCallDetailPage({
  params,
}: {
  params: Promise<{ callId: string }>;
}): Promise<React.ReactElement> {
  const { callId } = await params;
  const result = await readCall(callId);

  if (result.kind !== 'ok') {
    return (
      <main className="flex flex-col gap-6 px-6 py-6">
        <div>
          <p className="text-[11px] tracking-[0.5px] text-text-2 uppercase">Call</p>
          <h1 className="mb-1 font-mono text-lg text-text-1">{callId}</h1>
        </div>
        <LiveStateNotice state={result} subject="This call" />
      </main>
    );
  }

  const detail = toCallDetailView(result.data.call);
  // The plan text AS SHOWN lives on the approval request the call went
  // through. It is rendered verbatim from there and never re-derived.
  const approvalId = result.data.call.approval?.approvalId;
  const approval = approvalId === undefined ? undefined : await readApproval(approvalId);
  const planAsShown =
    approval?.kind === 'ok' ? (approval.data.approval.planSummary ?? undefined) : undefined;

  return <CallDetailView detail={{ ...detail, planAsShown }} />;
}
