// @vitest-environment jsdom
//
// W0-J9 — 03 §7.5's reverse half, plus the stepper and the no-animation rule.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

import {
  ExecutionProgress,
  ResultCard,
  ReversalAction,
  WritePathStepper,
  deriveStepStates,
  formatReversalCountdown,
  reversalActionLabel,
} from './index';
import type {
  LockedArgsView,
  PlanBodyView,
  ProbeIdentityView,
  ReversalPlanView,
} from './types';

const NOW = Date.parse('2026-09-08T12:00:00.000Z');
const WINDOW_END = '2026-10-01T12:00:00.000Z'; // 23 days out

const REVERSAL_PLAN_BODY: PlanBodyView = {
  plan: 'Cancel voucher 00123456 for supplier 4242, 18,400.00 GBP. This CANCELS an OPEN PAYABLE in JD Edwards.',
  effects: [{ system: 'jde-fin', object: 'voucher', action: 'cancel', reversible: false }],
  warnings: [],
  reversal: { class: 'irreversible', reason: 'A cancelled voucher cannot be un-cancelled.' },
};

const IDENTITY: ProbeIdentityView = {
  subject: 'p.rao@ltm.example',
  bindingType: 'plsql',
  carries: 'no',
  probeRef: 'probe/jde-fin/2026-08-20',
};

const LOCKED: LockedArgsView = {
  args: { document_number: '00123456' },
  argsCanonicalHash: 'feedfacedeadbeef',
};

const REVERSAL_PLAN: ReversalPlanView = {
  plan: REVERSAL_PLAN_BODY,
  identity: IDENTITY,
  locked: LOCKED,
  // The reversal's OWN consequence — irreversible, so type-to-confirm.
  consequence: {
    reversalClass: 'irreversible',
    sensitivity: 'financial',
    envClass: 'prod',
    entityName: 'voucher',
  },
};

describe('ReversalAction — labelled with the actual reversing tool', () => {
  it('names the reversing tool id in the label, never "Undo"', () => {
    render(
      <ReversalAction
        originalCallId="call_01J9ABC"
        reversal={{
          class: 'compensating-tool',
          tool: 'jde.ap.voucher.cancel',
          windowHours: 720,
          windowEndsAt: WINDOW_END,
        }}
        reversalPlan={REVERSAL_PLAN}
        now={() => NOW}
      />,
    );
    const button = screen.getByTestId('reversal-initiate');
    expect(button.textContent).toBe('Reverse — cancel this voucher (jde.ap.voucher.cancel)');
    expect(button.textContent).toContain('jde.ap.voucher.cancel');
    expect(button.textContent).not.toContain('Undo');
    expect(screen.queryByText(/Undo/)).toBeNull();
  });

  it('the label builder is a pure function of the tool id', () => {
    expect(reversalActionLabel('jde.ap.voucher.cancel')).toBe(
      'Reverse — cancel this voucher (jde.ap.voucher.cancel)',
    );
    expect(reversalActionLabel('ebs.ap.payment_batch.cancel')).toBe(
      'Reverse — cancel this payment batch (ebs.ap.payment_batch.cancel)',
    );
  });

  it('renders the window as a countdown in days and a date', () => {
    expect(formatReversalCountdown(WINDOW_END, NOW)).toBe('23 days remaining — until 1 Oct 2026');
    render(
      <ReversalAction
        originalCallId="call_01J9ABC"
        reversal={{ class: 'compensating-tool', tool: 'jde.ap.voucher.cancel', windowEndsAt: WINDOW_END }}
        reversalPlan={REVERSAL_PLAN}
        now={() => NOW}
      />,
    );
    expect(screen.getByTestId('reversal-countdown').textContent).toBe(
      '23 days remaining — until 1 Oct 2026',
    );
  });

  it('renders preconditions with a real third "not checked" state', () => {
    render(
      <ReversalAction
        originalCallId="call_01J9ABC"
        reversal={{ class: 'compensating-tool', tool: 'jde.ap.voucher.cancel' }}
        preconditions={[
          { label: 'Voucher must be unpaid', satisfied: true },
          { label: 'Voucher must not be posted to a closed period', satisfied: undefined },
          { label: 'Batch must not be approved', satisfied: false },
        ]}
        reversalPlan={REVERSAL_PLAN}
        now={() => NOW}
      />,
    );
    const items = screen.getAllByTestId('reversal-precondition');
    expect(items.map((i) => i.getAttribute('data-satisfied'))).toEqual([
      'true',
      'unknown',
      'false',
    ]);
    // The unknown one is not presented as a pass.
    expect(items[1]?.textContent).toContain('not checked here');
  });
});

