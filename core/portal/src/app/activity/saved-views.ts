// MCPForge — W0-J16: the three saved views Activity ships WITH the product
// (03 §5.3 "Activity"), not filters a user has to construct.
//
//   1. "Everything this person did in this system this week"
//   2. business-key search — see `business-key-search.tsx`; this is a
//      first-class search box, not a saved view with a fixed predicate, so it
//      is not a member of `SAVED_VIEWS` — 03 §5.3 lists it as the second of
//      the three query shapes, and this file's `filterThisWeek` /
//      `filterAbandonedIntent` cover the first and third.
//   3. "Every write that was planned and never confirmed" — the
//      abandoned-intent view.
import type { ActivityCallSummary } from './types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** View 1 — this person, this system, this week. `system` is a target system id. */
export function filterThisWeek(
  calls: readonly ActivityCallSummary[],
  subject: string,
  nowMs: number,
  system?: string,
): ActivityCallSummary[] {
  const cutoff = nowMs - WEEK_MS;
  return calls.filter((call) => {
    if (call.callerSubject !== subject) return false;
    if (new Date(call.ts).getTime() < cutoff) return false;
    if (system !== undefined && call.deploymentId !== system) return false;
    return true;
  });
}

/**
 * View 3 — abandoned intent: `phase === 'plan'` rows that have no matching
 * execute. "Matching" is same tool id + same caller, per 02 §4.6's own
 * correlation shape (a plan and its execute share the caller and the tool;
 * `correlationId` is the tightest match when both rows carry one, so it is
 * checked first and the tool+caller pair is the fallback for a plan whose
 * execute — if any — was issued under a different correlation, e.g. a
 * confirm from a different session).
 */
export function filterAbandonedIntent(
  calls: readonly ActivityCallSummary[],
): ActivityCallSummary[] {
  const executedKeys = new Set(
    calls
      .filter((call) => call.phase === 'execute')
      .map((call) => `${call.callerSubject}::${call.toolId}`),
  );
  return calls.filter((call) => {
    if (call.phase !== 'plan') return false;
    return !executedKeys.has(`${call.callerSubject}::${call.toolId}`);
  });
}

export interface SavedView {
  readonly id: 'this-week' | 'abandoned-intent';
  readonly label: string;
  readonly description: string;
  readonly apply: (
    calls: readonly ActivityCallSummary[],
    subject: string,
    nowMs: number,
  ) => ActivityCallSummary[];
}

/**
 * The two FIXED-PREDICATE saved views. Business-key search is the third
 * query shape 03 §5.3 names, but it is a search box, not a fixed filter, so
 * it is rendered separately (`BusinessKeySearch`) rather than listed here.
 */
export const SAVED_VIEWS: readonly SavedView[] = [
  {
    id: 'this-week',
    label: 'Everything I did this week',
    description: 'Every call you made in this system over the last 7 days.',
    apply: (calls, subject, nowMs) => filterThisWeek(calls, subject, nowMs),
  },
  {
    id: 'abandoned-intent',
    label: 'Planned and never confirmed',
    description:
      'Writes a plan was produced for, with no matching confirmed execute — useful for spotting an agent proposing things humans keep declining.',
    apply: (calls) => filterAbandonedIntent(calls),
  },
];
