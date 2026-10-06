// @vitest-environment jsdom
//
// W0-Q5: `/requests/[requestId]` shows the lifecycle DERIVED from real linked
// artefacts, names the blocker when merged is not enabled, and never invents a
// status. Axe: no serious or critical violation.
import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deriveRequestState } from '../_lib/derive-state';
import type { TrackedRequest } from '../_lib/load-requests';
import type { RequestFile } from '../_lib/request-file';
import { RequestDetailView } from './request-detail-view';

afterEach(cleanup);

const request: RequestFile = {
  apiVersion: 'mcpforge/v1',
  kind: 'Request',
  id: 'req-20261006-search-ap-vouchers',
  requestedBy: 'alice@example.test',
  requestedAt: '2026-10-06T10:00:00.000Z',
  ask: 'search AP vouchers by amount',
  business: {
    does: 'find vouchers by amount',
    app: 'jde',
    module: 'ap',
    access: 'read',
    inputs: ['amount_from'],
    goodAnswer: 'a list',
    whoMayRun: 'AP clerks',
  },
  verdictAtSubmit: {
    tier: 'near_miss',
    indexDigest: 'sha256:abc',
    matches: [{ toolId: 'jde.ap.voucher.search', score: 11.25 }],
    decision: { kind: 'justify', text: 'filters by amount' },
  },
  governance: {
    owner: 'JDE Finance CoE',
    steward: 'bob',
    sensitivity: 'financial',
    processTag: 'P2P',
    expectedVolume: '',
    intendedToolId: 'jde.ap.voucher.search_by_amount',
    server: 'jde-fin-ap',
  },
};

function tracked(
  over: Partial<TrackedRequest> & { facts?: Parameters<typeof deriveRequestState>[1] },
): TrackedRequest {
  const facts = over.facts ?? {
    submissionOpen: false,
    draftProposalState: undefined,
    manifestMerged: false,
    approvalRecorded: false,
    inIndex: false,
    probeStatus: undefined,
  };
  return {
    request,
    derivation: deriveRequestState(request, facts),
    submissionProposalId: undefined,
    draftProposalId: undefined,
    ...over,
  };
}

describe('RequestDetailView', () => {
  it('shows what was asked, the stored verdict with its real score, and triage', () => {
    render(<RequestDetailView tracked={tracked({})} />);
    expect(screen.getByText('find vouchers by amount')).toBeTruthy();
    expect(screen.getByText(/score 11\.250/)).toBeTruthy();
    expect(screen.getByText('filters by amount')).toBeTruthy();
    expect(screen.getByTestId('owning-team').textContent).toBe('JDE Finance CoE');
    expect(screen.getByTestId('request-state').textContent).toBe('Triaged');
  });

  it('marks the reached step and ends at Enabled, not Merged', () => {
    render(<RequestDetailView tracked={tracked({})} />);
    const steps = screen.getByTestId('lifecycle').querySelectorAll('li');
    expect([...steps].map((l) => l.textContent)).toEqual([
      'Submitted',
      'Triaged',
      'Drafted',
      'In review',
      'Merged',
      'Enabled',
    ]);
    expect(steps[1]?.getAttribute('aria-current')).toBe('step');
  });

  it('merged but not enabled names the blocker and the owning team', () => {
    render(
      <RequestDetailView
        tracked={tracked({
          facts: {
            submissionOpen: false,
            draftProposalState: undefined,
            manifestMerged: true,
            approvalRecorded: true,
            inIndex: true,
            probeStatus: 'disabled_missing_binding',
          },
        })}
      />,
    );
    expect(screen.getByTestId('request-state').textContent).toBe('Merged');
    expect(screen.getByTestId('blocker').textContent).toContain('disabled_missing_binding');
    expect(screen.getByTestId('blocker').textContent).toContain('JDE Finance CoE');
  });

  it('a request still on an open proposal is Submitted, with the proposal linked', () => {
    const t = tracked({
      submissionProposalId: 'p-1',
      facts: {
        submissionOpen: true,
        draftProposalState: undefined,
        manifestMerged: false,
        approvalRecorded: false,
        inIndex: false,
        probeStatus: undefined,
      },
    });
    render(<RequestDetailView tracked={t} />);
    expect(screen.getByTestId('request-state').textContent).toBe('Submitted');
    expect(screen.getByText('p-1')).toBeTruthy();
  });

  it('a declined request shows who closed it and why, instead of the lifecycle', () => {
    const closed: RequestFile = {
      ...request,
      closed: {
        state: 'declined',
        by: 'bob',
        at: '2026-10-07',
        reason: 'duplicate of voucher.search',
      },
    };
    render(
      <RequestDetailView
        tracked={{
          request: closed,
          derivation: deriveRequestState(closed, {
            submissionOpen: false,
            draftProposalState: undefined,
            manifestMerged: false,
            approvalRecorded: false,
            inIndex: false,
            probeStatus: undefined,
          }),
          submissionProposalId: undefined,
          draftProposalId: undefined,
        }}
      />,
    );
    expect(screen.getByTestId('closed').textContent).toContain('duplicate of voucher.search');
    expect(screen.queryByTestId('lifecycle')).toBeNull();
  });

  it('has no serious or critical accessibility violation', async () => {
    const { container } = render(<RequestDetailView tracked={tracked({})} />);
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(
      result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    ).toEqual([]);
  });
});
