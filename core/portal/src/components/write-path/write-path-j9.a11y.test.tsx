// @vitest-environment jsdom
//
// W0-J9 — zero axe violations at `serious`/`critical` (03 §12.7's threshold),
// sibling to W0-J7's ./write-path.a11y.test.tsx and W0-J8's
// ./write-path-j8.a11y.test.tsx, using the same `vitest-axe` substitution.
import { cleanup, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);

import {
  ExecutionProgress,
  ReplayNotice,
  ResultCard,
  ReversalAction,
  WritePathStepper,
} from './index';
import type { ResultView, ReversalPlanView } from './types';

const RESULT: ResultView = {
  callId: 'call_01J9ABC',
  toolId: 'jde.ap.voucher.create',
  summary: 'Voucher 00123456 created for 4242, 18,400.00 GBP.',
  resultKeys: [
    { name: 'document_number', value: '00123456', searchHref: '/activity?key=document_number' },
    { name: 'document_type', value: 'PV' },
  ],
  auditHref: '/activity/call_01J9ABC',
  latency: { totalMs: 812, gatewayMs: 41, targetMs: 771 },
};

const REVERSAL_PLAN: ReversalPlanView = {
  plan: {
    plan: 'Cancel voucher 00123456. This CANCELS an OPEN PAYABLE in JD Edwards.',
    effects: [{ system: 'jde-fin', object: 'voucher', action: 'cancel', reversible: false }],
    warnings: [],
    reversal: { class: 'irreversible', reason: 'A cancelled voucher cannot be un-cancelled.' },
  },
  identity: {
    subject: 'p.rao@ltm.example',
    bindingType: 'plsql',
    carries: 'no',
    probeRef: 'probe/jde-fin/2026-08-20',
  },
  locked: { args: { document_number: '00123456' }, argsCanonicalHash: 'feedfacedeadbeef' },
  consequence: {
    reversalClass: 'irreversible',
    sensitivity: 'financial',
    envClass: 'prod',
    entityName: 'voucher',
  },
};

async function serious(container: HTMLElement) {
  const results = await axe(container);
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

describe('W0-J9 — axe (03 §12.7)', () => {
  it('ExecutionProgress is clean', async () => {
    const { container } = render(
      <ExecutionProgress
        execution={{ correlationId: 'corr_1', toolId: 'jde.ap.voucher.create' }}
      />,
    );
    expect(await serious(container)).toEqual([]);
  });

  it('ResultCard is clean, fresh / replayed / identity-mismatch', async () => {
    const variants: ResultView[] = [
      RESULT,
      { ...RESULT, replay: { originalExecutedAt: new Date(2026, 8, 8, 14, 3).toISOString() } },
      { ...RESULT, identityEcho: { expected: 'p.rao@ltm.example', observed: 'FORGE_SVC' } },
    ];
    for (const result of variants) {
      cleanup();
      const { container } = render(<ResultCard result={result} />);
      expect(await serious(container)).toEqual([]);
    }
  });

  it('the identity mismatch announces on role="alert"', () => {
    render(
      <ResultCard
        result={{ ...RESULT, identityEcho: { expected: 'p.rao@ltm.example', observed: null } }}
      />,
    );
    expect(screen.getByTestId('identity-echo-mismatch').getAttribute('role')).toBe('alert');
  });

  it('ReplayNotice is clean', async () => {
    const { container } = render(
      <ReplayNotice
        replay={{
          originalExecutedAt: new Date(2026, 8, 8, 14, 3).toISOString(),
          originalCallId: 'call_prev',
          originalCallHref: '/activity/call_prev',
        }}
      />,
    );
    expect(await serious(container)).toEqual([]);
  });

  it('ReversalAction is clean, blocked and opened', async () => {
    cleanup();
    const blocked = render(
      <ReversalAction
        originalCallId="call_1"
        reversal={{ class: 'irreversible', reason: 'A posted payment cannot be recalled.' }}
        now={() => Date.parse('2026-09-08T12:00:00.000Z')}
      />,
    );
    expect(await serious(blocked.container)).toEqual([]);

    cleanup();
    const open = render(
      <ReversalAction
        originalCallId="call_1"
        reversal={{
          class: 'compensating-tool',
          tool: 'jde.ap.voucher.cancel',
          windowEndsAt: '2026-10-01T12:00:00.000Z',
        }}
        preconditions={[{ label: 'Voucher must be unpaid', satisfied: undefined }]}
        reversalPlan={REVERSAL_PLAN}
        now={() => Date.parse('2026-09-08T12:00:00.000Z')}
      />,
    );
    expect(await serious(open.container)).toEqual([]);
  });

  it('WritePathStepper is clean in both approval cases', async () => {
    for (const applies of [true, false]) {
      cleanup();
      const { container } = render(
        <WritePathStepper current="execute" approvalApplies={applies} />,
      );
      expect(await serious(container)).toEqual([]);
    }
  });
});
