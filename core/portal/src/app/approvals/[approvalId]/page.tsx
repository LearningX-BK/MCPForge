// MCPForge — `/approvals/[approvalId]`. W0-P3b: live, read from
// `/api/v1/approvals/{id}` as the signed-in viewer. A request outside the
// viewer's read authority is a 404 at the gateway, identical to a missing
// one, and renders the not-found notice (persona never hides a route, 03 §2).
// Read-only: see `approval-request-detail.tsx` for why deciding is not wired.

import * as React from 'react';

import { LiveStateNotice } from '@/components/live/live-state-notice';
import { readApproval } from '@/lib/gateway-client/read-client';

import { loadToolFacts, toRuntimeEntry } from '../live';
import { ApprovalRequestDetail } from './approval-request-detail';

export const dynamic = 'force-dynamic';

export default async function ApprovalDecisionPage({
  params,
}: {
  params: Promise<{ approvalId: string }>;
}): Promise<React.ReactElement> {
  const { approvalId } = await params;
  const result = await readApproval(approvalId);
  if (result.kind !== 'ok') {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
        <div>
          <p className="text-[11px] tracking-[0.5px] text-text-2 uppercase">Approval</p>
          <h1 className="font-mono text-lg text-text-1">{approvalId}</h1>
        </div>
        <LiveStateNotice state={result} subject="This approval" />
      </main>
    );
  }
  const a = result.data.approval;
  const entry = toRuntimeEntry(a, loadToolFacts());
  return (
    <ApprovalRequestDetail
      approval={entry.approval}
      planText={a.planSummary}
      application={entry.application}
      sensitivity={entry.sensitivity}
    />
  );
}
