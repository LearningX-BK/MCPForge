// @vitest-environment jsdom
//
// W0-J7 — the countdown's live region announces at 60s and 10s ONLY (03 §7.2
// item 8, 03 §12). "A per-second live region is unusable noise": the visible
// text ticks every second, the announcement fires twice in the life of a plan.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlanExpiryCountdown, formatRemaining } from './index';

const T0 = 1_780_000_000_000;

function advance(seconds: number) {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
}

describe('formatRemaining', () => {
  it('renders "4:12" and pads the seconds', () => {
    expect(formatRemaining(252)).toBe('4:12');
    expect(formatRemaining(65)).toBe('1:05');
    expect(formatRemaining(9)).toBe('0:09');
    expect(formatRemaining(-3)).toBe('0:00');
  });
});

describe('PlanExpiryCountdown', () => {
  let now = T0;

  beforeEach(() => {
    now = T0;
    vi.useFakeTimers();
    // The injected clock advances with the fake timers, so the component sees
    // real elapsed time rather than a frozen Date.now().
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const clock = () => now;

  function renderAt(secondsLeft: number, onExpire?: () => void) {
    const expiresAt = new Date(T0 + secondsLeft * 1000).toISOString();
    return render(
      <PlanExpiryCountdown expiresAt={expiresAt} now={clock} onExpire={onExpire} />,
    );
  }

  function tick(seconds: number) {
    for (let i = 0; i < seconds; i += 1) {
      now += 1000;
      advance(1);
    }
  }

  it('ticks the visible text every second, in words', () => {
    renderAt(252);
    expect(screen.getByTestId('plan-expiry-text').textContent).toBe('expires in 4:12');
    tick(2);
    expect(screen.getByTestId('plan-expiry-text').textContent).toBe('expires in 4:10');
  });

  it('the ticking text is hidden from assistive technology', () => {
    renderAt(252);
    expect(screen.getByTestId('plan-expiry-text').getAttribute('aria-hidden')).toBe('true');
  });

  it('announces nothing for the first fifty ticks, then once at 60s', () => {
    renderAt(120);
    const live = screen.getByTestId('plan-expiry-live');
    expect(live.textContent).toBe('');

    tick(59);
    expect(live.textContent).toBe('');

    tick(1); // 120 - 60 = 60 remaining: the crossing.
    expect(live.textContent).toBe('Plan expires in 60 seconds.');
  });

  it('announces exactly twice across a whole plan lifetime — at 60s and 10s', () => {
    renderAt(120);
    const live = screen.getByTestId('plan-expiry-live');
    const seen: string[] = [];
    let last = '';

    for (let i = 0; i < 120; i += 1) {
      tick(1);
      const text = live.textContent ?? '';
      if (text !== last) {
        seen.push(text);
        last = text;
      }
    }

    expect(seen).toEqual(['Plan expires in 60 seconds.', 'Plan expires in 10 seconds.']);
  });

  it('does not fire a stale announcement when it mounts already inside a threshold', () => {
    renderAt(30);
    const live = screen.getByTestId('plan-expiry-live');
    tick(5);
    expect(live.textContent).toBe('');
    tick(15); // crosses 10s
    expect(live.textContent).toBe('Plan expires in 10 seconds.');
  });

  it('renders "Expired" at zero and calls onExpire once', () => {
    const onExpire = vi.fn();
    renderAt(3, onExpire);
    tick(5);
    expect(screen.getByTestId('plan-expiry-text').textContent).toBe('Expired');
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
