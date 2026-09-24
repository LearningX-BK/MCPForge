// @vitest-environment jsdom
//
// W0-J15 — the one-list contract (03 §5.3): ordering/pinning, the expired
// state rendering rather than disappearing, and — safety-critical — that
// bulk actions are STRUCTURALLY unavailable for runtime rows, not merely
// absent by convention.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApprovalQueueList } from './approval-queue-list';
import { loadApprovalQueue } from './fixtures';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ApprovalQueueList — one unified list', () => {
  it('renders both runtime and definitional rows in a single list, none in a separate section', () => {
    const now = Date.parse('2026-09-09T12:00:00Z');
    render(<ApprovalQueueList entries={loadApprovalQueue(now)} now={now} />);

    const list = screen.getByTestId('approval-queue-list');
    const rows = within(list).getAllByTestId('approval-row');
    // Exactly one <ul>, both kinds present inside it.
    expect(rows.map((r) => r.dataset['kind'])).toEqual(
      expect.arrayContaining(['runtime', 'definitional']),
    );
    // No second list element anywhere on the page.
    expect(screen.getAllByTestId('approval-queue-list')).toHaveLength(1);
  });

  it('pins the nearest-to-expiry pending runtime approval first, with a live countdown', () => {
    const now = Date.parse('2026-09-09T12:00:00Z');
    render(<ApprovalQueueList entries={loadApprovalQueue(now)} now={now} />);

    const list = screen.getByTestId('approval-queue-list');
    const rows = within(list).getAllByTestId('approval-row');
    expect(rows[0]?.dataset['kind']).toBe('runtime');
    expect(rows[0]?.dataset['approvalState']).toBe('pending');
    // A live countdown renders on the pinned row.
    expect(within(rows[0]!).getByTestId('plan-expiry')).toBeTruthy();
  });

  it('renders an expired runtime approval as EXPIRED rather than omitting it', () => {
    const now = Date.parse('2026-09-09T12:00:00Z');
    render(<ApprovalQueueList entries={loadApprovalQueue(now)} now={now} />);

    const expiredRow = screen
      .getAllByTestId('approval-row')
      .find((r) => r.dataset['approvalState'] === 'expired');
    expect(expiredRow).toBeDefined();
    expect(within(expiredRow!).getAllByText(/Expired/i).length).toBeGreaterThan(0);
  });
});

describe('ApprovalQueueList — bulk actions are structurally unavailable for runtime rows', () => {
  it('renders no checkbox / selection control on any runtime row', () => {
    const now = Date.parse('2026-09-09T12:00:00Z');
    render(<ApprovalQueueList entries={loadApprovalQueue(now)} now={now} />);

    const runtimeRows = screen
      .getAllByTestId('approval-row')
      .filter((r) => r.dataset['kind'] === 'runtime');
    expect(runtimeRows.length).toBeGreaterThan(0);
    for (const row of runtimeRows) {
      expect(within(row).queryByTestId('approval-row-select')).toBeNull();
      expect(within(row).queryByRole('checkbox')).toBeNull();
    }
  });

  it('renders a checkbox only on definitional rows, and the bulk bar only selects definitional ids', () => {
    const now = Date.parse('2026-09-09T12:00:00Z');
    const onBulkApprove = vi.fn();
    render(
      <ApprovalQueueList entries={loadApprovalQueue(now)} now={now} onBulkApprove={onBulkApprove} />,
    );

    const definitionalRows = screen
      .getAllByTestId('approval-row')
      .filter((r) => r.dataset['kind'] === 'definitional');
    expect(definitionalRows.length).toBeGreaterThan(0);

    // No bulk bar until something is selected.
    expect(screen.queryByTestId('bulk-action-bar')).toBeNull();

    const box = within(definitionalRows[0]!).getByTestId('approval-row-select');
    fireEvent.click(box);

    const bar = screen.getByTestId('bulk-action-bar');
    expect(bar).toBeTruthy();

    fireEvent.click(within(bar).getByTestId('bulk-approve'));
    expect(onBulkApprove).toHaveBeenCalledTimes(1);
    const ids = onBulkApprove.mock.calls[0]![0] as readonly string[];
    // Every selected id names a definitional entry — never a runtime one.
    for (const id of ids) {
      expect(id.startsWith('definitional:')).toBe(true);
    }
  });
});
