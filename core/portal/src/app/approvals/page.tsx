// MCPForge — W0-J15: `/approvals` — the queue (03 §5.3 "Approvals").
// W0-P3b: live. Runtime approvals are read from `/api/v1/approvals` as the
// viewer (filtered by the gateway to what the viewer may read); definitional
// approvals are the open change proposals, read from git. If the runtime read
// fails, the definitional half still renders and the runtime half says why.

import * as React from 'react';

import { LiveStateNotice } from '@/components/live/live-state-notice';
import { serverChangeHost } from '@/lib/change-host/server';
import { readApprovals } from '@/lib/gateway-client/read-client';

import { ApprovalQueueList } from './approval-queue-list';
import { loadToolFacts, toDefinitionalEntry, toRuntimeEntry } from './live';
import type { ApprovalQueueEntry } from './types';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage(): Promise<React.ReactElement> {
  const [runtime, proposals] = await Promise.all([
    readApprovals('pending'),
    serverChangeHost.listProposals().catch(() => null),
  ]);

  const facts = loadToolFacts();
  const entries: ApprovalQueueEntry[] = [
    ...(runtime.kind === 'ok' ? runtime.data.items.map((a) => toRuntimeEntry(a, facts)) : []),
    ...(proposals?.ok === true
      ? proposals.value.map(toDefinitionalEntry).filter((e) => e !== null)
      : []),
  ];

  return (
    <main className="flex flex-col gap-4 px-6 py-6">
      <div>
        <h1 className="mb-1 font-display text-xl text-text-1">Approvals</h1>
        <p className="max-w-[70ch] text-[13px] text-text-2">
          One queue, two kinds of approval, differentiated by chip and never separated. A{' '}
          <span className="font-medium text-text-1">runtime</span> approval is a live write call
          blocking an agent and a human right now — it expires with its plan and pins to the top
          while it can still expire. A <span className="font-medium text-text-1">definitional</span>{' '}
          approval is a proposed change to a manifest, role or package — it does not expire, and
          it is the only kind that can be acted on in bulk.
        </p>
      </div>
      {runtime.kind === 'ok' ? null : (
        <LiveStateNotice state={runtime} subject="Runtime approvals" />
      )}
      {proposals === null || proposals.ok === false ? (
        <LiveStateNotice
          state={{
            kind: 'refused',
            code: proposals?.ok === false ? proposals.code : 'CHANGE_HOST_UNAVAILABLE',
            message:
              proposals?.ok === false
                ? proposals.message
                : 'The change proposals could not be read from git.',
            next:
              proposals?.ok === false
                ? proposals.next
                : 'Check that this portal runs inside the MCPForge git checkout, then reload.',
          }}
          subject="Definitional approvals"
        />
      ) : null}
      <ApprovalQueueList entries={entries} />
    </main>
  );
}
