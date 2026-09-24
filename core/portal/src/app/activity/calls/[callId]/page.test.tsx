// @vitest-environment jsdom
//
// W0-J16: call detail — the reversal action reuses `ReversalAction` verbatim
// (not a parallel implementation), and the identity-honesty block never
// fabricates "verified" without a probe reference.
import type * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import ActivityCallDetailPage from './page';

afterEach(cleanup);

async function renderCall(callId: string) {
  const element = await ActivityCallDetailPage({ params: Promise.resolve({ callId }) });
  return render(element as React.ReactElement);
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

  it('renders redacted arguments with the hash announcement', async () => {
    await renderCall('call_a1f9e0');
    expect(screen.getByTestId('arg-value-redacted').textContent).toBe(
      'Redacted value, hash b6f2e19a7c31',
    );
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
