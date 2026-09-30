// MCPForge — W0-P3b: the Approvals queue's two live sources -> its one view.
//
// Runtime approvals come from `/api/v1/approvals` (runtime state). Definitional
// approvals are change proposals, read from git through the ChangeHost
// (W0-P2 §7: definitional reads stay on git). Tool facts that label a runtime
// row (application, sensitivity) come from the committed catalogue index, also
// git. SERVER-ONLY: it reads the repository.

import type { RuntimeApproval } from '@mcpforge/shared/api/v1';
import { loadCatalogueIndex } from '@mcpforge/registry/index/server';

import type { ChangeProposal } from '@/lib/change-host/types';

import { resolveRepoRoot } from '../build/_lib/repo-root';
import type { DefinitionalApprovalEntry, RuntimeApprovalEntry } from './types';

export interface ToolFacts {
  readonly application: string;
  readonly sensitivity: string;
}

/** Tool id -> label facts, from the committed catalogue index. Empty when unreadable. */
export function loadToolFacts(
  repoRoot: string = resolveRepoRoot(),
): ReadonlyMap<string, ToolFacts> {
  try {
    const index = loadCatalogueIndex(repoRoot);
    return new Map(
      index.tools.map((t) => [
        t.id,
        {
          application: `${t.filters.app.toUpperCase()} · ${t.filters.module}`,
          sensitivity: t.filters.sensitivity,
        },
      ]),
    );
  } catch {
    return new Map();
  }
}

/**
 * Wave 0 runs local only (CLAUDE.md §3.1), and an approval row carries no
 * environment of its own. When a non-local deployment exists, `/api/v1`
 * gains the environment class and this constant goes.
 */
const WAVE0_ENV_CLASS = 'local' as const;

export function toRuntimeEntry(
  a: RuntimeApproval,
  facts: ReadonlyMap<string, ToolFacts>,
): RuntimeApprovalEntry {
  const f = facts.get(a.toolId);
  return {
    kind: 'runtime',
    href: `/approvals/${encodeURIComponent(a.id)}`,
    application: f?.application ?? a.toolId.split('.').slice(0, 2).join(' · '),
    sensitivity: f?.sensitivity ?? 'unknown',
    approval: {
      approvalId: a.id,
      state: a.status,
      requester: { subject: a.callerSubject },
      // Who MAY approve is the gateway's approval gate's decision, made at
      // decision time; the row does not name candidates, so none are invented.
      approvers: [],
      ...(a.approverSubject === null ? {} : { decidedBy: { subject: a.approverSubject } }),
      ...(a.selfApproved ? { selfApproved: true } : {}),
      ...(a.decisionReason === null ? {} : { decisionReason: a.decisionReason }),
      raisedAt: a.createdAt,
      ...(a.decidedAt === null ? {} : { decidedAt: a.decidedAt }),
      expiresAt: a.expiresAt,
      planHash: a.planHash,
      argsCanonicalHash: a.argsCanonicalHash,
      toolId: a.toolId,
      ...(a.toolVersion === null ? {} : { toolVersion: a.toolVersion }),
      envClass: WAVE0_ENV_CLASS,
    },
  };
}

/** A change proposal still open for review. Merged proposals are history, not queue. */
export function toDefinitionalEntry(p: ChangeProposal): DefinitionalApprovalEntry | null {
  if (p.state === 'merged') return null;
  return {
    kind: 'definitional',
    id: p.id,
    title: p.title,
    state: p.state,
    author: p.author,
    createdAt: p.createdAt,
    href: `/build/${encodeURIComponent(p.id)}`,
    application: 'Definition (git)',
  };
}
