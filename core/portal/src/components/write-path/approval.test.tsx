// @vitest-environment jsdom
//
// W0-J8 — the approval gate, both sides (03 §7.4). The assertions that matter
// most here are the negative ones: the approver has no execute affordance, and
// no state but `approved` renders one for the requester either.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

import { ApprovalGateCard, ApproverDecisionPanel, ConfirmAction } from './index';
import type {
  ApprovalView,
  LockedArgsView,
  PlanBodyView,
  ProbeIdentityView,
} from './types';

const PLAN_TEXT =
  'Create an AP voucher for supplier 4242 (ACME LTD) for 18,400.00 GBP. This creates an OPEN PAYABLE in JD Edwards.';

const PLAN: PlanBodyView = {
  plan: PLAN_TEXT,
  effects: [{ system: 'jde-fin', object: 'voucher', action: 'create', reversible: true }],
  warnings: ['PO 0000451 is only 60% receipted.'],
  reversal: { class: 'compensating-tool', tool: 'jde.ap.voucher.cancel', windowHours: 720 },
};

const IDENTITY: ProbeIdentityView = {
  subject: 'p.rao@ltm.example',
  displayName: 'Priya Rao',
  bindingType: 'plsql',
  carries: 'no',
  probeRef: 'probe/jde-fin/2026-08-20',
  compensatingControl: 'Wrapper schema records p_requested_by.',
};

const LOCKED: LockedArgsView = {
  args: { supplier: '4242', amount: 18400 },
  argsCanonicalHash: 'aaaabbbbccccdddd',
};

const PENDING: ApprovalView = {
  approvalId: 'apr_01J8XYZ',
  state: 'pending',
  requester: { subject: 'p.rao@ltm.example', displayName: 'Priya Rao' },
  requesterRole: 'p2p-clerk',
  approvers: [{ subject: 'm.rao@ltm.example', displayName: 'Meera Rao' }],
  raisedAt: '2026-09-08T14:02:00.000Z',
  expiresAt: '2026-09-09T14:02:00.000Z',
  planHash: 'deadbeefcafef00d1234',
  argsCanonicalHash: 'aaaabbbbccccdddd',
  toolId: 'jde.ap.voucher.create',
  toolVersion: '1.2.0',
  envClass: 'prod',
  approvalUrl: 'https://forge.local/approvals/apr_01J8XYZ',
};

function gate(approval: ApprovalView, confirmAction?: React.ReactNode) {
  return render(
    <ApprovalGateCard
      approval={approval}
      plan={PLAN}
      identity={IDENTITY}
      locked={LOCKED}
      confirmAction={confirmAction}
    />,
  );
}

const CONFIRM = (
  <ConfirmAction
    consequence={{
      reversalClass: 'compensating-tool',
      sensitivity: 'financial',
      envClass: 'prod',
      entityName: 'voucher',
    }}
    onConfirm={() => {}}
  />
);

describe('ApprovalGateCard — the requester’s view', () => {
  it('keeps the same plan content and replaces the actions with a status block', () => {
    gate(PENDING);
    expect(screen.getByTestId('plan-sentence').textContent).toBe(PLAN_TEXT);
    expect(screen.getByTestId('approval-status-block')).toBeTruthy();
    expect(screen.getByText('apr_01J8XYZ')).toBeTruthy();
  });

  it('names a person and a time — not a spinner', () => {
    gate(PENDING);
    const sentence = screen.getByTestId('approval-state-sentence').textContent ?? '';
    expect(sentence).toContain('Meera Rao');
    expect(sentence).toContain('m.rao@ltm.example');
    expect(sentence).toMatch(/since \d{2}:\d{2}/);

    // No spinner of any kind is the feedback.
    const block = screen.getByTestId('approval-status-block');
    expect(block.querySelector('[role="progressbar"]')).toBeNull();
    expect(block.querySelector('.animate-spin')).toBeNull();
  });

  it('carries the copyable approval link', () => {
    gate(PENDING);
    expect(screen.getByTestId('approval-link').getAttribute('href')).toBe(
      'https://forge.local/approvals/apr_01J8XYZ',
    );
  });

  it('renders NO confirm affordance while pending, even when one is supplied', () => {
    gate(PENDING, CONFIRM);
    expect(screen.queryByTestId('approval-confirm-slot')).toBeNull();
    expect(screen.queryByTestId('confirm-submit')).toBeNull();
  });

  it('renders NO confirm affordance for a declined or expired approval either', () => {
    for (const state of ['rejected', 'expired'] as const) {
      cleanup();
      gate({ ...PENDING, state, decidedBy: { subject: 'm.rao@ltm.example' } }, CONFIRM);
      expect(screen.queryByTestId('confirm-submit')).toBeNull();
    }
  });

  it('on APPROVED the confirm action goes live — the requester executes', () => {
    gate(
      {
        ...PENDING,
        state: 'approved',
        decidedBy: { subject: 'm.rao@ltm.example', displayName: 'Meera Rao' },
        decidedAt: '2026-09-08T14:20:00.000Z',
      },
      CONFIRM,
    );
    expect(screen.getByTestId('approval-confirm-slot')).toBeTruthy();
    expect(screen.getByTestId('confirm-submit')).toBeTruthy();
    expect(screen.getByTestId('approval-state-sentence').textContent).toContain(
      'the approver did not',
    );
  });

  it('an expired approval says so, rather than disappearing', () => {
    gate({ ...PENDING, state: 'expired' });
    expect(screen.getByTestId('approval-state-sentence').textContent).toContain('expired');
    expect(screen.getByTestId('plan-sentence').textContent).toBe(PLAN_TEXT);
  });
});

