// MCPForge — W0-P3b: Home's worklist, built from live reads.
//
// Runtime rows come from `/api/v1` (approvals, calls, integrity, enablement);
// definitional approvals from git through the ChangeHost. Rows whose source is
// still a fixture — open Build drafts, Requests awaiting triage and recently
// deployed tools — are NOT shown here until W0-P3c makes those pages read git:
// a fixture beside live data would read as fact. Each column says so when empty.

import type {
  AuditVerifyResponse,
  CallsPage,
  EnablementResponse,
  ApprovalsResponse,
} from '@mcpforge/shared/api/v1';

import type { ChangeProposal } from '@/lib/change-host/types';

import { loadToolFacts, toDefinitionalEntry, toRuntimeEntry } from '../approvals/live';
import { toCallSummaryView } from '../activity/live';
import type { HomeWorklist, MyQueueItem, WhatBrokeItem } from './types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface HomeInputs {
  readonly approvals: ApprovalsResponse;
  readonly calls: CallsPage;
  readonly verify: AuditVerifyResponse;
  readonly enablement: EnablementResponse;
  readonly proposals: readonly ChangeProposal[];
  readonly now: number;
}

export function buildHomeWorklist(input: HomeInputs): HomeWorklist {
  const facts = loadToolFacts();

  const myQueue: MyQueueItem[] = [];
  for (const a of input.approvals.items) {
    if (a.status !== 'pending') continue;
    const entry = toRuntimeEntry(a, facts);
    myQueue.push({ kind: 'runtime_approval', entry, href: entry.href });
  }
  for (const p of input.proposals) {
    const entry = toDefinitionalEntry(p);
    if (entry !== null && entry.state === 'in_review') {
      myQueue.push({ kind: 'definitional_approval', entry, href: entry.href });
    }
  }

  const whatBroke: WhatBrokeItem[] = [];
  for (const t of input.enablement.tools) {
    if (t.status !== null && t.status.startsWith('disabled_')) {
      whatBroke.push({
        kind: 'probe_disabled',
        toolId: t.toolId,
        status: t.status,
        href: '/environments/enablement',
      });
    }
  }
  const calls = input.calls.items.map(toCallSummaryView);
  for (const call of calls) {
    if (call.outcome === 'policy_denied') {
      whatBroke.push({ kind: 'guardrail_refusal', call, href: `/activity/calls/${call.id}` });
    }
  }
  for (const chain of input.verify.chains) {
    if (chain.status === 'broken') {
      whatBroke.push({
        kind: 'chain_break',
        detail: `Hash-chain break in ${chain.deploymentId} at row ${chain.firstBreak?.rowId ?? 'unknown'}`,
        href: '/activity',
      });
    }
  }

  const recent = calls.filter((c) => input.now - Date.parse(c.ts) <= WEEK_MS);
  return {
    myQueue,
    whatBroke,
    whatChanged: [],
    kpis: {
      toolsResolved: input.enablement.tools.filter((t) => t.status === 'resolved').length,
      toolsTotal: input.enablement.tools.length,
      approvalsOpen: myQueue.length,
      writesExecuted7d: recent.filter(
        (c) => c.isWrite && c.phase === 'execute' && c.outcome === 'ok',
      ).length,
      reversals7d: recent.filter((c) => c.phase === 'reverse').length,
    },
  };
}
