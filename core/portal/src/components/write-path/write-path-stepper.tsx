// MCPForge — W0-J9: `WritePathStepper` (03 §7.6).
//
// "A five-step horizontal stepper (Plan · Confirm · Approve · Execute ·
// Reverse) sits at the top of the flow, with steps that do not apply (Approve,
// when not required) rendered as **skipped** rather than hidden. **Showing the
// skipped approval step is the point** — it tells the user that this tool did
// not need one, which is information, whereas hiding it makes the two cases
// indistinguishable."
//
// SHAPE NOTES:
//
//  1. **`skipped` is a fourth state, not a styling of `done`.** A skipped
//     approval did not happen; rendering it as done would assert an approval
//     that nobody gave. It is also not `upcoming`, which would suggest one is
//     still coming. Its accessible name says so in words.
//  2. **Every state carries a distinct accessible name** via visually-hidden
//     text plus `aria-current="step"` on the current one — colour never carries
//     the meaning alone (03 §12.5).
//  3. **There is no `hideApprove` prop.** `approvalApplies: false` is the only
//     way to express "no approval needed", and it renders the step. A caller
//     cannot make the two cases indistinguishable.
//  4. No animation, in either motion setting.
import { cn } from 'cn';

import { WRITE_PATH_STEPS } from './types';
import type { WritePathStep, WritePathStepState } from './types';

const STEP_LABEL: Readonly<Record<WritePathStep, string>> = {
  plan: 'Plan',
  confirm: 'Confirm',
  approve: 'Approve',
  execute: 'Execute',
  reverse: 'Reverse',
};

const STATE_SR: Readonly<Record<WritePathStepState, string>> = {
  done: 'completed',
  current: 'current step',
  upcoming: 'not started',
  skipped: 'skipped — this tool does not require an approval',
};

/**
 * The per-step state, as a pure function so it is directly testable and so no
 * second copy of this rule can exist. Exported for the same reason
 * `deriveConfirmVariant` is.
 */
export function deriveStepStates(
  current: WritePathStep,
  approvalApplies: boolean,
): ReadonlyArray<{ step: WritePathStep; state: WritePathStepState }> {
  const currentIndex = WRITE_PATH_STEPS.indexOf(current);
  return WRITE_PATH_STEPS.map((step, index) => {
    if (step === 'approve' && !approvalApplies) {
      return { step, state: 'skipped' as WritePathStepState };
    }
    if (index < currentIndex) return { step, state: 'done' as WritePathStepState };
    if (index === currentIndex) return { step, state: 'current' as WritePathStepState };
    return { step, state: 'upcoming' as WritePathStepState };
  });
}

const stateClasses: Readonly<Record<WritePathStepState, string>> = {
  done: 'border-status-ok-border bg-status-ok-bg text-status-ok-strong',
  current: 'border-status-write-border bg-status-write-bg text-status-write-strong font-bold',
  upcoming: 'border-status-neutral-border bg-surface-2 text-text-2',
  // Deliberately distinct from both: outlined, dashed, muted — a step that did
  // not happen and is not going to.
  skipped: 'border-dashed border-status-neutral-border bg-transparent text-text-2 line-through',
};

export interface WritePathStepperProps {
  current: WritePathStep;
  /** `false` renders Approve as skipped. It is never hidden. */
  approvalApplies: boolean;
  className?: string | undefined;
}

export function WritePathStepper({
  current,
  approvalApplies,
  className,
}: WritePathStepperProps) {
  const steps = deriveStepStates(current, approvalApplies);

  return (
    <nav
      data-testid="write-path-stepper"
      aria-label="Write path"
      className={cn('w-full', className)}
    >
      <ol className="flex flex-wrap items-center gap-2">
        {steps.map(({ step, state }) => (
          <li
            key={step}
            data-testid={`write-path-step-${step}`}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cn(
              'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5',
              'text-[11px] tracking-[0.4px] whitespace-nowrap',
              stateClasses[state],
            )}
          >
            <span>{STEP_LABEL[step]}</span>
            <span className="sr-only">{`, ${STATE_SR[state]}`}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
