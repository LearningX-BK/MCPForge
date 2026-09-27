'use client';
// MCPForge — the client half of `/approvals/[approvalId]` (./page.tsx resolves
// the viewer on the server and renders this). Originally: the approver's decision route named
// but not built by W0-J15 and W0-J8 ("The content of the eventual
// `/approvals/[approvalId]` route; the route itself is a later J-track task
// and is not built here" — approver-decision-panel.tsx's header). Built now,
// under W0-J21 (gate 4, flow 2 "approve"), because the keyboard-only
// accessibility spec for that flow needs a real, navigable, decidable page
// to exercise — the queue list already links here (`approvals/fixtures.ts`'s
// `href`), and this route is the only thing standing between that link and a
// 404.
//
// Reuses `ApproverDecisionPanel` verbatim (no parallel decision UI) and owns
// only the state a client page must: which approval id, its current decided
// state, and the plan/identity views the panel needs to render everything
// the requester saw (03 §7.4's "nothing less").
import { notFound } from 'next/navigation';
import * as React from 'react';

import { ApproverDecisionPanel } from '@/components/write-path';
import type { ApprovalView, PlanBodyView, ProbeIdentityView } from '@/components/write-path';

import type { ViewerSummary } from '@/lib/viewer/summary';

import { loadApprovalQueue } from '../fixtures';
import type { RuntimeApprovalEntry } from '../types';

const NOT_SIGNED_IN = {
  message: 'You are not signed in, so this decision cannot carry your name.',
  next: 'Sign in, then decide this approval; it stays pending until you do.',
} as const;

/** The plan/identity views this demo route needs, keyed by tool id — the
 * same shape `buildReversalPlan` in the Activity call-detail page builds,
 * because this is the same "no live gateway approval-detail query exists
 * yet" seam. */
function buildPlan(entry: RuntimeApprovalEntry): PlanBodyView {
  const { approval } = entry;
  return {
    plan:
      approval.toolId === 'jde.ap.voucher.create'
        ? 'This creates an OPEN PAYABLE in JD Edwards, against the requester’s supplier and company.'
        : `This runs ${approval.toolId} in JD Edwards.`,
    effects: [
      {
        system: 'jde',
        object: entry.application,
        action: approval.toolId.split('.').pop() ?? 'run',
        reversible: approval.toolId.includes('cancel') ? false : true,
      },
    ],
    warnings: [],
    reversal:
      approval.toolId === 'jde.ap.voucher.create'
        ? { class: 'compensating-tool', tool: 'jde.ap.voucher.cancel', windowHours: 720 }
        : { class: 'irreversible', reason: 'This tool declares no reversal.' },
  };
}

function buildIdentity(entry: RuntimeApprovalEntry): ProbeIdentityView {
  return {
    subject: entry.approval.requester.subject,
    displayName: entry.approval.requester.displayName,
    bindingType: 'plsql',
    carries: 'unverified',
    probeRef: 'probe_2026-08-19T03-00Z',
    probedAt: '2026-08-19T03:00:00Z',
    compensatingControl: 'wrapper_schema',
  };
}

/**
 * W0-P5b, W0-P4 §3: the decision carries the signed-in viewer's identity,
 * never a hard-coded one. With nobody signed in there is no human to put on
 * the decision, so none is recorded. Runtime approval rules (approver !=
 * requester, the approver's grants) belong to the gateway's approval gate;
 * this page adds none of its own.
 */
export function ApprovalDecision({
  approvalId,
  viewer,
}: {
  readonly approvalId: string;
  readonly viewer: ViewerSummary | null;
}) {
  const entry = React.useMemo(() => {
    const found = loadApprovalQueue().find(
      (e): e is RuntimeApprovalEntry =>
        e.kind === 'runtime' && e.approval.approvalId === approvalId,
    );
    return found;
  }, [approvalId]);

  const [approval, setApproval] = React.useState<ApprovalView | undefined>(entry?.approval);
  const [refusal, setRefusal] = React.useState<typeof NOT_SIGNED_IN | null>(null);

  function decide(state: 'approved' | 'rejected', reason: string | undefined) {
    if (viewer === null) {
      setRefusal(NOT_SIGNED_IN);
      return;
    }
    setRefusal(null);
    setApproval((prev) =>
      prev
        ? {
            ...prev,
            state,
            decidedBy: { subject: viewer.subject, displayName: viewer.displayName },
            decidedAt: new Date().toISOString(),
            decisionReason: reason,
          }
        : prev,
    );
  }

  if (!entry || !approval) {
    notFound();
  }

  const plan = buildPlan(entry);
  const identity = buildIdentity(entry);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
      <div>
        <p className="text-[11px] tracking-[0.5px] text-text-2 uppercase">Approval</p>
        <h1 className="font-mono text-lg text-text-1">{approval.approvalId}</h1>
      </div>
      <ApproverDecisionPanel
        approval={approval}
        plan={plan}
        identity={identity}
        onApprove={(note) => decide('approved', note)}
        onDecline={(reason) => decide('rejected', reason)}
      />
      {refusal !== null && (
        <div
          role="alert"
          data-testid="approval-refusal"
          className="rounded-lg border border-status-danger-border bg-status-danger-bg p-3"
        >
          <p className="text-[12.5px] font-semibold text-status-danger-strong">{refusal.message}</p>
          <p className="mt-1 text-[12px] text-text-1">{refusal.next}</p>
        </div>
      )}
      <p className="text-[12px] text-text-2">
        This page records the decision here only. The gateway&apos;s approval queue is not wired to
        the portal yet (W0-P3), so nothing is sent to the gateway.
      </p>
    </main>
  );
}