describe('ReversalAction — it runs the full plan → confirm sequence', () => {
  it('clicking Reverse surfaces a real PlanReviewCard + ConfirmAction, not a callback', () => {
    const onConfirmReversal = vi.fn();
    render(
      <ReversalAction
        originalCallId="call_01J9ABC"
        reversal={{ class: 'compensating-tool', tool: 'jde.ap.voucher.cancel', windowEndsAt: WINDOW_END }}
        reversalPlan={REVERSAL_PLAN}
        onConfirmReversal={onConfirmReversal}
        now={() => NOW}
      />,
    );

    fireEvent.click(screen.getByTestId('reversal-initiate'));

    // The real components from W0-J7 / W0-J8, not a local imitation.
    expect(screen.getByTestId('reversal-plan-sequence')).toBeTruthy();
    expect(screen.getByTestId('plan-review-card')).toBeTruthy();
    expect(screen.getByTestId('confirm-action')).toBeTruthy();
    // The reversal's own consequence drives its own friction.
    expect(screen.getByTestId('confirm-action').getAttribute('data-variant')).toBe(
      'type-to-confirm',
    );
    // Nothing fired merely by clicking Reverse.
    expect(onConfirmReversal).not.toHaveBeenCalled();

    // And the confirm is genuinely locked until the gesture is made.
    const submit = screen.getByTestId('confirm-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onConfirmReversal).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('confirm-type-to-confirm'), {
      target: { value: 'voucher' },
    });
    expect((screen.getByTestId('confirm-submit') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('confirm-submit'));
    expect(onConfirmReversal).toHaveBeenCalledTimes(1);
  });

  it('fails closed when no reversal plan is supplied — disabled, with a visible reason', () => {
    render(
      <ReversalAction
        originalCallId="call_01J9ABC"
        reversal={{ class: 'compensating-tool', tool: 'jde.ap.voucher.cancel' }}
        now={() => NOW}
      />,
    );
    const button = screen.getByTestId('reversal-initiate') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId('reversal-disabled-reason').textContent).toContain(
      'cannot be fired directly',
    );
  });

  it('an expired window disables the action with a visible reason', () => {
    render(
      <ReversalAction
        originalCallId="call_01J9ABC"
        reversal={{
          class: 'compensating-tool',
          tool: 'jde.ap.voucher.cancel',
          windowEndsAt: '2026-01-01T00:00:00.000Z',
        }}
        reversalPlan={REVERSAL_PLAN}
        now={() => NOW}
      />,
    );
    expect((screen.getByTestId('reversal-initiate') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('reversal-disabled-reason').textContent).toContain(
      'reversal window has closed',
    );
  });
});

describe('ReversalAction — irreversible', () => {
  it('is really `disabled` with the reason as VISIBLE TEXT, not a title tooltip', () => {
    render(
      <ReversalAction
        originalCallId="call_01J9ABC"
        reversal={{
          class: 'irreversible',
          reason: 'A posted payment cannot be recalled from the bank.',
        }}
        reversalPlan={REVERSAL_PLAN}
        now={() => NOW}
      />,
    );
    const button = screen.getByTestId('reversal-initiate') as HTMLButtonElement;
    // The DOM attribute, on a real <button> — not a class that looks disabled.
    expect(button.disabled).toBe(true);
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('title')).toBeNull();

    const reason = screen.getByTestId('reversal-disabled-reason');
    expect(reason.textContent).toBe('A posted payment cannot be recalled from the bank.');
    // Visible text: a real node, not hidden and not sr-only-with-no-visual.
    expect(reason.hasAttribute('hidden')).toBe(false);
    expect(reason.className).not.toContain('sr-only');
    // And it is programmatically tied to the disabled control.
    expect(button.getAttribute('aria-describedby')).toBe(reason.id);
  });

  it('an irreversible action cannot be opened into a plan at all', () => {
    const onConfirmReversal = vi.fn();
    render(
      <ReversalAction
        originalCallId="call_01J9ABC"
        reversal={{ class: 'irreversible', reason: 'No reversing tool exists.' }}
        reversalPlan={REVERSAL_PLAN}
        onConfirmReversal={onConfirmReversal}
        now={() => NOW}
      />,
    );
    fireEvent.click(screen.getByTestId('reversal-initiate'));
    expect(screen.queryByTestId('reversal-plan-sequence')).toBeNull();
    expect(screen.queryByTestId('confirm-action')).toBeNull();
    expect(onConfirmReversal).not.toHaveBeenCalled();
  });
});

