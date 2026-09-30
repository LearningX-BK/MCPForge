// @vitest-environment jsdom
//
// W0-P33b: Approve while in review, Merge once approved, and a refusal shown
// with its `next`. The buttons decide nothing; the host (server actions) does.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ChangeHost } from '@/lib/change-host';

import { ReviewActions } from './review-actions';
import { fixtureProposal, stubHost } from './test-fixtures';

afterEach(() => cleanup());

describe('ReviewActions (W0-P33b)', () => {
  it('offers nothing on a draft', () => {
    render(<ReviewActions proposal={{ ...fixtureProposal(), state: 'draft' }} host={stubHost()} />);
    expect(screen.queryByTestId('review-actions')).toBeNull();
  });

  it('offers Approve while in review, and reports the new state', async () => {
    let state = '';
    render(
      <ReviewActions
        proposal={{ ...fixtureProposal(), state: 'in_review' }}
        host={stubHost()}
        onChanged={(p) => {
          state = p.state;
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(state).toBe('approved'));
  });

  it('offers Merge once approved, and says merged is not deployed', async () => {
    render(
      <ReviewActions proposal={{ ...fixtureProposal(), state: 'approved' }} host={stubHost()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(screen.getByTestId('review-merged')).toBeTruthy());
    expect(screen.getByTestId('review-merged').textContent).toContain('not deployed');
  });

  it('shows a refusal verbatim with its next', async () => {
    const refusing: ChangeHost = {
      ...stubHost(),
      merge: () =>
        Promise.reject(
          Object.assign(new Error('Merging a change into the definitions needs a super admin.'), {
            next: 'Ask a super admin to merge it.',
          }),
        ),
    };
    render(
      <ReviewActions proposal={{ ...fixtureProposal(), state: 'approved' }} host={refusing} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(screen.getByTestId('review-error')).toBeTruthy());
    expect(screen.getByTestId('review-error').textContent).toContain('Ask a super admin');
  });
});
