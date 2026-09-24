// MCPForge — W0-P10: no Activity test may depend on today's date.
//
// `saved-views.test.ts` passes `Date.now()` into both the fixture loader and
// `filterThisWeek`. Until W0-P10 the loader discarded that argument and
// stamped every call relative to a frozen 15 Sep 2026 anchor, so the suite
// passed for a week and then failed forever. This re-runs the date-sensitive
// assertions with the system clock faked well past the anchor (and once
// before it), so a regression of that kind fails here on the day it is made,
// not a week later.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CURRENT_USER_SUBJECT, loadActivityCalls } from './fixtures';
import { filterAbandonedIntent, filterThisWeek } from './saved-views';

const ANCHOR = Date.parse('2026-09-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

describe.each([
  ['the anchor itself', 0],
  ['60 days after the anchor', 60 * DAY],
  ['two years after the anchor', 730 * DAY],
  ['30 days before the anchor', -30 * DAY],
])('Activity saved views with the clock at %s', (_label, offset) => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('filterThisWeek keeps the recent call and drops the 10-day-old one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(ANCHOR + offset);
    const now = Date.now();
    const result = filterThisWeek(loadActivityCalls(now), CURRENT_USER_SUBJECT, now);
    expect(result.find((c) => c.id === 'call_a1f9e0')).toBeDefined();
    expect(result.find((c) => c.id === 'call_rd8b41')).toBeUndefined();
    expect(result.every((c) => c.callerSubject === CURRENT_USER_SUBJECT)).toBe(true);
  });

  it('filterAbandonedIntent is unchanged by the clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(ANCHOR + offset);
    expect(filterAbandonedIntent(loadActivityCalls(Date.now())).map((c) => c.id)).toContain(
      'call_pln7a02',
    );
  });
});

describe('page renders stay deterministic', () => {
  it('the default loader (no `now`) still stamps from the fixed anchor, whatever the clock says', () => {
    vi.useFakeTimers();
    vi.setSystemTime(ANCHOR + 90 * DAY);
    try {
      const a = loadActivityCalls().map((c) => c.ts);
      vi.setSystemTime(ANCHOR + 91 * DAY);
      const b = loadActivityCalls().map((c) => c.ts);
      expect(a).toEqual(b);
      expect(a.every((ts) => Date.parse(ts) <= ANCHOR)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
