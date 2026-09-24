// @vitest-environment jsdom
//
// W0-N13: `/activity/consumers` renders usage over time, quota headroom
// meters, the detector table (state/threshold/last fire) and the
// anomaly-event list with evidence links, polls rather than streams, and
// carries a staleness marker with a manual refresh.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ActivityConsumersPage from './page';
import * as fixtures from './fixtures';
import { loadConsumerUsageOverview } from './fixtures';

afterEach(cleanup);

describe('ActivityConsumersPage', () => {
  it('renders the quota meters for both enforced limits', () => {
    render(<ActivityConsumersPage />);
    expect(screen.getByTestId('quota-meter-callsPerMinute')).not.toBeNull();
    expect(screen.getByTestId('quota-meter-writesPerDay')).not.toBeNull();
  });

  it('renders a usage-over-time row per bucket', () => {
    render(<ActivityConsumersPage />);
    const overview = loadConsumerUsageOverview('con_portal_agent');
    expect(screen.getAllByTestId('usage-panel-row').length).toBe(overview.points.length);
  });

  it('renders all seven detectors, flagging the unimplemented ones', () => {
    render(<ActivityConsumersPage />);
    const table = screen.getByTestId('detector-table');
    expect(within(table).getByTestId('detector-row-burst-write')).not.toBeNull();
    expect(within(table).getByTestId('detector-row-off-hours-elevated-binding')).not.toBeNull();
    expect(screen.getByTestId('detector-unimplemented-off-hours-elevated-binding')).not.toBeNull();
    expect(screen.queryByTestId('detector-unimplemented-burst-write')).toBeNull();
  });

  it('renders anomaly events with a link into their evidencing audit call', () => {
    render(<ActivityConsumersPage />);
    const overview = loadConsumerUsageOverview('con_portal_agent');
    const firstEvent = overview.events[0]!;
    const link = screen.getByTestId(
      `anomaly-event-evidence-${firstEvent.id}-${firstEvent.auditCallLinks[0]!.callId}`,
    );
    expect(link.getAttribute('href')).toBe(`/activity/calls/${firstEvent.auditCallLinks[0]!.callId}`);
  });

  it('re-fetches on the visible consumer switch', () => {
    render(<ActivityConsumersPage />);
    fireEvent.change(screen.getByTestId('consumer-select'), { target: { value: 'con_agent_client' } });
    const overview = loadConsumerUsageOverview('con_agent_client');
    expect(screen.getAllByTestId('usage-panel-row').length).toBe(overview.points.length);
    // The other consumer's own detector-fire evidence must not leak in.
    expect(screen.getByTestId('anomaly-event-anom_idmis_7a02')).not.toBeNull();
  });

  it('carries a staleness marker with a manual refresh control', () => {
    render(<ActivityConsumersPage />);
    expect(screen.getByTestId('consumers-staleness-marker').textContent).toMatch(/Updated/);
    expect(screen.getByTestId('consumers-refresh-button')).not.toBeNull();
  });

  describe('polling, not streaming', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('never opens a WebSocket/EventSource, and re-polls on a fixed 30s interval', () => {
      const wsSpy = vi.fn();
      const OriginalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
      (globalThis as { WebSocket?: unknown }).WebSocket = wsSpy;

      render(<ActivityConsumersPage />);
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      expect(wsSpy).not.toHaveBeenCalled();
      (globalThis as { WebSocket?: unknown }).WebSocket = OriginalWebSocket;
    });

    it('manual refresh re-fetches immediately, independent of the poll interval', () => {
      render(<ActivityConsumersPage />);
      const spy = vi.spyOn(fixtures, 'loadConsumerUsageOverview');
      const callsBefore = spy.mock.calls.length;
      fireEvent.click(screen.getByTestId('consumers-refresh-button'));
      expect(spy.mock.calls.length).toBe(callsBefore + 1);
      spy.mockRestore();
    });
  });
});
