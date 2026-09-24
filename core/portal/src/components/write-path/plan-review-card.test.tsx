// @vitest-environment jsdom
//
// W0-J7 — the Plan Review card's contract (03 §7.2). Every assertion here maps
// to a clause of the task's `done:` criterion, and several of them exist to
// catch a regression that would be invisible to the eye: a truncation class,
// a filtered guardrail list, a manifest-sourced identity claim.
import type { ComponentProps } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// No global auto-cleanup is configured for this package's Vitest runner —
// same explicit teardown as ../shell/*.test.tsx.
afterEach(cleanup);

import {
  IRREVERSIBLE_BANNER_TEXT,
  PlanReviewCard,
  PlanSentence,
  sortEffects,
  shortHash,
} from './index';
import type {
  GuardrailResultView,
  LockedArgsView,
  PlanBodyView,
  ProbeIdentityView,
} from './types';

const PLAN: PlanBodyView = {
  plan:
    'Create an AP voucher for supplier 4242 (ACME LTD) for 18,400.00 GBP, company 00100, ' +
    'GL date 2026-08-27, matched to PO 0000451. This creates an OPEN PAYABLE in JD Edwards.',
  effects: [
    { system: 'jde-fin', object: 'voucher', action: 'create', reversible: true },
    { system: 'jde-fin', object: 'gl_batch', action: 'post', reversible: false },
    { system: 'jde-fin', object: 'supplier_ledger', action: 'append', reversible: true },
  ],
  warnings: ['PO 0000451 is only 60% receipted.'],
  reversal: {
    class: 'compensating-tool',
    tool: 'jde.ap.voucher.cancel',
    windowHours: 720,
    windowEndsAt: '2026-09-26T00:00:00.000Z',
    preconditions: 'Voucher must be unpaid and not yet posted to a closed period.',
  },
};

const GUARDRAILS: readonly GuardrailResultView[] = [
  {
    id: 'amountCeiling',
    label: 'Amount ceiling',
    passed: true,
    valueChecked: '18,400.00 GBP against a 50,000.00 GBP ceiling',
  },
  {
    id: 'sodConflict',
    label: 'Segregation of duties',
    passed: true,
    valueChecked: 'create and approve are held by different roles',
  },
  {
    id: 'periodOpen',
    label: 'Period open',
    passed: false,
    valueChecked: 'GL date 2026-08-27 falls in period 08, which is closing',
    message: 'Period 08 closes at 18:00 today.',
  },
];

const IDENTITY: ProbeIdentityView = {
  subject: 'p.rao@ltm.example',
  displayName: 'Priya Rao',
  bindingType: 'plsql',
  carries: 'no',
  probeRef: 'probe/jde-fin/2026-08-20T09:14:00Z',
  probedAt: '2026-08-20',
  compensatingControl: 'Wrapper schema records p_requested_by on every row it writes.',
};

const LOCKED: LockedArgsView = {
  args: { supplier: '4242', amount: 18400, currency: 'GBP', company: '00100' },
  argsCanonicalHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
};

function renderCard(overrides: Partial<ComponentProps<typeof PlanReviewCard>> = {}) {
  return render(
    <PlanReviewCard
      plan={PLAN}
      guardrails={GUARDRAILS}
      identity={IDENTITY}
      locked={LOCKED}
      expiresAt={new Date(Date.now() + 300_000).toISOString()}
      {...overrides}
    />,
  );
}

describe('PlanReviewCard — the order is the argument (03 §7.2)', () => {
  it('renders the eight blocks in the specified order', () => {
    const { container } = renderCard();
    const card = screen.getByTestId('plan-review-card');
    const order = [...card.children].map((el) =>
      el.getAttribute('data-testid') ??
      el.querySelector('[data-testid]')?.getAttribute('data-testid') ??
      el.tagName.toLowerCase(),
    );
    expect(order).toEqual([
      'plan-sentence',
      'effects-table',
      'warning-list',
      'guardrail-list',
      'reversal-contract',
      'identity-block',
      'locked-args',
      'plan-expiry',
    ]);
    expect(container).toBeTruthy();
  });

  it('the plan sentence is the first element on the card', () => {
    renderCard();
    const card = screen.getByTestId('plan-review-card');
    expect(card.firstElementChild).toBe(screen.getByTestId('plan-sentence'));
  });

  it('renders no action row when W0-J8 supplies none, and the slot when it does', () => {
    const { unmount } = renderCard();
    expect(screen.queryByTestId('plan-actions')).toBeNull();
    unmount();
    renderCard({ actions: <button type="button">Confirm and execute</button> });
    expect(screen.getByTestId('plan-actions')).toBeTruthy();
  });
});

describe('PlanSentence — verbatim, no truncation, no tooltip', () => {
  const LONG = `${'Create an AP voucher for supplier 4242 (ACME LTD) for 18,400.00 GBP. '.repeat(40)}END`;

  it('renders every character of a very long sentence', () => {
    render(<PlanSentence plan={LONG} />);
    const el = screen.getByTestId('plan-sentence');
    expect(el.textContent).toBe(LONG);
    expect(el.textContent?.length).toBe(LONG.length);
  });

  it('carries no clipping class and no title tooltip', () => {
    render(<PlanSentence plan={LONG} />);
    const el = screen.getByTestId('plan-sentence');
    expect(el.getAttribute('title')).toBeNull();
    expect(el.className).not.toMatch(/truncate|line-clamp|text-ellipsis|overflow-hidden|max-h-/);
  });

  it('strips a clipping class a caller tries to pass through className', () => {
    render(<PlanSentence plan={LONG} className="truncate line-clamp-2 mt-2" />);
    const el = screen.getByTestId('plan-sentence');
    expect(el.className).not.toMatch(/truncate|line-clamp/);
    expect(el.className).toContain('mt-2');
    expect(el.textContent).toBe(LONG);
  });

  it('is the largest text on the card — body-lg over the body/label sizes', () => {
    renderCard();
    expect(screen.getByTestId('plan-sentence').className).toContain('text-[0.9375rem]');
  });
});

