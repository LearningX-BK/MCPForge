// @vitest-environment jsdom
//
// W0-J19 / W0-Q5: Requests shows the real similarity score (not hidden), lists
// tracked requests with their derived state and owning team, ends the lifecycle
// at Enabled, and submits an ask through the change flow (never a direct write).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const submit = vi.fn();
vi.mock('@/lib/change-host/local-git-actions', () => ({
  changeHostSubmitRequest: (input: unknown) => submit(input),
}));

import { fixtureCatalogSource } from '../catalog/fixtures';
import type { RequestSummary } from './_lib/summary';
import { requestCatalogFromCatalogData } from './rank-adapter';
import { RequestsView } from './requests-view';

afterEach(cleanup);
beforeEach(() => submit.mockReset());

const catalog = requestCatalogFromCatalogData(fixtureCatalogSource());

const rows: RequestSummary[] = [
  {
    id: 'req-20261001-enabled-one',
    ask: 'an enabled thing',
    requestedBy: 'alice',
    requestedAt: '2026-10-01T00:00:00Z',
    state: 'enabled',
    stateLabel: 'Enabled',
    tier: 'new',
    owner: 'JDE Finance CoE',
  },
  {
    id: 'req-20261002-fresh',
    ask: 'a fresh ask',
    requestedBy: 'alice',
    requestedAt: '2026-10-02T00:00:00Z',
    state: 'submitted',
    stateLabel: 'Submitted',
    tier: 'near_miss',
    owner: null,
  },
];

describe('RequestsView', () => {
  it('lists tracked requests linking to their detail page, with derived state', () => {
    render(<RequestsView catalog={catalog} requests={rows} />);
    const list = screen.getByTestId('request-list');
    expect(list.textContent).toContain('Enabled');
    expect(list.textContent).toContain('Submitted');
    expect(screen.getByRole('link', { name: 'a fresh ask' }).getAttribute('href')).toBe(
      '/requests/req-20261002-fresh',
    );
  });

  it('names the owning team where triage has named one, and says so where it has not', () => {
    render(<RequestsView catalog={catalog} requests={rows} />);
    expect(screen.getByTestId('owning-team').textContent).toContain('JDE Finance CoE');
    expect(screen.getByText(/No owning team named yet/)).toBeTruthy();
  });

  it('ends the lifecycle at Enabled, not Merged', () => {
    render(<RequestsView catalog={catalog} requests={rows} />);
    const lifecycleText = screen.getByText(/Lifecycle:/).textContent ?? '';
    const states = lifecycleText.split('Lifecycle:')[1]?.split('.')[0] ?? '';
    expect(states.trim().endsWith('Enabled')).toBe(true);
  });

  it('shows a real numeric similarity score for the live verdict, not hidden', () => {
    render(<RequestsView catalog={catalog} requests={[]} />);
    fireEvent.change(screen.getByLabelText('Ask'), {
      target: { value: 'search AP vouchers for supplier' },
    });
    for (const el of screen.getAllByTestId('verdict-score')) {
      expect(el.textContent).toMatch(/score \d+\.\d{3}/);
    }
  });

  it('shows broken request files instead of dropping them', () => {
    render(
      <RequestsView
        catalog={catalog}
        requests={[]}
        problems={[{ path: 'requests/x.request.yaml', message: 'bad', next: 'Fix it.' }]}
      />,
    );
    expect(screen.getByTestId('request-problems').textContent).toContain('requests/x.request.yaml');
  });

  it('submits through the change flow with the ask, the verdict and the index digest, and no requester', async () => {
    submit.mockResolvedValue({
      ok: true,
      value: { branch: 'forge/req-20261006-schedule-robot-firmware' },
    });
    render(<RequestsView catalog={catalog} requests={[]} indexDigest="sha256:abc" />);
    fireEvent.change(screen.getByLabelText('Ask'), {
      target: { value: 'schedule robot firmware maintenance windows' },
    });
    fireEvent.change(screen.getByLabelText('What should it do?'), {
      target: { value: 'schedule it' },
    });
    fireEvent.change(screen.getByLabelText('App'), { target: { value: 'plant' } });
    fireEvent.change(screen.getByLabelText('Module'), { target: { value: 'maint' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const sent = submit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent['ask']).toBe('schedule robot firmware maintenance windows');
    expect(sent['indexDigest']).toBe('sha256:abc');
    expect((sent['verdict'] as { tier: string }).tier).toBe('new');
    expect(sent).not.toHaveProperty('requestedBy');
    const done = await screen.findByTestId('request-submitted');
    expect(done.textContent).toContain('Submitted as a change proposal');
    expect(screen.getByRole('link', { name: /req-20261006-schedule-robot-firmware/ })).toBeTruthy();
  });

  it('refuses an incomplete submission with a next, and calls nothing', async () => {
    render(<RequestsView catalog={catalog} requests={[]} />);
    fireEvent.change(screen.getByLabelText('Ask'), { target: { value: 'something odd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Say what it should do');
    expect(submit).not.toHaveBeenCalled();
  });

  it('shows the change host refusal with its next', async () => {
    submit.mockResolvedValue({
      ok: false,
      code: 'CHANGE_SIGN_IN_REQUIRED',
      message: 'Sign in to submit.',
      next: 'Sign in, then Submit again.',
    });
    render(<RequestsView catalog={catalog} requests={[]} />);
    fireEvent.change(screen.getByLabelText('Ask'), { target: { value: 'something odd' } });
    fireEvent.change(screen.getByLabelText('What should it do?'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('App'), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText('Module'), { target: { value: 'm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Sign in, then Submit again;');
  });
});
