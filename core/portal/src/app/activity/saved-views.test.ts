// MCPForge — W0-J16: saved-view filter logic, including the abandoned-intent
// view's `phase='plan' with no matching execute` rule.
import { describe, expect, it } from 'vitest';

import { loadActivityCalls, CURRENT_USER_SUBJECT } from './fixtures';
import { filterAbandonedIntent, filterThisWeek, SAVED_VIEWS } from './saved-views';

describe('filterThisWeek', () => {
  it('includes only calls by this subject within the last 7 days', () => {
    const now = Date.now();
    const calls = loadActivityCalls(now);
    const result = filterThisWeek(calls, CURRENT_USER_SUBJECT, now);

    expect(result.every((c) => c.callerSubject === CURRENT_USER_SUBJECT)).toBe(true);
    // The 10-day-old read call by the same subject must be excluded.
    expect(result.find((c) => c.id === 'call_rd8b41')).toBeUndefined();
    // The recent write execute must be included.
    expect(result.find((c) => c.id === 'call_a1f9e0')).toBeDefined();
  });

  it('excludes calls by a different subject even within the week', () => {
    const now = Date.now();
    const calls = loadActivityCalls(now);
    const result = filterThisWeek(calls, CURRENT_USER_SUBJECT, now);
    expect(result.find((c) => c.id === 'call_pln7a02')).toBeUndefined();
    expect(result.find((c) => c.id === 'call_dn5c17')).toBeUndefined();
  });
});

describe('filterAbandonedIntent', () => {
  it('includes a plan with no matching execute by the same caller and tool', () => {
    const now = Date.now();
    const calls = loadActivityCalls(now);
    const result = filterAbandonedIntent(calls);

    expect(result.map((c) => c.id)).toContain('call_pln7a02');
  });

  it('excludes a plan whose caller+tool pair has a matching execute', () => {
    // call_a1f9e0 is an execute for jde.ap.voucher.create by
    // priya.raman@example.com. A plan with the same caller+tool must not be
    // flagged as abandoned.
    const now = Date.now();
    const calls = loadActivityCalls(now).slice();
    const shadowPlan = {
      ...calls.find((c) => c.id === 'call_a1f9e0')!,
      id: 'call_shadow_plan',
      phase: 'plan' as const,
    };
    const result = filterAbandonedIntent([...calls, shadowPlan]);
    expect(result.map((c) => c.id)).not.toContain('call_shadow_plan');
  });

  it('never includes execute, reject or reverse rows', () => {
    const result = filterAbandonedIntent(loadActivityCalls());
    expect(result.every((c) => c.phase === 'plan')).toBe(true);
  });
});

describe('SAVED_VIEWS', () => {
  it('ships exactly the two fixed-predicate views this task names', () => {
    expect(SAVED_VIEWS.map((v) => v.id)).toEqual(['this-week', 'abandoned-intent']);
  });
});
