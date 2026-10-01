// @vitest-environment jsdom
//
// MCPForge — W0-P33d: the "Run probe" panel forwards and renders; it decides
// nothing. A completed run shows the counts and the gateway's next; a refusal
// (a staging deployment, say) is shown verbatim with the CLI command it names.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/environments/enablement' }));

import type { ProbeRunState } from './actions';
import { EnablementBacklogView } from './backlog-view';
import { ProbeRunPanel } from './probe-run-panel';

afterEach(cleanup);

function submit(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Run probe' }));
}

describe('ProbeRunPanel — W0-P33d', () => {
  it('shows the counts per status and the gateway next after a run the reload now serves', async () => {
    const action = vi.fn((): Promise<ProbeRunState> =>
      Promise.resolve({
        status: 'ran',
        environmentClass: 'local',
        finishedAt: '2026-10-01T10:00:00Z',
        toolCount: 11,
        byStatus: { resolved: 10, disabled_missing_binding: 1 },
        served: true,
        auditCallId: 'call-probe-1',
        next: 'The probe report is written and catalogue generation 2 serves it: 10 of 11 tools resolved.',
      }),
    );
    render(<ProbeRunPanel action={action} />);
    submit();
    await waitFor(() => expect(screen.getByTestId('probe-run-done')).toBeTruthy());
    expect(action).toHaveBeenCalledTimes(1);
    const done = screen.getByTestId('probe-run-done');
    expect(done.getAttribute('data-served')).toBe('true');
    expect(screen.getByTestId('probe-run-counts').textContent).toContain('Resolved: 10');
    expect(screen.getByTestId('probe-run-next').textContent).toContain('generation 2 serves it');
    expect(done.textContent).toContain('call-probe-1');
  });

  it('renders a refusal verbatim, with the forge probe command the gateway named', async () => {
    const action = vi.fn((): Promise<ProbeRunState> =>
      Promise.resolve({
        status: 'refused',
        code: 'PROBE_ENVIRONMENT_REFUSED',
        message: "This deployment's environment class is staging.",
        next: 'Run it from the CLI on the gateway host: forge probe --env staging --deployment local.',
        correlationId: 'corr-1',
      }),
    );
    render(<ProbeRunPanel action={action} />);
    submit();
    await waitFor(() => expect(screen.getByTestId('probe-run-refused')).toBeTruthy());
    expect(screen.getByTestId('probe-run-refused').textContent).toContain(
      'PROBE_ENVIRONMENT_REFUSED',
    );
    expect(screen.getByTestId('probe-run-refused-next').textContent).toContain(
      'forge probe --env staging',
    );
    expect(screen.queryByTestId('probe-run-done')).toBeNull();
  });

  it('is never labelled Save, and the backlog shows it only when handed one', () => {
    const { rerender } = render(<EnablementBacklogView groups={[]} toolsInScope={0} />);
    expect(screen.queryByTestId('probe-run-panel')).toBeNull();
    rerender(
      <EnablementBacklogView
        groups={[]}
        toolsInScope={0}
        probeRun={<ProbeRunPanel action={() => Promise.resolve({ status: 'idle' })} />}
      />,
    );
    expect(screen.getByTestId('probe-run-panel')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  });
});
