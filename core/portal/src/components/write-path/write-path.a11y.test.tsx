// @vitest-environment jsdom
//
// W0-J7 — zero axe violations at `serious`/`critical` (03 §12.7's own
// threshold), same `vitest-axe`-for-`jest-axe` substitution as
// ../chips/chips.a11y.test.tsx and ../shell/shell.a11y.test.tsx.
import { cleanup, render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);

import { PlanReviewCard } from './index';
import type { PlanBodyView, ProbeIdentityView } from './types';

const identity: ProbeIdentityView = {
  subject: 'p.rao@ltm.example',
  displayName: 'Priya Rao',
  bindingType: 'plsql',
  carries: 'no',
  probeRef: 'probe/jde-fin/2026-08-20',
  compensatingControl: 'Wrapper schema records p_requested_by.',
};

const base: PlanBodyView = {
  plan: 'Create an AP voucher for supplier 4242 for 18,400.00 GBP. This creates an OPEN PAYABLE in JD Edwards.',
  effects: [
    { system: 'jde-fin', object: 'voucher', action: 'create', reversible: true },
    { system: 'jde-fin', object: 'gl_batch', action: 'post', reversible: false },
  ],
  warnings: ['PO 0000451 is only 60% receipted.'],
  reversal: {
    class: 'compensating-tool',
    tool: 'jde.ap.voucher.cancel',
    windowHours: 720,
    windowEndsAt: '2026-09-26T00:00:00.000Z',
  },
};

function card(plan: PlanBodyView) {
  return (
    <PlanReviewCard
      plan={plan}
      guardrails={[
        {
          id: 'amountCeiling',
          label: 'Amount ceiling',
          passed: true,
          valueChecked: '18,400.00 GBP against 50,000.00 GBP',
        },
        {
          id: 'periodOpen',
          label: 'Period open',
          passed: false,
          valueChecked: 'period 08 is closing',
          message: 'Period 08 closes at 18:00 today.',
        },
      ]}
      identity={identity}
      locked={{ args: { supplier: '4242', amount: 18400 }, argsCanonicalHash: 'a1b2c3d4e5f6' }}
      expiresAt={new Date(Date.now() + 300_000).toISOString()}
    />
  );
}

describe('write-path — axe (03 §12.7, serious/critical threshold)', () => {
  it('the reversible plan card has no serious or critical violations', async () => {
    const { container } = render(card(base));
    const results = await axe(container);
    expect(
      results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    ).toEqual([]);
  });

  it('the irreversible plan card has no serious or critical violations', async () => {
    const { container } = render(
      card({
        ...base,
        reversal: { class: 'irreversible', reason: 'JD Edwards has no reversal for this.' },
      }),
    );
    const results = await axe(container);
    expect(
      results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    ).toEqual([]);
  });
});
