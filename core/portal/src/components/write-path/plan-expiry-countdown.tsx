'use client';

// MCPForge — W0-J7: the expiry countdown (03 §7.2 item 8).
//
// "a live countdown to `expiresAt`, in words (`expires in 4:12`), with an
// accessible live region announcing at 60s and 10s."
//
// The visible countdown ticks every second; the live region does NOT. 03 §12's
// accessibility rules are explicit that a per-second live region is unusable
// noise, so the announcement is emitted only when the remaining time CROSSES
// 60s and again when it crosses 10s — two announcements for the life of a
// plan. The ticking text is `aria-hidden`, so a screen reader is never read
// the seconds it did not ask for.
//
// Judgment call: expiry itself is not announced here. 03 §7.2 item 8 names 60s
// and 10s and nothing else, and the expired state is a rendered outcome
// (`PLAN_EXPIRED`, 03 §7.3) owned by W0-J8's refusal work rather than a
// transient announcement. `onExpire` is exposed so that task can drive it.
import * as React from 'react';
import { Clock } from 'lucide-react';
import { cn } from 'cn';

/** The two thresholds, in seconds. 03 §7.2 item 8. Nothing else announces. */
export const ANNOUNCE_AT_SECONDS = [60, 10] as const;

export interface PlanExpiryCountdownProps {
  /** ISO-8601 instant the plan/confirm token expires (`tokenExpiresAt`). */
  expiresAt: string;
  /** Injectable clock, for tests. Defaults to `Date.now`. */
  now?: (() => number) | undefined;
  /** Fired once, when the countdown reaches zero. */
  onExpire?: (() => void) | undefined;
  className?: string | undefined;
}

/** `252` → `4:12`. Seconds are always two digits. */
export function formatRemaining(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function announcementFor(seconds: number): string {
  return `Plan expires in ${seconds} seconds.`;
}

export function PlanExpiryCountdown({
  expiresAt,
  now,
  onExpire,
  className,
}: PlanExpiryCountdownProps) {
  const clock = now ?? Date.now;
  const clockRef = React.useRef(clock);
  clockRef.current = clock;

  const target = React.useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);

  const compute = React.useCallback(
    () => Math.max(0, Math.ceil((target - clockRef.current()) / 1000)),
    [target],
  );

  const [remaining, setRemaining] = React.useState(compute);
  const [announcement, setAnnouncement] = React.useState('');

  // The last value we compared against, so a threshold fires on the CROSSING
  // and exactly once. Seeded with the mount value: a plan already inside a
  // threshold when the card renders does not fire a stale announcement.
  const previous = React.useRef(remaining);
  const expired = React.useRef(remaining === 0);

  React.useEffect(() => {
    const tick = () => {
      const next = compute();
      setRemaining(next);

      for (const threshold of ANNOUNCE_AT_SECONDS) {
        if (previous.current > threshold && next <= threshold) {
          setAnnouncement(announcementFor(threshold));
        }
      }
      previous.current = next;

      if (next === 0 && !expired.current) {
        expired.current = true;
        onExpire?.();
      }
    };

    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [compute, onExpire]);

  const isExpired = remaining === 0;

  return (
    <div
      data-testid="plan-expiry"
      data-remaining={String(remaining)}
      // `remaining` is seeded from `Date.now()` (or the injected clock) at
      // RENDER time, so the server's value and the client's hydration-time
      // value are legitimately different the instant they were each
      // computed — a real clock, not a bug to reconcile. Left unsuppressed,
      // React 19 treats `data-remaining` (and the text below) as a hydration
      // mismatch and discards+regenerates this whole subtree on the client;
      // that regeneration was observed to race and swallow an in-flight
      // client-side navigation triggered around the same tick (the App
      // Router "Enter fires the RSC fetch, the URL never updates" defect —
      // see approve.spec.ts and the catalog "Back to Catalog" repro).
      // `suppressHydrationWarning` here is the documented React fix for a
      // "current time" node (see React's hydration-mismatch docs) — it
      // silences the mismatch at exactly this node instead of at the tree,
      // which is what stops the discard-and-remount.
      suppressHydrationWarning
      className={cn(
        'flex items-center gap-1.5 text-[12.5px]/[1.5] text-text-2',
        isExpired && 'text-status-danger-strong',
        className,
      )}
    >
      <Clock aria-hidden="true" className="size-3.5 shrink-0" />
      {/* Ticks once a second — hidden from assistive tech on purpose. */}
      <span
        aria-hidden="true"
        data-testid="plan-expiry-text"
        className="tabular-nums"
        suppressHydrationWarning
      >
        {isExpired ? 'Expired' : `expires in ${formatRemaining(remaining)}`}
      </span>
      {/* Announces only at 60s and 10s. Never per second. */}
      <span
        data-testid="plan-expiry-live"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </span>
    </div>
  );
}
