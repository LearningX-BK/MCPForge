'use client';
// MCPForge — `/approvals/[approvalId]` — the approver's decision route named
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

import { loadApprovalQueue } from '../fixtures';
import type { RuntimeApprovalEntry } from '../types';

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

export default function ApprovalDecisionPage({
  params,
}: {
  params: Promise<{ approvalId: string }>;
}) {
  const { approvalId } = React.use(params);
  const entry = React.useMemo(() => {
    const found = loadApprovalQueue().find(
      (e): e is RuntimeApprovalEntry => e.kind === 'runtime' && e.approval.approvalId === approvalId,
    );
    return found;
  }, [approvalId]);

  const [approval, setApproval] = React.useState<ApprovalView | undefined>(entry?.approval);

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
        onApprove={(note) =>
          setApproval((prev) =>
            prev
              ? {
                  ...prev,
                  state: 'approved',
                  decidedBy: { subject: 'meera.rao@example.com', displayName: 'Meera Rao' },
                  decidedAt: new Date().toISOString(),
                  decisionReason: note,
                }
              : prev,
          )
        }
        onDecline={(reason) =>
          setApproval((prev) =>
            prev
              ? {
                  ...prev,
                  state: 'rejected',
                  decidedBy: { subject: 'meera.rao@example.com', displayName: 'Meera Rao' },
                  decidedAt: new Date().toISOString(),
                  decisionReason: reason,
                }
              : prev,
          )
        }
      />
    </main>
  );
}
