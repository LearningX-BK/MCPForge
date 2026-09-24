// @vitest-environment jsdom
//
// W0-J9 — 03 §7.5's execute-and-result half. Every assertion here maps to a
// clause of the task's `done:` criterion.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

import { ExecutionProgress, ReplayNotice, ResultCard, ResultKeyChip } from './index';
import type { ResultView } from './types';

const KEYS = [
  { name: 'document_number', value: '00123456', searchHref: '/activity?key=document_number&value=00123456' },
  { name: 'document_type', value: 'PV' },
  { name: 'document_company', value: '00100' },
] as const;

const RESULT: ResultView = {
  callId: 'call_01J9ABC',
  toolId: 'jde.ap.voucher.create',
  toolVersion: '1.2.0',
  summary: 'Voucher 00123456 created for 4242, 18,400.00 GBP.',
  resultKeys: KEYS,
  auditHref: '/activity/call_01J9ABC',
  latency: { totalMs: 812, gatewayMs: 41, targetMs: 771 },
  identityEcho: { expected: 'p.rao@ltm.example', observed: 'p.rao@ltm.example' },
};

describe('ExecutionProgress — the correlation id exists before any result', () => {
  it('renders the correlation id on first paint, with no result prop at all', () => {
    render(
      <ExecutionProgress
        execution={{ correlationId: 'corr_01J9ZZZ', toolId: 'jde.ap.voucher.create' }}
      />,
    );
    expect(screen.getByTestId('execution-correlation-id').textContent).toBe('corr_01J9ZZZ');
    // It is in the document, not merely in the tree behind a disclosure.
    expect(screen.getByText('corr_01J9ZZZ')).toBeTruthy();
    // And nothing on this component claims a result.
    expect(screen.queryByTestId('result-card')).toBeNull();
  });

  it('is not a spinner: no animated element anywhere in it', () => {
    const { container } = render(
      <ExecutionProgress
        execution={{ correlationId: 'corr_1', toolId: 't.a.b.create', phaseLabel: 'Calling JDE' }}
      />,
    );
    expect(container.querySelector('[class*="animate-"]')).toBeNull();
    expect(container.querySelector('[class*="transition-"]')).toBeNull();
  });
});

describe('ResultKeyChip — first-class, click-to-copy, linked', () => {
  it('renders every key as a first-class chip, not inside a details expander', () => {
    const { container } = render(<ResultCard result={RESULT} />);
    const chips = screen.getAllByTestId('result-key-chip');
    expect(chips).toHaveLength(3);
    // No disclosure element wraps them anywhere up the tree.
    expect(container.querySelector('details')).toBeNull();
    for (const chip of chips) {
      expect(chip.closest('details')).toBeNull();
      expect(chip.closest('[hidden]')).toBeNull();
      expect(chip.closest('[aria-expanded="false"]')).toBeNull();
    }
  });

  it('links the key into Activity business-key search when a href is supplied', () => {
    render(<ResultKeyChip resultKey={KEYS[0]} />);
    const link = screen.getByTestId('result-key-search-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/activity?key=document_number&value=00123456');
  });

  it('copies the VALUE (not the label) and shows visible text confirmation', () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<ResultKeyChip resultKey={KEYS[0]} />);
    const button = screen.getByTestId('result-key-copy');
    expect(button.textContent).toContain('Copy');
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith('00123456');
    expect(button.textContent).toContain('Copied');
  });

  it('does not throw when the environment has no clipboard at all', () => {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    render(<ResultKeyChip resultKey={KEYS[1]} />);
    expect(() => fireEvent.click(screen.getByTestId('result-key-copy'))).not.toThrow();
  });
});

describe('ReplayNotice — its own visibly distinct state', () => {
  it('renders 03 §7.5 sentence with the original time', () => {
    // 14:03 local — built from local parts so the assertion is TZ-independent.
    const at = new Date(2026, 8, 8, 14, 3, 0).toISOString();
    render(<ReplayNotice replay={{ originalExecutedAt: at }} />);
    expect(screen.getByTestId('replay-sentence').textContent).toBe(
      'This call was already made at 14:03. The original result is shown. Nothing was executed.',
    );
  });

  it('is a headed banner, not a subtle badge on an otherwise-normal result', () => {
    const at = new Date(2026, 8, 8, 14, 3, 0).toISOString();
    render(<ResultCard result={{ ...RESULT, replay: { originalExecutedAt: at } }} />);
    const notice = screen.getByTestId('replay-notice');
    // Its own container, with its own heading — not a chip.
    expect(notice.tagName).toBe('SECTION');
    expect(screen.getByRole('heading', { name: 'Nothing was executed' })).toBeTruthy();
    // And the whole card is marked and re-skinned, so it cannot read as fresh.
    const card = screen.getByTestId('result-card');
    expect(card.getAttribute('data-replayed')).toBe('true');
    expect(card.getAttribute('aria-label')).toBe('Replayed call result');
  });

  it('a fresh result carries no replay notice and is labelled differently', () => {
    render(<ResultCard result={RESULT} />);
    expect(screen.queryByTestId('replay-notice')).toBeNull();
    expect(screen.getByTestId('result-card').getAttribute('data-replayed')).toBe('false');
    expect(screen.getByTestId('result-card').getAttribute('aria-label')).toBe('Call result');
  });
});

describe('ResultCard — summary, latency, identity echo', () => {
  it('renders the summary, the audit link and the gateway/target latency split', () => {
    render(<ResultCard result={RESULT} />);
    expect(screen.getByTestId('result-summary').textContent).toBe(
      'Voucher 00123456 created for 4242, 18,400.00 GBP.',
    );
    expect(
      (screen.getByTestId('result-audit-link') as HTMLAnchorElement).getAttribute('href'),
    ).toBe('/activity/call_01J9ABC');
    expect(screen.getByTestId('result-latency').textContent).toContain('41 ms gateway');
    expect(screen.getByTestId('result-latency').textContent).toContain('771 ms target');
  });

  it('an identity-echo MISMATCH renders as a danger banner on role="alert"', () => {
    render(
      <ResultCard
        result={{
          ...RESULT,
          identityEcho: { expected: 'p.rao@ltm.example', observed: 'FORGE_SVC' },
        }}
      />,
    );
    const banner = screen.getByTestId('identity-echo-mismatch');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('p.rao@ltm.example');
    expect(banner.textContent).toContain('FORGE_SVC');
    expect(screen.queryByTestId('identity-echo')).toBeNull();
  });

  it('a target that reported NO identity is a mismatch, not a pass', () => {
    render(
      <ResultCard
        result={{ ...RESULT, identityEcho: { expected: 'p.rao@ltm.example', observed: null } }}
      />,
    );
    expect(screen.getByTestId('identity-echo-mismatch').textContent).toContain(
      'no identity at all',
    );
  });

  it('renders the reversal edge from both ends', () => {
    render(
      <ResultCard
        result={{
          ...RESULT,
          links: { reversedByCallId: 'call_rev_1', reversesCallId: 'call_orig_9' },
        }}
      />,
    );
    expect(screen.getByTestId('result-reversed-by-link').textContent).toBe('call_rev_1');
    expect(screen.getByTestId('result-reverses-link').textContent).toBe('call_orig_9');
  });
});
