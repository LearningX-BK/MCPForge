// MCPForge — W0-J9: `ReplayNotice` (03 §7.5, §7.6).
//
// "**`replayed: true`** renders as its own visibly distinct state: *'This call
// was already made at 14:03. The original result is shown. Nothing was
// executed.'* An idempotent replay that looks identical to a fresh execution is
// a UX failure that produces duplicate-payable panic."
//
// SHAPE NOTES:
//
//  1. **This is not a badge.** It is a full-width, filled, headed banner that
//     sits ABOVE the summary in `ResultCard`, and `ResultCard` additionally
//     re-skins its whole border when a replay is present. The failure mode the
//     doc names is a replay that reads as a fresh execution, and a small chip in
//     a corner of an otherwise-normal result card is exactly that failure.
//  2. **The three sentences are constants,** not templates with a caller-
//     supplied verb. Only the time is interpolated. "Nothing was executed" is
//     the sentence that stops the duplicate-payable panic and no caller may
//     reword it.
//  3. No animation, in either motion setting.
import { RotateCcw } from 'lucide-react';
import { cn } from 'cn';

import { timeOfDay } from './approval-gate-card';
import type { ReplayView } from './types';

/** 03 §7.5's own words, verbatim. Never templated beyond the time. */
export const REPLAY_HEADING = 'Nothing was executed';
export function replaySentence(originalExecutedAt: string): string {
  return `This call was already made at ${timeOfDay(originalExecutedAt)}. The original result is shown. Nothing was executed.`;
}

export interface ReplayNoticeProps {
  replay: ReplayView;
  className?: string | undefined;
}

export function ReplayNotice({ replay, className }: ReplayNoticeProps) {
  return (
    <section
      data-testid="replay-notice"
      data-replayed="true"
      role="note"
      aria-labelledby="replay-notice-heading"
      className={cn(
        'flex w-full items-start gap-2 rounded-md border px-3 py-2',
        // Filled, like the irreversible banner: this is a state, not a hint.
        'border-status-write-strong bg-status-write-strong text-white',
        className,
      )}
    >
      <RotateCcw aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        <h3 id="replay-notice-heading" className="text-[0.9375rem]/[1.6] font-bold">
          {REPLAY_HEADING}
        </h3>
        <p data-testid="replay-sentence" className="text-[13.5px]/[1.55]">
          {replaySentence(replay.originalExecutedAt)}
        </p>
        {replay.originalCallId ? (
          <p className="text-[12.5px]/[1.5]">
            Original call{' '}
            {replay.originalCallHref ? (
              <a
                className="font-mono underline underline-offset-2"
                href={replay.originalCallHref}
              >
                {replay.originalCallId}
              </a>
            ) : (
              <span className="font-mono">{replay.originalCallId}</span>
            )}
          </p>
        ) : null}
      </div>
    </section>
  );
}
