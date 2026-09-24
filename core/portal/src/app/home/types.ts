// MCPForge — W0-J19: Home's worklist shapes (03 §5.3 "Home").
//
// Same seam discipline as every J-track page: no live gateway/git wiring
// exists yet, so Home is sourced from the REAL domains that already have
// injectable fixtures — `approvals/fixtures.ts` (my queue), `build/fixtures.ts`
// (my open drafts), `activity/fixtures.ts` (what broke — refusals), and
// `catalog/fixtures.ts` (what broke — probe regressions; what changed —
// newly deployed tools), per this task's instructions. `home/fixtures.ts`
// derives every row below from those loaders — nothing here is a parallel,
// invented data source.
import type { ApprovalQueueEntry } from '../approvals/types';
import type { BuildDraft } from '../build/types';
import type { ActivityCallSummary } from '../activity/types';
import type { CatalogTool } from '../catalog/types';

/** "My queue" — one row, whichever real domain it came from. */
export type MyQueueItem =
  | { readonly kind: 'runtime_approval'; readonly entry: ApprovalQueueEntry; readonly href: string }
  | { readonly kind: 'definitional_approval'; readonly entry: ApprovalQueueEntry; readonly href: string }
  | { readonly kind: 'open_draft'; readonly draft: BuildDraft; readonly href: string }
  | { readonly kind: 'request_awaiting_verdict'; readonly requestId: string; readonly askText: string; readonly href: string };

/** "What broke" — probe regressions, guardrail refusals, hash-chain breaks. */
export type WhatBrokeItem =
  | { readonly kind: 'probe_disabled'; readonly tool: CatalogTool; readonly href: string }
  | { readonly kind: 'guardrail_refusal'; readonly call: ActivityCallSummary; readonly href: string }
  | { readonly kind: 'chain_break'; readonly detail: string; readonly href: string };

/** "What changed" — recently deployed manifests, recently resolved tools, role scope changes. */
export type WhatChangedItem =
  | { readonly kind: 'deployed_tool'; readonly tool: CatalogTool; readonly href: string }
  | { readonly kind: 'role_scope_change'; readonly roleId: string; readonly summary: string; readonly href: string };

export interface HomeKpis {
  readonly toolsResolved: number;
  readonly toolsTotal: number;
  readonly approvalsOpen: number;
  readonly writesExecuted7d: number;
  readonly reversals7d: number;
}

export interface HomeWorklist {
  readonly myQueue: readonly MyQueueItem[];
  readonly whatBroke: readonly WhatBrokeItem[];
  readonly whatChanged: readonly WhatChangedItem[];
  readonly kpis: HomeKpis;
}

/** The injectable seam — same shape as every other page's `*Source`. */
export type HomeSource = () => HomeWorklist;
