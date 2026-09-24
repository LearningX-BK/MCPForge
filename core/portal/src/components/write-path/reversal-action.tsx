// MCPForge — W0-J9: `ReversalAction` (03 §7.5, §7.6).
//
// "**A reversal is itself a write, so it runs the full plan → confirm
// sequence.** Same components, same rigour. It is not a shortcut, and the UI
// does not pretend it is."
//
// SECURITY SHAPE — read this before adding a prop:
//
//  1. **There is no one-click reverse.** This component exposes no `onReverse`
//     callback. The only prop that can cause a reversal to happen is
//     `onConfirmReversal`, and the only path that reaches it is the real
//     `ConfirmAction` sitting in a real `PlanReviewCard`'s action slot, rendered
//     from the caller's `reversalPlan`. So the plan → confirm composition is
//     structurally required: a caller cannot obtain a reversal without
//     supplying a plan for it, and cannot fire one without the user passing the
//     confirm friction `ConfirmAction` derives from the reversal's OWN
//     consequence (which for a `cancel` on a financial voucher in prod is at
//     least an acknowledge checkbox).
//  2. **The button label always names the reversing tool id**, per 03 §7.5:
//     "The action is labelled with the actual reversing tool: **'Reverse —
//     cancel this voucher (`jde.ap.voucher.cancel`)'**. Never a generic
//     'Undo'." The label is BUILT here from the tool id rather than taken as a
//     prop, so no caller can supply "Undo". The word "Undo" appears nowhere in
//     this family.
//  3. **`irreversible` is disabled with the reason as visible text**, never a
//     `title=` tooltip — "a disabled button with no visible explanation is one
//     of the most common accessibility and comprehension failures in enterprise
//     UI." Same pattern as `ConfirmAction`'s `disabledReason`. The DOM
//     `disabled` attribute is really set on a real `<button>`; nothing here
//     merely looks disabled.
//  4. **Every other blocked state also fails closed with a visible reason** —
//     no reversing tool, an expired window, and (the important one) no
//     `reversalPlan`. A missing plan does NOT degrade to a direct call; it
//     disables the control, because the safe reading of a caller bug is "do not
//     let this write fire".
//  5. No animation, in either motion setting.
'use client';

import * as React from 'react';
import { cn } from 'cn';

import { Button } from '../ui/button';
import { ConfirmAction } from './confirm-action';
import { PlanReviewCard } from './plan-review-card';
import { formatWindowEnd } from './reversal-contract';
import type {
  CallLinksView,
  PlanReversalView,
  ReversalPlanView,
  ReversalPreconditionView,
} from './types';

/**
 * "cancel this voucher" from `jde.ap.voucher.cancel` — the verb and the entity
 * are the last two segments of a `{app}.{module}.{entity}.{verb}` id
 * (CLAUDE.md §5). Falls back to the bare tool id when the shape is unfamiliar,
 * which is still never "Undo".
 */
export function reversingToolPhrase(toolId: string): string {
  const parts = toolId.split('.');
  if (parts.length < 2) return toolId;
  const verb = parts[parts.length - 1] as string;
  const entity = parts[parts.length - 2] as string;
  return `${verb.replace(/_/g, ' ')} this ${entity.replace(/_/g, ' ')}`;
}

/** 03 §7.5's label, built from the tool id. Never supplied by a caller. */
export function reversalActionLabel(toolId: string): string {
  return `Reverse — ${reversingToolPhrase(toolId)} (${toolId})`;
}

/** "23 days remaining — until 26 Sep 2026". Days and a date, per 03 §7.5. */
export function formatReversalCountdown(
  windowEndsAt: string | undefined,
  nowMs: number,
): string | null {
  const end = formatWindowEnd(windowEndsAt);
  if (end === null || windowEndsAt === undefined) return null;
  const endMs = new Date(windowEndsAt).getTime();
  const days = Math.floor((endMs - nowMs) / 86_400_000);
  if (days < 0) return `Window closed — ${end}`;
  if (days === 0) return `Closes today — ${end}`;
  return `${days} day${days === 1 ? '' : 's'} remaining — ${end}`;
}

export function reversalWindowExpired(
  windowEndsAt: string | undefined,
  nowMs: number,
): boolean {
  if (windowEndsAt === undefined) return false;
  const endMs = new Date(windowEndsAt).getTime();
  if (Number.isNaN(endMs)) return false;
  return endMs <= nowMs;
}

export interface ReversalActionProps {
  /** The audit call id being reversed. Becomes the reversal's `reverses_call_id`. */
  originalCallId: string;
  /** The original tool's declared reversal contract. */
  reversal: PlanReversalView;
  /**
   * The manifest's preconditions, as a live checklist where evaluatable.
   * `satisfied: undefined` renders as "not checked", never as a pass.
   */
  preconditions?: readonly ReversalPreconditionView[] | undefined;
  /**
   * The reversal's OWN plan → confirm inputs. Without it the control is
   * disabled — see security note 4. There is deliberately no path around it.
   */
  reversalPlan?: ReversalPlanView | undefined;
  /** Fired only from the reversal's own `ConfirmAction`. See security note 1. */
  onConfirmReversal?: (() => void) | undefined;
  /** Optional notification that the user opened the reversal plan. */
  onPlanReversal?: (() => void) | undefined;
  /** Both ends of the reversal edge, once it exists. */
  links?: CallLinksView | undefined;
  /** Injectable clock, for tests. */
  now?: (() => number) | undefined;
  className?: string | undefined;
}

