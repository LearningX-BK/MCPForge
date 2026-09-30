// @vitest-environment jsdom
//
// W0-J16: call detail — the reversal action reuses `ReversalAction` verbatim
// (not a parallel implementation), and the identity-honesty block never
// fabricates "verified" without a probe reference.
import type * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { getActivityCall } from '../../fixtures';
import { CallDetailView } from './call-detail-view';

afterEach(cleanup);

async function renderCall(callId: string) {
  const detail = getActivityCall(callId);
  if (detail === undefined) throw new Error(`no fixture call ${callId}`);
  return render(<CallDetailView detail={detail} />);
}

describe('Activity call detail', () => {
  it('renders the reversal action via the real ReversalAction component (reuse, not a parallel control)', async () => {
    await renderCall('call_ex4402');
    // `ReversalAction`'s own data-testid — proof this is the real component,
    // not a bespoke reverse button built for this page.
    expect(screen.getByTestId('reversal-action')).not.toBeNull();
    expect(screen.getByTestId('reversal-initiate').textContent).toContain('Reverse —');
  });

  it('shows both ends of the reversal edge on an already-reversed call', async () => {
    await renderCall('call_a1f9e0');
    expect(screen.getByTestId('reversal-link-reversed-by').textContent).toContain('call_rv3391');
  });

  it('shows the reverses-link on the reversing call itself', async () => {
    await renderCall('call_rv3391');
    // A reverse-phase row has no further ReversalAction of its own to reverse.
    expect(screen.queryByTestId('reversal-action')).toBeNull();
  });

  it('renders result keys with ResultKeyChip (reuse of the write-path family)', async () => {
    await renderCall('call_a1f9e0');
    expect(screen.getAllByTestId('result-key-chip').length).toBeGreaterThan(0);
  });

  it('renders the plan as shown, verbatim, not re-derived', async () => {
    await renderCall('call_a1f9e0');
    expect(screen.getByTestId('plan-as-shown').textContent).toContain(
      'This creates an OPEN PAYABLE of 18,400.00 GBP',
    );
  });

  it('renders a write’s arguments as LockedArgs, with the redaction announcement, never a bare hash', async () => {
    await renderCall('call_a1f9e0');
    const locked = screen.getByTestId('locked-args');
    expect(locked.textContent).toContain('Redacted value, hash b6f2e19a7c31');
    expect(screen.queryByTestId('call-args')).toBeNull();
  });

  it('keeps the plain argument list, with redaction, for a read', async () => {
    await renderCall('call_rd8b41');
    expect(screen.getByTestId('call-args')).not.toBeNull();
    expect(screen.queryByTestId('locked-args')).toBeNull();
  });

  it('renders the plan through PlanSentence', async () => {
    await renderCall('call_a1f9e0');
    expect(screen.getByTestId('plan-sentence').textContent).toContain('OPEN PAYABLE');
  });

  it('renders the reversal contract with the manifest window, not an assumed one', async () => {
    await renderCall('call_ex4402');
    expect(screen.getByTestId('reversal-contract').getAttribute('data-irreversible')).toBe('false');
    expect(screen.getByTestId('reversal-window').textContent).toMatch(/^720 hours — until /);
  });

  it('states that no reversal is known, and offers no Reverse, when the row records no class', async () => {
    const detail = getActivityCall('call_ex4402')!;
    render(
      <CallDetailView detail={{ ...detail, reversalClass: undefined, reversal: undefined }} />,
    );
    expect(screen.getByTestId('reversal-unknown')).not.toBeNull();
    expect(screen.queryByTestId('reversal-action')).toBeNull();
    expect(screen.queryByTestId('reversal-contract')).toBeNull();
  });

  it('marks a replay with ReplayNotice, linking the original execution', async () => {
    const detail = getActivityCall('call_ex4402')!;
    render(
      <CallDetailView
        detail={{
          ...detail,
          replayed: true,
          replayOf: { callId: 'call_a1f9e0', ts: '2026-09-13T12:00:00.000Z' },
        }}
      />,
    );
    expect(screen.getByTestId('replay-notice').textContent).toContain('call_a1f9e0');
  });

  it('shows no ReplayNotice for a call that is not a replay', async () => {
    await renderCall('call_ex4402');
    expect(screen.queryByTestId('replay-notice')).toBeNull();
  });

  it('identity-honesty block never asserts verified without a probe reference', async () => {
    await renderCall('call_a1f9e0');
    const block = screen.getByTestId('identity-block');
    // This fixture's identityCarrying is false, sourced from a real probeRef.
    expect(block.getAttribute('data-probe-ref')).not.toBe('');
    expect(screen.getByTestId('identity-carries').textContent).not.toContain('Yes —');
  });

  it('renders the hash-chain position', async () => {
    await renderCall('call_a1f9e0');
    expect(screen.getByTestId('call-chain-position').textContent).toContain('0');
  });
});
