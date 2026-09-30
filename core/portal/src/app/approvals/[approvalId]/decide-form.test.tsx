// @vitest-environment jsdom
//
// W0-P25: the decision form forwards a verdict and shows the gateway's answer.
// It carries no approver field, shows a refusal with its `next`, and says
// that approving does not execute anything.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => cleanup());

import type { DecisionState } from './actions';
import { DecideForm } from './decide-form';

function renderForm(action: (prev: DecisionState, form: FormData) => Promise<DecisionState>) {
  return render(<DecideForm approvalId="apr_1" requester="local:requester" action={action} />);
}

describe('DecideForm', () => {
  it('sends the approval id and the verdict, and nothing that names an approver', async () => {
    const action = vi.fn<(prev: DecisionState, form: FormData) => Promise<DecisionState>>(() =>
      Promise.resolve({
        status: 'decided',
        decision: 'approved',
        auditCallId: 'call_1',
        next: 'The requester executes it.',
      }),
    );
    const { container } = renderForm(action);
    expect(container.querySelector('[name*="approver" i]')).toBeNull();
    expect(screen.getByText(/Approving does not run anything/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.getByTestId('approval-decided')).toBeTruthy());
    const form = action.mock.calls[0]![1];
    expect(form.get('approvalId')).toBe('apr_1');
    expect(form.get('decision')).toBe('approved');
    expect(screen.getByTestId('approval-decided-next').textContent).toContain(
      'The requester executes it.',
    );
  });

  it('shows a refusal with its code and next, and stays decidable', async () => {
    const action = (): Promise<DecisionState> =>
      Promise.resolve({
        status: 'refused',
        code: 'POLICY_GUARDRAIL_BREACH',
        message: 'You raised this request.',
        next: 'Ask a different named approver to decide it.',
      });
    renderForm(action);
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('POLICY_GUARDRAIL_BREACH');
    expect(screen.getByTestId('approval-decision-next').textContent).toContain(
      'Ask a different named approver',
    );
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  });
});