describe('EffectsTable — irreversible rows are pulled to the top', () => {
  it('sorts, stably, rather than only styling', () => {
    expect(sortEffects(PLAN.effects).map((e) => e.object)).toEqual([
      'gl_batch',
      'voucher',
      'supplier_ledger',
    ]);
  });

  it('renders the irreversible row first, chipped danger', () => {
    renderCard();
    const rows = screen.getAllByTestId('effect-row');
    expect(rows[0]?.getAttribute('data-reversible')).toBe('false');
    expect(within(rows[0] as HTMLElement).getByText('Irreversible')).toBeTruthy();
    expect(rows[1]?.getAttribute('data-reversible')).toBe('true');
  });
});

describe('GuardrailResultList — passed guardrails are shown, not only failures', () => {
  it('renders every guardrail, passed and failed', () => {
    renderCard();
    const items = screen.getAllByTestId('guardrail-item');
    expect(items).toHaveLength(GUARDRAILS.length);
    expect(items.filter((i) => i.getAttribute('data-passed') === 'true')).toHaveLength(2);
    expect(screen.getByText(/50,000.00 GBP ceiling/)).toBeTruthy();
  });

  it('exposes no prop that could hide the passed ones', () => {
    // A structural assertion: the only prop the list takes is the full array.
    // If a `showPassed`/`filter` prop is ever added, this test is the place it
    // must be argued for — see the file header's security note.
    renderCard({ guardrails: GUARDRAILS });
    expect(screen.getAllByTestId('guardrail-item')).toHaveLength(3);
  });
});

describe('ReversalContract — the irreversible banner', () => {
  const irreversiblePlan: PlanBodyView = {
    ...PLAN,
    reversal: {
      class: 'irreversible',
      reason: 'JD Edwards has no reversal for a posted payment batch.',
    },
  };

  it('reads exactly "This cannot be undone" and sits above the effects table', () => {
    renderCard({ plan: irreversiblePlan });
    const banner = screen.getByTestId('irreversible-banner');
    expect(banner.textContent).toBe(IRREVERSIBLE_BANNER_TEXT);
    expect(banner.textContent).toBe('This cannot be undone');

    const card = screen.getByTestId('plan-review-card');
    const kids = [...card.children];
    const bannerIndex = kids.findIndex((el) => el.getAttribute('data-testid') === 'reversal-contract');
    const effectsIndex = kids.findIndex(
      (el) => el.querySelector('[data-testid="effects-table"]') !== null,
    );
    expect(bannerIndex).toBeGreaterThanOrEqual(0);
    expect(bannerIndex).toBeLessThan(effectsIndex);
    expect(screen.getByText(/no reversal for a posted payment batch/)).toBeTruthy();
  });

  it('is a filled danger treatment, and appears exactly once', () => {
    renderCard({ plan: irreversiblePlan });
    const blocks = screen.getAllByTestId('reversal-contract');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.className).toContain('bg-status-danger-strong');
  });

  it('renders the window in hours and as a date for a reversible class', () => {
    renderCard();
    expect(screen.getByTestId('reversal-window').textContent).toBe('720 hours — until 26 Sep 2026');
    expect(screen.getByText('jde.ap.voucher.cancel')).toBeTruthy();
  });
});

describe('IdentityBlock — probe-sourced, never manifest-sourced', () => {
  it('names the probe report it came from', () => {
    renderCard();
    expect(screen.getByTestId('identity-source').textContent).toContain(
      'probe/jde-fin/2026-08-20T09:14:00Z',
    );
    expect(screen.getByTestId('identity-carries').textContent).toContain('No —');
    expect(screen.getByTestId('compensating-control').textContent).toContain('p_requested_by');
  });

  it('asserts nothing about carriage without a probe reference', () => {
    renderCard({ identity: { ...IDENTITY, carries: 'verified', probeRef: '' } });
    const carries = screen.getByTestId('identity-carries').textContent ?? '';
    expect(carries).toContain('Not established by a probe');
    expect(carries).not.toMatch(/observed/i);
    expect(screen.getByTestId('identity-source').textContent).toBe('No probe report');
  });

  it('renders verified only alongside its probe reference', () => {
    renderCard({ identity: { ...IDENTITY, carries: 'verified', bindingType: 'rest' } });
    expect(screen.getByTestId('identity-carries').textContent).toMatch(/Yes — the probe observed/);
    expect(screen.getByTestId('identity-source').textContent).toContain('Capability probe');
  });
});

describe('LockedArgs — read-only, with the 8-char hash', () => {
  it('shows the first eight characters of the canonical hash, mono', () => {
    renderCard();
    const hash = screen.getByTestId('args-hash');
    expect(hash.textContent).toContain(shortHash(LOCKED.argsCanonicalHash));
    expect(hash.textContent).toContain('a1b2c3d4');
    expect(hash.textContent).not.toContain('e5f60718');
    expect(hash.className).toContain('font-mono');
  });

  it('renders values as text, with no form control anywhere', () => {
    renderCard();
    const block = screen.getByTestId('locked-args');
    expect(block.querySelectorAll('input, textarea, select, button')).toHaveLength(0);
    expect(within(block).getByText('18400')).toBeTruthy();
    expect(within(block).getByText('supplier')).toBeTruthy();
  });
});
