// MCPForge — W0-J9: `ExecutionProgress` (03 §7.5, §7.6).
//
// "**Execute** shows a determinate-feeling progress state with the
// `correlationId` visible from the first moment (so a failure is traceable even
// if the browser is closed)."
//
// SECURITY / RELIABILITY SHAPE:
//
//  1. **The correlation id is rendered unconditionally, on the first paint.**
//     It is a required prop, it is not behind a disclosure, and it is not
//     conditioned on any other prop. There is no result yet and there may never
//     be one — the whole reason the id is here is the case where the tab is
//     closed or the gateway dies mid-call, and an id that only appears once a
//     result arrives is an id that is missing exactly when it is needed.
//  2. **This component never claims completion.** It renders progress and
//     nothing else; the result is `ResultCard`'s job. There is no `success`,
//     `done` or `progress: 100` prop that could make an in-flight write look
//     finished.
//  3. **No animation, in either motion setting** (03 §4.7, §12, and this
//     task's `done:` criterion). "The one animation that never runs is anything
//     on the plan/confirm sequence: state changes in the write path are instant
//     and explicit, because an animated transition between 'plan' and
//     'executed' is a lie about what happened when." So the progress state is
//     deliberately NOT a spinner and NOT an indeterminate animated bar: it is a
//     static, labelled, striped-free block of text. `determinate-feeling` is
//     satisfied by naming the phase, not by moving pixels.
import { cn } from 'cn';

import type { ExecutionView } from './types';

/** The fixed heading. Present tense, never past. */
export const EXECUTING_HEADING = 'Executing';

/** The fixed label the correlation id is announced under. */
export const CORRELATION_ID_LABEL = 'Correlation id';

export interface ExecutionProgressProps {
  execution: ExecutionView;
  className?: string | undefined;
}

export function ExecutionProgress({ execution, className }: ExecutionProgressProps) {
  return (
    <section
      data-testid="execution-progress"
      aria-label="Execution in progress"
      // `polite`, not `alert`: an in-flight write is not an error, and the
      // refusal banners own `assertive` in this family (W0-J8).
      aria-live="polite"
      aria-busy="true"
      className={cn(
        'flex w-full flex-col gap-2 rounded-lg border bg-surface-2 p-4',
        'border-status-write-border border-l-4 border-l-status-write',
        className,
      )}
    >
      <h3 className="text-[0.9375rem]/[1.6] font-bold text-text-1">
        {EXECUTING_HEADING} <span className="font-mono text-[13px]">{execution.toolId}</span>
      </h3>

      {execution.phaseLabel ? (
        <p data-testid="execution-phase" className="text-[13.5px]/[1.55] text-text-1">
          {execution.phaseLabel}
        </p>
      ) : null}

      {/* Item 1 above. Unconditional, first paint, not behind a disclosure. */}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[13.5px]/[1.55]">
        <dt className="text-text-2">{CORRELATION_ID_LABEL}</dt>
        <dd data-testid="execution-correlation-id" className="font-mono text-[11.5px]/[1.45] text-text-1">
          {execution.correlationId}
        </dd>
      </dl>

      <p className="text-[12.5px]/[1.5] text-text-2">
        Quote this correlation id if you need to trace this call. It is valid whether or not this
        page stays open.
      </p>
    </section>
  );
}
