// @vitest-environment jsdom
//
// W0-J8 — zero axe violations at `serious`/`critical` (03 §12.7's threshold),
// sibling to W0-J7's ./write-path.a11y.test.tsx and using the same
// `vitest-axe`-for-`jest-axe` substitution.
//
// Two extra assertions live here rather than in the behaviour tests because
// they ARE the accessibility contract 03 §12.7 states in words:
//   - the type-to-confirm field is labelled;
//   - refusals announce on `role="alert"` (assertive).
import { cleanup, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);

import {
  ApprovalGateCard,
  ApproverDecisionPanel,
  ConfirmAction,
  RefusalBanner,
  RefusedPlanCard,
} from './index';
import type {
  ApprovalView,
  LockedArgsView,
  PlanBodyView,
  ProbeIdentityView,
} from './types';

const PLAN: PlanBodyView = {
  plan: 'Create an AP voucher for supplier 4242 for 18,400.00 GBP. This creates an OPEN PAYABLE in JD Edwards.',
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

const APPROVAL: ApprovalView = {
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
  envClass: 'prod',
  approvalUrl: 'https://forge.local/approvals/apr_01J8XYZ',
};

async function serious(container: HTMLElement) {
  const results = await axe(container);
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

describe('W0-J8 — axe (03 §12.7)', () => {
  it('every ConfirmAction variant is clean', async () => {
    for (const consequence of [
      { reversalClass: 'compensating-tool', sensitivity: 'internal', envClass: 'local' },
      { reversalClass: 'compensating-tool', sensitivity: 'financial', envClass: 'prod' },
      { reversalClass: 'irreversible', sensitivity: 'financial', envClass: 'prod', entityName: 'voucher' },
    ] as const) {
      cleanup();
      const { container } = render(
        <ConfirmAction consequence={consequence} onConfirm={() => {}} />,
      );
      expect(await serious(container)).toEqual([]);
    }
  });

  it('the type-to-confirm field has a real, associated label', () => {
    render(
      <ConfirmAction
        consequence={{
          reversalClass: 'irreversible',
          sensitivity: 'financial',
          envClass: 'prod',
          entityName: 'voucher',
        }}
        onConfirm={() => {}}
      />,
    );
    const input = screen.getByTestId('confirm-type-to-confirm') as HTMLInputElement;
    const label = screen.getByText('Type voucher to confirm') as HTMLLabelElement;
    expect(label.htmlFor).toBe(input.id);
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('every RefusalBanner variant is clean and announces on role="alert"', async () => {
    const refusals = [
      { code: 'PLAN_EXPIRED', next: 'Plan again.' },
      {
        code: 'PLAN_ARGUMENT_MISMATCH',
        next: 'Re-plan.',
        changes: [{ field: 'amount', planned: '100.00', presented: '100000.00' }],
      },
      {
        code: 'POLICY_GUARDRAIL_BREACH',
        message: 'You hold both create and approve.',
        rule: 'sodConflict',
        valueBreached: 'create ∩ approve',
        next: 'Ask another approver.',
        sodGrants: [
          { grant: 'jde.ap.voucher.create', role: 'p2p-clerk' },
          { grant: 'jde.ap.voucher.approve', role: 'p2p-approver' },
        ],
      },
    ] as const;

    for (const refusal of refusals) {
      cleanup();
      const { container } = render(<RefusalBanner refusal={refusal} />);
      expect(screen.getByTestId('refusal-banner').getAttribute('role')).toBe('alert');
      expect(await serious(container)).toEqual([]);
    }
  });

  it('the refused plan card is clean', async () => {
    const { container } = render(
      <RefusedPlanCard
        refusal={{ code: 'PLAN_EXPIRED', next: 'Plan again.' }}
        plan={PLAN}
        identity={IDENTITY}
        locked={LOCKED}
        expiresAt={new Date(Date.now() - 1000).toISOString()}
        onPlanAgain={() => {}}
      />,
    );
    expect(await serious(container)).toEqual([]);
  });

  it('the approval gate card is clean', async () => {
    const { container } = render(
      <ApprovalGateCard approval={APPROVAL} plan={PLAN} identity={IDENTITY} locked={LOCKED} />,
    );
    expect(await serious(container)).toEqual([]);
  });

  it('the approver decision panel is clean, pending and expired', async () => {
    for (const state of ['pending', 'expired'] as const) {
      cleanup();
      const { container } = render(
        <ApproverDecisionPanel
          approval={{ ...APPROVAL, state }}
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
        />,
      );
      expect(await serious(container)).toEqual([]);
    }
  });
});
