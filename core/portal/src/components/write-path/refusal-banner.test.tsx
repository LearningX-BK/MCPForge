// @vitest-environment jsdom
//
// W0-J8 — the three refusal states (03 §7.3). "Distinct, explained outcomes,
// not toasts."
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);

import { RefusalBanner, RefusedPlanCard } from './index';
import type {
  GuardrailResultView,
  LockedArgsView,
  PlanBodyView,
  ProbeIdentityView,
  RefusalView,
} from './types';

const PLAN_TEXT =
  'Create an AP voucher for supplier 4242 (ACME LTD) for 18,400.00 GBP. This creates an OPEN PAYABLE in JD Edwards.';

const PLAN: PlanBodyView = {
  plan: PLAN_TEXT,
  effects: [{ system: 'jde-fin', object: 'voucher', action: 'create', reversible: true }],
  warnings: [],
  reversal: { class: 'compensating-tool', tool: 'jde.ap.voucher.cancel', windowHours: 720 },
};

const IDENTITY: ProbeIdentityView = {
  subject: 'p.rao@ltm.example',
  bindingType: 'plsql',
  carries: 'no',
  probeRef: 'probe/jde-fin/2026-08-20',
  compensatingControl: 'Wrapper schema records p_requested_by.',
};

const LOCKED: LockedArgsView = {
  args: { supplier: '4242', amount: 18400 },
  argsCanonicalHash: 'a1b2c3d4e5f60000',
};

const GUARDRAILS: readonly GuardrailResultView[] = [];

describe('RefusalBanner — every variant', () => {
  it('announces assertively on role="alert" — never a toast', () => {
    const refusal: RefusalView = { code: 'PLAN_EXPIRED', next: 'Plan again.' };
    render(<RefusalBanner refusal={refusal} />);
    expect(screen.getByTestId('refusal-banner').getAttribute('role')).toBe('alert');
  });

  it('always renders the `next` (non-negotiable #5)', () => {
    render(
      <RefusalBanner
        refusal={{ code: 'PLAN_EXPIRED', next: 'Call jde.ap.voucher.create again to re-plan.' }}
      />,
    );
    expect(screen.getByTestId('refusal-next').textContent).toContain('jde.ap.voucher.create');
  });
});

describe('PLAN_EXPIRED', () => {
  const refusal: RefusalView = { code: 'PLAN_EXPIRED', next: 'Plan again to get a fresh plan.' };

  it('greys the card, keeps the ORIGINAL plan text visible, and offers only Plan again', () => {
    render(
      <RefusedPlanCard
        refusal={refusal}
        plan={PLAN}
        guardrails={GUARDRAILS}
        identity={IDENTITY}
        locked={LOCKED}
        expiresAt={new Date(Date.now() - 60_000).toISOString()}
        onPlanAgain={() => {}}
      />,
    );

    // The plan the user lost is still on screen, verbatim.
    expect(screen.getByTestId('plan-sentence').textContent).toBe(PLAN_TEXT);

    // The card greys, and says so to assistive tech.
    const body = screen.getByTestId('refused-plan-body');
    expect(body.className).toContain('opacity-60');
    expect(body.getAttribute('aria-disabled')).toBe('true');

    // The countdown reads "Expired".
    expect(screen.getByTestId('plan-expiry-text').textContent).toBe('Expired');

    // The only action.
    expect(screen.getByTestId('plan-again')).toBeTruthy();
    expect(screen.queryByTestId('confirm-submit')).toBeNull();
  });

  it('the refusal banner itself is NOT greyed — the explanation stays live', () => {
    const { container } = render(
      <RefusedPlanCard refusal={refusal} plan={PLAN} identity={IDENTITY} locked={LOCKED} />,
    );
    const banner = screen.getByTestId('refusal-banner');
    expect(container.querySelector('[data-testid="refused-plan-body"]')?.contains(banner)).toBe(
      false,
    );
  });
});