describe('ApproverDecisionPanel — the approver’s view', () => {
  function panel(approval: ApprovalView, handlers: Partial<{
    onApprove: (note?: string) => void;
    onDecline: (reason: string) => void;
  }> = {}) {
    return render(
      <ApproverDecisionPanel
        approval={approval}
        plan={PLAN}
        guardrails={[
          {
            id: 'amountCeiling',
            label: 'Amount ceiling',
            passed: true,
            valueChecked: '18,400.00 GBP against 50,000.00 GBP',
          },
        ]}
        identity={IDENTITY}
        {...handlers}
      />,
    );
  }

  it('shows the plan text unmodified, and the plan hash short form', () => {
    panel(PENDING);
    expect(screen.getByTestId('plan-sentence').textContent).toBe(PLAN_TEXT);
    // First 8 chars of `deadbeefcafef00d1234`.
    expect(screen.getByTestId('approval-plan-hash').textContent).toContain('deadbeef');
    expect(screen.getByTestId('approval-plan-hash').textContent).toContain('this exact plan');
  });

  it('names who is asking, under which role, which tool and which environment', () => {
    panel(PENDING);
    expect(screen.getByTestId('approval-requester').textContent).toContain('Priya Rao');
    expect(screen.getByTestId('approval-requester-role').textContent).toBe('p2p-clerk');
    expect(screen.getByTestId('approval-tool').textContent).toContain('jde.ap.voucher.create');
    expect(screen.getByText('Production')).toBeTruthy();
  });

  it('reuses the requester’s blocks — effects, warnings, guardrails, reversal, identity', () => {
    panel(PENDING);
    expect(screen.getByTestId('effects-table')).toBeTruthy();
    expect(screen.getByTestId('guardrail-list')).toBeTruthy();
    expect(screen.getByText('PO 0000451 is only 60% receipted.')).toBeTruthy();
  });

  it('has Approve, Decline and Approve-with-note — and NO execute affordance', () => {
    panel(PENDING);
    expect(screen.getByTestId('approver-approve')).toBeTruthy();
    expect(screen.getByTestId('approver-decline')).toBeTruthy();

    // The structural claim: nothing in this panel can execute.
    const root = screen.getByTestId('approver-decision-panel');
    expect(root.querySelector('[data-testid="confirm-submit"]')).toBeNull();
    expect(root.querySelector('[data-testid="confirm-action"]')).toBeNull();
    const text = (root.textContent ?? '').toLowerCase();
    expect(text).not.toContain('confirm and execute');
    expect(screen.getByTestId('approver-actions').textContent).toContain(
      'does not execute this call',
    );
  });

  it('the Approve button becomes "Approve with note" and passes the note', () => {
    const onApprove = vi.fn();
    panel(PENDING, { onApprove });

    fireEvent.click(screen.getByTestId('approver-approve'));
    expect(onApprove).toHaveBeenCalledWith(undefined);

    fireEvent.change(screen.getByTestId('approver-note'), {
      target: { value: 'Checked the PO receipt.' },
    });
    expect(screen.getByTestId('approver-approve').textContent).toBe('Approve with note');
    fireEvent.click(screen.getByTestId('approver-approve'));
    expect(onApprove).toHaveBeenLastCalledWith('Checked the PO receipt.');
  });

  it('Decline is really disabled until a non-blank reason is typed', () => {
    const onDecline = vi.fn();
    panel(PENDING, { onDecline });
    const decline = screen.getByTestId('approver-decline') as HTMLButtonElement;

    expect(decline.hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('approver-decline-hint')).toBeTruthy();

    // Whitespace is not a reason.
    fireEvent.change(screen.getByTestId('approver-decline-reason'), { target: { value: '   ' } });
    expect(decline.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('approver-decline-reason'), {
      target: { value: '  PO is not fully receipted.  ' },
    });
    expect(decline.disabled).toBe(false);
    fireEvent.click(decline);
    expect(onDecline).toHaveBeenCalledWith('PO is not fully receipted.');
  });

  it('an EXPIRED approval renders as expired, with the plan still shown and no decision', () => {
    panel({ ...PENDING, state: 'expired' });
    expect(screen.getByTestId('plan-sentence').textContent).toBe(PLAN_TEXT);
    expect(screen.getByTestId('approver-expired').textContent).toContain('expired');
    expect(screen.queryByTestId('approver-approve')).toBeNull();
    expect(screen.queryByTestId('approver-decline')).toBeNull();
  });

  it('an already-decided approval shows the decision, not the controls', () => {
    panel({
      ...PENDING,
      state: 'rejected',
      decidedBy: { subject: 'm.rao@ltm.example', displayName: 'Meera Rao' },
      decidedAt: '2026-09-08T14:20:00.000Z',
      decisionReason: 'PO is not fully receipted.',
    });
    const decided = screen.getByTestId('approver-decided').textContent ?? '';
    expect(decided).toContain('Declined');
    expect(decided).toContain('Meera Rao');
    expect(decided).toContain('PO is not fully receipted.');
    expect(screen.queryByTestId('approver-approve')).toBeNull();
  });
});