describe('WritePathStepper — a skipped Approve is shown, never hidden', () => {
  it('derives four distinct states and never drops the approve step', () => {
    expect(deriveStepStates('execute', false)).toEqual([
      { step: 'plan', state: 'done' },
      { step: 'confirm', state: 'done' },
      { step: 'approve', state: 'skipped' },
      { step: 'execute', state: 'current' },
      { step: 'reverse', state: 'upcoming' },
    ]);
    expect(deriveStepStates('confirm', true)).toEqual([
      { step: 'plan', state: 'done' },
      { step: 'confirm', state: 'current' },
      { step: 'approve', state: 'upcoming' },
      { step: 'execute', state: 'upcoming' },
      { step: 'reverse', state: 'upcoming' },
    ]);
  });

  it('renders all five steps with distinct accessible names per state', () => {
    render(<WritePathStepper current="execute" approvalApplies={false} />);
    const approve = screen.getByTestId('write-path-step-approve');
    const plan = screen.getByTestId('write-path-step-plan');
    const execute = screen.getByTestId('write-path-step-execute');
    const reverse = screen.getByTestId('write-path-step-reverse');

    expect(approve.getAttribute('data-state')).toBe('skipped');
    expect(plan.getAttribute('data-state')).toBe('done');
    expect(execute.getAttribute('data-state')).toBe('current');
    expect(reverse.getAttribute('data-state')).toBe('upcoming');

    // Distinct in words, not only in colour.
    expect(approve.textContent).toContain('skipped — this tool does not require an approval');
    expect(plan.textContent).toContain('completed');
    expect(execute.textContent).toContain('current step');
    expect(reverse.textContent).toContain('not started');
    // Skipped is not done and not upcoming.
    expect(approve.textContent).not.toContain('completed');
    expect(approve.textContent).not.toContain('not started');

    expect(execute.getAttribute('aria-current')).toBe('step');
    expect(approve.getAttribute('aria-current')).toBeNull();
  });

  it('the approve step is present in BOTH cases, so they are distinguishable', () => {
    render(<WritePathStepper current="execute" approvalApplies />);
    expect(screen.getByTestId('write-path-step-approve').getAttribute('data-state')).toBe('done');
    cleanup();
    render(<WritePathStepper current="execute" approvalApplies={false} />);
    expect(screen.getByTestId('write-path-step-approve').getAttribute('data-state')).toBe(
      'skipped',
    );
  });
});

describe('no animation anywhere in the W0-J9 family (03 §4.7, §12)', () => {
  // Source-level, because a class that never renders in one state would still
  // be a violation in another. Test files themselves assert ON these strings,
  // so only the components are scanned.
  const FILES = [
    'execution-progress.tsx',
    'result-card.tsx',
    'result-key-chip.tsx',
    'replay-notice.tsx',
    'reversal-action.tsx',
    'write-path-stepper.tsx',
  ];

  it('no animate-/transition-/duration- class and no CSS animation appears in any of them', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      for (const pattern of [
        /\banimate-[a-z0-9[-]/g,
        /\btransition-/g,
        /\bduration-\d/g,
        /@keyframes/g,
        /\banimation\s*:/g,
      ]) {
        for (const match of src.match(pattern) ?? []) offenders.push(`${file}: ${match}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('renders no animation class on any element this family owns, in any state', () => {
    const { container } = render(
      <ReversalAction
        originalCallId="call_1"
        reversal={{ class: 'compensating-tool', tool: 'jde.ap.voucher.cancel', windowEndsAt: WINDOW_END }}
        reversalPlan={REVERSAL_PLAN}
        now={() => NOW}
      />,
    );
    fireEvent.click(screen.getByTestId('reversal-initiate'));
    // Scoped to the markup THIS task owns. The vendored shadcn primitives in
    // ../ui (Button's `transition-all`, Table row's `transition-colors`) are
    // import-only here and are hover/focus affordances, not write-path state
    // changes; the nested PlanReviewCard is W0-J7's and is excluded for the
    // same reason. What this asserts is that nothing in the W0-J9 family adds
    // an animation class of its own, in either the blocked or the opened state.
    const owned = Array.from(container.querySelectorAll('*')).filter(
      (el) =>
        !['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) &&
        el.closest('[data-testid="plan-review-card"]') === null,
    );
    expect(owned.length).toBeGreaterThan(3);
    for (const el of owned) {
      const cls = el.getAttribute('class') ?? '';
      expect(/\banimate-|\btransition-|\bduration-\d/.test(cls)).toBe(false);
    }
  });

  it('the other W0-J9 components render no animation class at all', () => {
    const rendered = [
      render(<ExecutionProgress execution={{ correlationId: 'c1', toolId: 'a.b.c.create' }} />),
      render(
        <ResultCard
          result={{
            callId: 'call_1',
            toolId: 'jde.ap.voucher.create',
            summary: 'Voucher 00123456 created.',
            resultKeys: [{ name: 'document_number', value: '00123456' }],
            replay: { originalExecutedAt: new Date(2026, 8, 8, 14, 3).toISOString() },
            identityEcho: { expected: 'p.rao@ltm.example', observed: 'FORGE_SVC' },
          }}
        />,
      ),
      render(<WritePathStepper current="execute" approvalApplies={false} />),
    ];
    for (const { container } of rendered) {
      const owned = Array.from(container.querySelectorAll('*')).filter(
        (el) => !['BUTTON', 'INPUT'].includes(el.tagName),
      );
      expect(owned.length).toBeGreaterThan(3);
      for (const el of owned) {
        const cls = el.getAttribute('class') ?? '';
        expect(/\banimate-|\btransition-|\bduration-\d/.test(cls)).toBe(false);
      }
    }
  });
});
