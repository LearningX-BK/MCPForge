// @vitest-environment jsdom
//
// MCPForge — W0-P5b: a runtime approval decision carries the signed-in viewer,
// never an invented approver (W0-P4 §1: the page used to write
// `meera.rao@example.com` into every decision).

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
}));

import { loadApprovalQueue } from '../fixtures';
import { ApprovalDecision } from './approval-decision';

afterEach(cleanup);

function firstRuntimeId(): string {
  const entry = loadApprovalQueue().find((e) => e.kind === 'runtime');
  if (entry === undefined || entry.kind !== 'runtime')
    throw new Error('fixture has no runtime approval');
  return entry.approval.approvalId;
}

describe('ApprovalDecision', () => {
  it('records the signed-in viewer as the approver', () => {
    render(
      <ApprovalDecision
        approvalId={firstRuntimeId()}
        viewer={{ subject: 'local:arjun', displayName: 'Arjun Mehta', personas: [], persona: null }}
      />,
    );
    fireEvent.click(screen.getByTestId('approver-approve'));
    const decided = screen.getByTestId('approver-decided');
    expect(decided.textContent).toContain('Approved by');
    expect(decided.textContent).toContain('Arjun Mehta');
    expect(decided.textContent).not.toContain('Meera');
  });

  it('with nobody signed in, records nothing and says why', () => {
    render(<ApprovalDecision approvalId={firstRuntimeId()} viewer={null} />);
    fireEvent.click(screen.getByTestId('approver-approve'));
    expect(screen.queryByTestId('approver-decided')).toBeNull();
    expect(screen.getByTestId('approver-decision-panel').getAttribute('data-approval-state')).toBe(
      'pending',
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'Sign in, then decide this approval; it stays pending until you do.',
    );
  });
});
