// MCPForge — W0-J15: the default approvals-queue source.
//
// Same seam as `build/fixtures.ts`: no live gateway `audit_approval` query
// and no wired `ChangeHost.listProposals()` exist in the portal yet, so this
// is an injectable function returning realistic fixtures, not a hardcoded
// render. Swapping it for `Promise<ApprovalQueueEntry[]>` backed by a real
// gateway/`ChangeHost` call touches no component in this directory.
//
// Fixture coverage (all five states this task's brief asks for):
//   1. runtime, pending, nearing expiry   — pins to the top, live countdown
//   2. runtime, pending, plenty of time   — pins to the top, below #1
//   3. runtime, expired                   — renders as EXPIRED, not removed
//   4. definitional, in_review            — an open change proposal
//   5. definitional, withdrawn            — the "no longer live" state a
//                                            definitional approval actually
//                                            has; see types.ts's header for
//                                            why this stands in for
//                                            "expired" rather than a
//                                            fabricated `ChangeState` member.
import type { ApprovalQueueEntry } from './types';

const NOW = Date.now();
const MIN = 60_000;

export function loadApprovalQueue(now: number = NOW): readonly ApprovalQueueEntry[] {
  return [
    {
      kind: 'runtime',
      href: '/approvals/apr_9f21c0',
      application: 'JD Edwards — Accounts Payable',
      sensitivity: 'financial',
      approval: {
        approvalId: 'apr_9f21c0',
        state: 'pending',
        requester: { subject: 'priya.raman@example.com', displayName: 'Priya Raman' },
        requesterRole: 'p2p',
        approvers: [{ subject: 'meera.rao@example.com', displayName: 'Meera Rao' }],
        raisedAt: new Date(now - 4 * MIN).toISOString(),
        // Nearing expiry — inside the 60s announcement threshold.
        expiresAt: new Date(now + 45_000).toISOString(),
        planHash: 'sha256:6f2a9c1e4b7d0a35c8f1e2d3b4a5968712abf034e5d6c7b8a9102938475afcd',
        argsCanonicalHash: 'sha256:1a2b3c4d5e6f708192a3b4c5d6e7f809102a3b4c5d6e7f8091a2b3c4d5e6f70',
        toolId: 'jde.ap.voucher.create',
        toolVersion: '1.0.0',
        envClass: 'prod',
        approvalUrl: 'https://portal.local/approvals/apr_9f21c0',
      },
    },
    {
      kind: 'runtime',
      href: '/approvals/apr_2b7e14',
      application: 'JD Edwards — Accounts Payable',
      sensitivity: 'financial',
      approval: {
        approvalId: 'apr_2b7e14',
        state: 'pending',
        requester: { subject: 'daniel.owusu@example.com', displayName: 'Daniel Owusu' },
        requesterRole: 'p2p',
        approvers: [{ subject: 'meera.rao@example.com', displayName: 'Meera Rao' }],
        raisedAt: new Date(now - 2 * MIN).toISOString(),
        // Plenty of time left — still pins above every definitional row.
        expiresAt: new Date(now + 25 * MIN).toISOString(),
        planHash: 'sha256:a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9',
        argsCanonicalHash: 'sha256:9f8e7d6c5b4a392817f6e5d4c3b2a190f8e7d6c5b4a392817f6e5d4c3b2a190',
        toolId: 'jde.ap.voucher.create',
        toolVersion: '1.0.0',
        envClass: 'prod',
        approvalUrl: 'https://portal.local/approvals/apr_2b7e14',
      },
    },
    {
      kind: 'runtime',
      href: '/approvals/apr_004abc',
      application: 'JD Edwards — Accounts Payable',
      sensitivity: 'financial',
      approval: {
        approvalId: 'apr_004abc',
        state: 'expired',
        requester: { subject: 'daniel.owusu@example.com', displayName: 'Daniel Owusu' },
        requesterRole: 'p2p',
        approvers: [{ subject: 'meera.rao@example.com', displayName: 'Meera Rao' }],
        raisedAt: new Date(now - 3 * 24 * 60 * MIN).toISOString(),
        expiresAt: new Date(now - 3 * 24 * 60 * MIN + 30 * MIN).toISOString(),
        planHash: 'sha256:0011223344556677889900112233445566778899001122334455667788990a',
        argsCanonicalHash: 'sha256:1122334455667788990011223344556677889900112233445566778899001b',
        toolId: 'jde.ap.voucher.cancel',
        toolVersion: '1.0.0',
        envClass: 'prod',
      },
    },
    {
      kind: 'definitional',
      id: 'chg_p2p_role_widen',
      title: 'Widen p2p role to include jde.ap.voucher.approve',
      state: 'in_review',
      author: 'priya.raman@example.com',
      createdAt: new Date(now - 26 * 60 * MIN).toISOString(),
      href: '/build/chg_p2p_role_widen',
      application: 'JD Edwards — Accounts Payable',
    },
    {
      kind: 'definitional',
      id: 'chg_ar_probe_note',
      title: 'Correct disambiguation copy on jde.ar.invoice.search',
      state: 'withdrawn',
      author: 'daniel.owusu@example.com',
      createdAt: new Date(now - 9 * 24 * 60 * MIN).toISOString(),
      href: '/build/chg_ar_probe_note',
      application: 'JD Edwards — Accounts Receivable',
    },
  ];
}
