// @vitest-environment jsdom
//
// W0-P32: a request the super admin decided themselves is marked as such on
// the approval page, and an ordinary decision is not.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ApprovalView } from '@/components/write-path';

import { ApprovalRequestDetail } from './approval-request-detail';

afterEach(() => cleanup());

const BASE: ApprovalView = {
  approvalId: 'apr_1',
  state: 'approved',
  requester: { subject: 'local:super' },
  approvers: [],
  decidedBy: { subject: 'local:super' },
  raisedAt: '2026-09-30T00:00:00Z',
  decidedAt: '2026-09-30T00:05:00Z',
  expiresAt: '2026-09-30T01:00:00Z',
  planHash: 'sha256:p',
  argsCanonicalHash: 'sha256:a',
  toolId: 'jde.ap.voucher.create',
  envClass: 'local',
};

function renderDetail(approval: ApprovalView) {
  return render(
    <ApprovalRequestDetail
      approval={approval}
      planText="This creates an OPEN PAYABLE in JD Edwards."
      application="jde · ap"
      sensitivity="financial"
    />,
  );
}

describe('ApprovalRequestDetail — self-approval (W0-P32)', () => {
  it('marks a self-approved decision', () => {
    renderDetail({ ...BASE, selfApproved: true });
    expect(screen.getByTestId('approval-self-approved').textContent).toContain('Self-approved');
  });

  it('shows no mark on an ordinary decision', () => {
    renderDetail({ ...BASE, decidedBy: { subject: 'local:other' } });
    expect(screen.queryByTestId('approval-self-approved')).toBeNull();
  });
});
