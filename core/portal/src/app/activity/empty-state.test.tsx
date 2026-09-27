// @vitest-environment jsdom
//
// MCPForge — W0-J17: Activity's empty state carries the 03 §11.2 ephemerality
// note verbatim. W0-P3b: and it is shown ONLY for a successful, empty read.
// "Cannot reach the gateway" and "no calls yet" must never look alike (W0-P2
// §4(c)), so the real server page is rendered here against each read outcome.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReadResult } from '@/lib/gateway-client/read-client';

const reads: { calls: ReadResult<unknown>; verify: ReadResult<unknown> } = {
  calls: { kind: 'ok', data: { asOf: '2026-09-28T00:00:00Z', items: [], nextCursor: null } },
  verify: { kind: 'ok', data: { asOf: '2026-09-28T00:00:00Z', chains: [] } },
};

vi.mock('@/lib/gateway-client/read-client', () => ({
  readCalls: () => Promise.resolve(reads.calls),
  readAuditVerify: () => Promise.resolve(reads.verify),
}));
vi.mock('@/lib/viewer/session', () => ({
  getViewer: () => Promise.resolve(null),
}));

import ActivityPage from './page';

afterEach(() => {
  cleanup();
  reads.calls = { kind: 'ok', data: { asOf: '2026-09-28T00:00:00Z', items: [], nextCursor: null } };
  reads.verify = { kind: 'ok', data: { asOf: '2026-09-28T00:00:00Z', chains: [] } };
});

async function renderPage() {
  render(await ActivityPage());
}

describe('Activity: empty is not down', () => {
  it('carries the ephemerality note, verbatim, when the read succeeded and there is no audit data yet', async () => {
    await renderPage();
    expect(screen.getByTestId('activity-empty-state').textContent).toBe(
      'No calls recorded yet. This local instance stores audit records in SQLite; they start ' +
        'empty on a fresh checkout.',
    );
    expect(screen.queryByTestId(/^live-state-/)).toBeNull();
  });

  it('shows the gateway-down notice, naming the endpoint, and NO empty state, when the gateway is unreachable', async () => {
    reads.calls = {
      kind: 'gateway-down',
      endpoint: 'http://127.0.0.1:3939',
      next: 'Start the gateway.',
    };
    await renderPage();
    expect(screen.getByTestId('live-state-gateway-down')).toBeTruthy();
    expect(screen.getByTestId('live-state-endpoint').textContent).toBe('http://127.0.0.1:3939');
    expect(screen.getByTestId('live-state-next').textContent).toContain('Start the gateway.');
    expect(screen.queryByTestId('activity-empty-state')).toBeNull();
    expect(screen.queryAllByTestId(/^datatable-row-/)).toHaveLength(0);
  });

  it('shows a signed-out notice, distinct from both', async () => {
    reads.calls = { kind: 'signed-out', next: 'Sign in.' };
    await renderPage();
    expect(screen.getByTestId('live-state-signed-out')).toBeTruthy();
    expect(screen.queryByTestId('activity-empty-state')).toBeNull();
    expect(screen.queryByTestId('live-state-gateway-down')).toBeNull();
  });

  it('shows a gateway refusal with its code and next', async () => {
    reads.calls = {
      kind: 'refused',
      code: 'CONSUMER_UNREGISTERED',
      message: 'No consumer credential was presented.',
      next: 'Issue the portal key.',
      correlationId: 'c-1',
    };
    await renderPage();
    const notice = screen.getByTestId('live-state-refused');
    expect(notice.textContent).toContain('CONSUMER_UNREGISTERED');
    expect(screen.getByTestId('live-state-next').textContent).toContain('Issue the portal key.');
  });

  it('keeps the calls when only the integrity read failed, and says so where the panel was', async () => {
    reads.verify = { kind: 'gateway-down', endpoint: 'http://127.0.0.1:3939', next: 'Start it.' };
    await renderPage();
    expect(screen.getByTestId('activity-empty-state')).toBeTruthy();
    expect(screen.getByTestId('live-state-gateway-down').textContent).toContain('Integrity');
  });
});
