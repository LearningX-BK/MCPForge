// @vitest-environment jsdom
//
// W0-P3f: the approver sees the verified plan body through the real panel,
// and decides through the same action as W0-P25's form.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalView, PlanBodyView } from '@/components/write-path';

import type { DecisionState } from './actions';
import { ApprovalReview } from './approval-review';
import { VALUE_NOT_RECORDED } from './guardrail-facts';

afterEach(cleanup);

const APPROVAL: ApprovalView = {
  approvalId: 'apr_1',
  state: 'pending',
  requester: { subject: 'local:requester' },
  approvers: [],
  raisedAt: '2026-09-30T10:00:00.000Z',
  expiresAt: '2026-10-01T10:00:00.000Z',
  planHash: 'a'.repeat(64),
  argsCanonicalHash: 'b'.repeat(64),
  toolId: 'jde.ap.voucher.create',
  toolVersion: '1.0.0',
  envClass: 'local',
};

const PLAN: PlanBodyView = {
  plan: 'Create an AP voucher for supplier 4242 for 18400 GBP. This creates an OPEN PAYABLE in JD Edwards.',
  effects: [{ system: 'jde-fin-ap', object: 'voucher', action: 'create', reversible: true }],
  warnings: ['PO 0000451 is only 60% receipted.'],
  reversal: { class: 'compensating-tool', tool: 'jde.ap.voucher.cancel', windowHours: 720 },
};

const GUARDRAILS = [
  {
    id: 'maxNumeric-0',
    label: 'amount at most 250000',
    passed: true,
    valueChecked: VALUE_NOT_RECORDED,
  },
];

function renderReview(action: (prev: DecisionState, form: FormData) => Promise<DecisionState>) {
  return render(
    <ApprovalReview approval={APPROVAL} plan={PLAN} guardrails={GUARDRAILS} action={action} />,
  );
}

describe('ApprovalReview', () => {
  it('shows everything the requester saw: plan, effects, warnings, guardrails, reversal', () => {
    renderReview(() => Promise.resolve({ status: 'idle' }));
    expect(screen.getByTestId('plan-sentence').textContent).toBe(PLAN.plan);
    expect(document.body.textContent).toContain('PO 0000451 is only 60% receipted.');
    expect(document.body.textContent).toContain('amount at most 250000');
    expect(document.body.textContent).toContain('Not recorded');
    expect(screen.getByTestId('reversal-contract')).not.toBeNull();
    // No probe identity is available on this surface, and it says so.
    expect(screen.getByTestId('approver-identity-unprobed')).not.toBeNull();
  });

  it('Approve sends the approval id and verdict, and shows the recorded outcome', async () => {
    const action = vi.fn<(prev: DecisionState, form: FormData) => Promise<DecisionState>>(() =>
      Promise.resolve({
        status: 'decided',
        decision: 'approved',
        auditCallId: 'call_9',
        next: 'The requester executes it.',
      }),
    );
    renderReview(action);
    fireEvent.click(screen.getByTestId('approver-approve'));
    await waitFor(() => expect(screen.getByTestId('approval-decided')).not.toBeNull());
    const form = action.mock.calls[0]![1];
    expect(form.get('approvalId')).toBe('apr_1');
    expect(form.get('decision')).toBe('approved');
  });

  it('Decline sends the reason', async () => {
    const action = vi.fn<(prev: DecisionState, form: FormData) => Promise<DecisionState>>(() =>
      Promise.resolve({ status: 'idle' }),
    );
    renderReview(action);
    fireEvent.change(screen.getByTestId('approver-decline-reason'), {
      target: { value: 'Supplier on hold.' },
    });
    fireEvent.click(screen.getByTestId('approver-decline'));
    await waitFor(() => expect(action).toHaveBeenCalled());
    const form = action.mock.calls[0]![1];
    expect(form.get('decision')).toBe('rejected');
    expect(form.get('reason')).toBe('Supplier on hold.');
  });

  it('an expired refusal from the gateway renders through RefusalBanner, with its next', async () => {
    renderReview(() =>
      Promise.resolve({
        status: 'refused',
        code: 'PLAN_EXPIRED',
        message: 'Approval apr_1 expired before it was decided.',
        next: 'Nothing was executed. The requester must plan it again.',
      }),
    );
    fireEvent.click(screen.getByTestId('approver-approve'));
    const banner = await screen.findByTestId('refusal-banner');
    expect(banner.getAttribute('data-code')).toBe('PLAN_EXPIRED');
    expect(banner.textContent).toContain('The requester must plan it again.');
  });

  it('any other refusal is shown verbatim with its code and next', async () => {
    renderReview(() =>
      Promise.resolve({
        status: 'refused',
        code: 'POLICY_GUARDRAIL_BREACH',
        message: 'local:requester raised this request and may not also approve it.',
        next: 'Ask a different named approver.',
      }),
    );
    fireEvent.click(screen.getByTestId('approver-approve'));
    const alert = await screen.findByTestId('approval-decision-refused');
    expect(alert.textContent).toContain('POLICY_GUARDRAIL_BREACH');
    expect(screen.getByTestId('approval-decision-next').textContent).toContain(
      'Ask a different named approver.',
    );
  });
});