describe('PLAN_ARGUMENT_MISMATCH — the £100 / £100,000 case', () => {
  const refusal: RefusalView = {
    code: 'PLAN_ARGUMENT_MISMATCH',
    next: 'Re-plan with the arguments you intend to send.',
    changes: [
      { field: 'amount', planned: '100.00', presented: '100000.00' },
      { field: 'supplier', planned: '4242', presented: '9999' },
      { field: 'currency', planned: undefined, presented: 'USD' },
    ],
  };

  it('names EVERY changed field, with planned and presented side by side', () => {
    render(<RefusalBanner refusal={refusal} />);
    const rows = screen.getAllByTestId('refusal-change-row');
    expect(rows).toHaveLength(3);

    const amount = rows.find((r) => r.dataset['field'] === 'amount')!;
    expect(within(amount).getByTestId('refusal-change-planned').textContent).toBe('100.00');
    expect(within(amount).getByTestId('refusal-change-presented').textContent).toBe('100000.00');

    const supplier = rows.find((r) => r.dataset['field'] === 'supplier')!;
    expect(within(supplier).getByTestId('refusal-change-planned').textContent).toBe('4242');
    expect(within(supplier).getByTestId('refusal-change-presented').textContent).toBe('9999');

    // An argument that was absent at plan time is still named, not skipped.
    const currency = rows.find((r) => r.dataset['field'] === 'currency')!;
    expect(within(currency).getByTestId('refusal-change-planned').textContent).toContain('absent');
    expect(within(currency).getByTestId('refusal-change-presented').textContent).toBe('USD');
  });

  it('never says "invalid request"', () => {
    render(<RefusalBanner refusal={refusal} />);
    expect(screen.getByTestId('refusal-banner').textContent?.toLowerCase()).not.toContain(
      'invalid request',
    );
  });

  it('renders every changed field even for a long list — no cap, no expander', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      field: `line_${i}`,
      planned: String(i),
      presented: String(i * 1000),
    }));
    render(<RefusalBanner refusal={{ ...refusal, changes: many }} />);
    expect(screen.getAllByTestId('refusal-change-row')).toHaveLength(12);
    expect(screen.getByTestId('refusal-banner').querySelector('details')).toBeNull();
  });
});

describe('POLICY_GUARDRAIL_BREACH', () => {
  it('shows the guardrail’s own message, the rule, the breaching value and the next', () => {
    render(
      <RefusalBanner
        refusal={{
          code: 'POLICY_GUARDRAIL_BREACH',
          message: 'Vouchers over 50,000.00 GBP need a finance director.',
          rule: 'amountCeiling',
          valueBreached: '180,400.00 GBP against a 50,000.00 GBP ceiling',
          next: 'Split the voucher, or ask a holder of jde-fin-director to raise it.',
        }}
      />,
    );
    expect(screen.getByTestId('refusal-message').textContent).toBe(
      'Vouchers over 50,000.00 GBP need a finance director.',
    );
    expect(screen.getByTestId('refusal-rule').textContent).toBe('amountCeiling');
    expect(screen.getByTestId('refusal-value').textContent).toContain('180,400.00 GBP');
    expect(screen.getByTestId('refusal-next').textContent).toContain('jde-fin-director');
  });

  it('a sodConflict names each conflicting grant AND the role that produced it', () => {
    render(
      <RefusalBanner
        refusal={{
          code: 'POLICY_GUARDRAIL_BREACH',
          message: 'You hold both create and approve on this document.',
          rule: 'sodConflict',
          valueBreached: 'jde.ap.voucher.create ∩ jde.ap.voucher.approve',
          next: 'Ask a holder of jde-fin-approver who is not you to approve this.',
          sodGrants: [
            { grant: 'jde.ap.voucher.create', role: 'p2p-clerk' },
            { grant: 'jde.ap.voucher.approve', role: 'p2p-approver' },
          ],
        }}
      />,
    );

    const sod = screen.getByTestId('refusal-sod');
    const grants = within(sod).getAllByTestId('refusal-sod-grant');
    expect(grants).toHaveLength(2);
    expect(grants[0]!.textContent).toContain('jde.ap.voucher.create');
    expect(grants[0]!.textContent).toContain('p2p-clerk');
    expect(grants[1]!.textContent).toContain('jde.ap.voucher.approve');
    expect(grants[1]!.textContent).toContain('p2p-approver');

    // Both roles are individually identified, not merged into one sentence.
    expect(within(sod).getAllByTestId('refusal-sod-role').map((n) => n.textContent)).toEqual([
      'p2p-clerk',
      'p2p-approver',
    ]);
  });
});
