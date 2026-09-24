// MCPForge — the `approvalUrl` 02 §3.1.1 returns beside the `approvalId`.
//
// **Host-agnostic by default** (CLAUDE.md §3.1: local-first, no cloud, no
// assumed host). The default builder returns the portal-relative route 03 §7.4
// names — `/approvals/<approvalId>` — because a Wave 0 deployment on a
// developer's machine has no canonical external origin, and a URL that
// confidently names `https://mcpforge.example` on a laptop is worse than a
// relative one: the requester pastes it to a colleague and it 404s.
//
// A deployment that DOES know its own origin passes `absoluteApprovalUrl(base)`
// and gets the fully-qualified link 02 §3.1.1 illustrates.

import type { ApprovalUrlBuilder } from './types.js';

/** The one route. Named once so the portal and the gateway cannot drift. */
export const APPROVAL_ROUTE = '/approvals';

export const relativeApprovalUrl: ApprovalUrlBuilder = (approvalId: string): string =>
  `${APPROVAL_ROUTE}/${encodeURIComponent(approvalId)}`;

/**
 * `absoluteApprovalUrl('https://forge.ltm.example')` →
 * `https://forge.ltm.example/approvals/apr_…`. A trailing slash on the base is
 * tolerated rather than doubled.
 */
export function absoluteApprovalUrl(baseUrl: string): ApprovalUrlBuilder {
  const base = baseUrl.replace(/\/+$/u, '');
  return (approvalId: string): string => `${base}${relativeApprovalUrl(approvalId)}`;
}