export function ReversalAction({
  originalCallId,
  reversal,
  preconditions = [],
  reversalPlan,
  onConfirmReversal,
  onPlanReversal,
  links,
  now,
  className,
}: ReversalActionProps) {
  const [initiated, setInitiated] = React.useState(false);
  const nowMs = (now ?? Date.now)();

  const expired = reversalWindowExpired(reversal.windowEndsAt, nowMs);
  const countdown = formatReversalCountdown(reversal.windowEndsAt, nowMs);

  // The blocked reasons, in the order they are checked. Each is visible text.
  const blockedReason: string | null =
    reversal.class === 'irreversible'
      ? (reversal.reason ??
        'This call cannot be reversed. The tool declares no reversal, so there is nothing to run.')
      : reversal.tool === undefined
        ? 'This call declares no reversing tool, so a reversal cannot be constructed. Ask the module steward.'
        : expired
          ? `The reversal window has closed${countdown ? ` (${countdown})` : ''}. A correction must be made in the source system.`
          : reversalPlan === undefined
            ? 'No reversal plan is available yet. A reversal is a write and runs its own plan and confirmation; it cannot be fired directly.'
            : null;

  const label = reversal.tool ? reversalActionLabel(reversal.tool) : 'Reverse';
  const reasonId = React.useId();

  return (
    <section
      data-testid="reversal-action"
      data-blocked={blockedReason === null ? 'false' : 'true'}
      data-initiated={initiated ? 'true' : 'false'}
      aria-label="Reverse this call"
      className={cn('flex w-full flex-col gap-3', className)}
    >
      <h3 className="text-[11px]/[1.4] font-semibold tracking-[0.5px] uppercase text-text-2">
        Reverse
      </h3>

      {/* The window, in days and a date. Shown whether or not it is open. */}
      {countdown ? (
        <p data-testid="reversal-countdown" className="text-[13.5px]/[1.55] text-text-1">
          {countdown}
        </p>
      ) : null}

      {/* Preconditions, as a checklist with a real third state. */}
      {preconditions.length > 0 ? (
        <div>
          <h4 className="mb-1 text-[11px]/[1.4] font-semibold tracking-[0.5px] uppercase text-text-2">
            Preconditions
          </h4>
          <ul data-testid="reversal-preconditions" className="flex flex-col gap-1">
            {preconditions.map((pre) => (
              <li
                key={pre.label}
                data-testid="reversal-precondition"
                data-satisfied={pre.satisfied === undefined ? 'unknown' : String(pre.satisfied)}
                className="flex items-start gap-2 text-[13.5px]/[1.55] text-text-1"
              >
                {/* Glyph plus words: colour never carries the meaning alone. */}
                <span aria-hidden="true" className="font-bold">
                  {pre.satisfied === true ? '✓' : pre.satisfied === false ? '✕' : '–'}
                </span>
                <span>
                  {pre.label}
                  <span className="text-text-2">
                    {pre.satisfied === true
                      ? ' — met'
                      : pre.satisfied === false
                        ? ' — not met'
                        : ' — not checked here; the reversal plan will check it'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : reversal.preconditions ? (
        <p className="text-[13.5px]/[1.55] text-text-1">{reversal.preconditions}</p>
      ) : null}

      {/* The action itself. Either really disabled with a visible reason, or a
          button that opens the reversal's OWN plan → confirm sequence. */}
      {initiated && reversalPlan && blockedReason === null ? (
        <div data-testid="reversal-plan-sequence" className="flex flex-col gap-3">
          <p className="text-[12.5px]/[1.5] text-text-2">
            {`This reversal is itself a write. Review its plan and confirm it, exactly as you did for ${originalCallId}.`}
          </p>
          <PlanReviewCard
            plan={reversalPlan.plan}
            identity={reversalPlan.identity}
            locked={reversalPlan.locked}
            expiresAt={reversalPlan.expiresAt}
            now={now}
            actions={
              <ConfirmAction
                consequence={reversalPlan.consequence}
                onConfirm={() => onConfirmReversal?.()}
                onDiscard={() => setInitiated(false)}
                label={`Confirm and run ${reversal.tool}`}
              />
            }
          />
        </div>
      ) : (
        <>
          <Button
            type="button"
            data-testid="reversal-initiate"
            variant="outline"
            disabled={blockedReason !== null}
            aria-describedby={blockedReason !== null ? reasonId : undefined}
            onClick={() => {
              setInitiated(true);
              onPlanReversal?.();
            }}
          >
            {label}
          </Button>
          {blockedReason !== null ? (
            <p
              id={reasonId}
              data-testid="reversal-disabled-reason"
              className="text-[12.5px]/[1.5] text-text-2"
            >
              {blockedReason}
            </p>
          ) : (
            <p className="text-[12.5px]/[1.5] text-text-2">
              A reversal is a write. This opens its own plan and confirmation before anything runs.
            </p>
          )}
        </>
      )}

      {/* Both ends of the edge, once the reversal exists. */}
      {links?.reversedByCallId ? (
        <p data-testid="reversal-link-reversed-by" className="text-[12.5px]/[1.5] text-text-2">
          Reversed by{' '}
          {links.reversedByCallHref ? (
            <a className="font-mono underline underline-offset-2" href={links.reversedByCallHref}>
              {links.reversedByCallId}
            </a>
          ) : (
            <span className="font-mono">{links.reversedByCallId}</span>
          )}
        </p>
      ) : null}
      {links?.reversesCallId ? (
        <p data-testid="reversal-link-reverses" className="text-[12.5px]/[1.5] text-text-2">
          Reverses{' '}
          {links.reversesCallHref ? (
            <a className="font-mono underline underline-offset-2" href={links.reversesCallHref}>
              {links.reversesCallId}
            </a>
          ) : (
            <span className="font-mono">{links.reversesCallId}</span>
          )}
        </p>
      ) : null}
    </section>
  );
}
