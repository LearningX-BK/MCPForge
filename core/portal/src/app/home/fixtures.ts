// MCPForge — W0-J19: the default `HomeSource`. See `types.ts`'s header — every
// row is derived from a real domain's own fixtures, not invented here.
import { loadApprovalQueue } from '../approvals/fixtures';
import { loadBuildDrafts } from '../build/fixtures';
import { loadActivityCalls, loadIntegrityVerification } from '../activity/fixtures';
import { fixtureCatalogSource } from '../catalog/fixtures';
import { loadRequests } from '../requests/fixtures';
import type { HomeSource, HomeWorklist, MyQueueItem, WhatBrokeItem, WhatChangedItem } from './types';

export function loadHomeWorklist(now: number = Date.now()): HomeWorklist {
  const approvals = loadApprovalQueue(now);
  const drafts = loadBuildDrafts();
  const calls = loadActivityCalls(now);
  const catalog = fixtureCatalogSource();
  const requests = loadRequests(now);
  const chain = loadIntegrityVerification(now);

  // ---- My queue -------------------------------------------------------
  const myQueue: MyQueueItem[] = [];
  for (const entry of approvals) {
    if (entry.kind === 'runtime' && entry.approval.state === 'pending') {
      myQueue.push({ kind: 'runtime_approval', entry, href: entry.href });
    }
    if (entry.kind === 'definitional' && entry.state === 'in_review') {
      myQueue.push({ kind: 'definitional_approval', entry, href: entry.href });
    }
  }
  for (const draft of drafts) {
    if (draft.state === 'draft') {
      myQueue.push({ kind: 'open_draft', draft, href: `/build/${draft.id}` });
    }
  }
  for (const r of requests) {
    if (r.state === 'submitted') {
      myQueue.push({
        kind: 'request_awaiting_verdict',
        requestId: r.id,
        askText: r.askText,
        href: '/requests',
      });
    }
  }

  // ---- What broke -------------------------------------------------------
  const whatBroke: WhatBrokeItem[] = [];
  for (const tool of catalog.tools) {
    if (tool.probeStatus.startsWith('disabled_')) {
      whatBroke.push({ kind: 'probe_disabled', tool, href: `/catalog/${tool.manifest.id}` });
    }
  }
  for (const call of calls) {
    if (call.outcome === 'policy_denied') {
      whatBroke.push({ kind: 'guardrail_refusal', call, href: `/activity/calls/${call.id}` });
    }
  }
  if (chain.status !== 'intact') {
    whatBroke.push({
      kind: 'chain_break',
      detail: `Hash-chain break at row ${chain.firstBreak?.rowId ?? 'unknown'}`,
      href: '/activity',
    });
  }

  // ---- What changed -------------------------------------------------------
  const whatChanged: WhatChangedItem[] = [];
  for (const tool of catalog.tools) {
    if (tool.changeState === 'deployed') {
      whatChanged.push({ kind: 'deployed_tool', tool, href: `/catalog/${tool.manifest.id}` });
    }
  }

  const toolsResolved = catalog.tools.filter((t) => t.probeStatus === 'resolved').length;
  const writesExecuted7d = calls.filter(
    (c) => c.isWrite && c.phase === 'execute' && c.outcome === 'ok',
  ).length;
  const reversals7d = calls.filter((c) => c.phase === 'reverse').length;

  return {
    myQueue,
    whatBroke,
    whatChanged,
    kpis: {
      toolsResolved,
      toolsTotal: catalog.tools.length,
      approvalsOpen: approvals.filter(
        (a) => (a.kind === 'runtime' && a.approval.state === 'pending') || (a.kind === 'definitional' && a.state === 'in_review'),
      ).length,
      writesExecuted7d,
      reversals7d,
    },
  };
}

/** Home's default `HomeSource` — see `types.ts`'s file header. */
export const fixtureHomeSource: HomeSource = () => loadHomeWorklist();

/** A worklist with every column and the KPI strip empty — the fresh local install. */
export const EMPTY_HOME_WORKLIST: HomeWorklist = {
  myQueue: [],
  whatBroke: [],
  whatChanged: [],
  kpis: { toolsResolved: 0, toolsTotal: 0, approvalsOpen: 0, writesExecuted7d: 0, reversals7d: 0 },
};
