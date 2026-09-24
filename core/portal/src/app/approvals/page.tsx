// MCPForge — W0-J15: `/approvals` — the queue (03 §5.3 "Approvals").
import * as React from 'react';
import { loadApprovalQueue } from './fixtures';
import { ApprovalQueueList } from './approval-queue-list';

export default function ApprovalsPage(): React.ReactElement {
  const entries = loadApprovalQueue();

  return (
    <main className="px-6 py-6">
      <h1 className="mb-1 font-display text-xl text-text-1">Approvals</h1>
      <p className="mb-4 max-w-[70ch] text-[13px] text-text-2">
        One queue, two kinds of approval, differentiated by chip and never separated. A{' '}
        <span className="font-medium text-text-1">runtime</span> approval is a live write call
        blocking an agent and a human right now — it expires with its plan and pins to the top
        while it can still expire. A <span className="font-medium text-text-1">definitional</span>{' '}
        approval is a proposed change to a manifest, role or package — it does not expire, and
        it is the only kind that can be acted on in bulk.
      </p>
      <ApprovalQueueList entries={entries} />
    </main>
  );
}
