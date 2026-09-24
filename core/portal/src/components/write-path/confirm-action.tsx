// MCPForge — W0-J8: `ConfirmAction` and its three variants (03 §7.3, §7.6).
//
// "The confirm is not a second screen; it is the primary action on the Plan
// Review card ... What varies is the **friction**, which scales with
// consequence."
//
// 03 §7.3's table, implemented verbatim in `deriveConfirmVariant` below:
//
//   Reversible write, non-financial, non-prod   → simple
//   Financial sensitivity, or ANY prod env      → acknowledge  (checkbox)
//   reversal.class: irreversible                → type-to-confirm (entity name)
//   Deployment-wide actions (kill switch)       → type-to-confirm (deployment id)
//
// SECURITY SHAPE — the reason this file has no `variant` prop:
//
//  1. **Friction is derived, never supplied.** `ConfirmActionProps` takes the
//     FACTS (`ConsequenceView`: reversal class, sensitivity, environment) and
//     computes the variant. There is no `variant`, `friction`, `force`,
//     `simple` or `skipAcknowledge` prop anywhere in this module, so no caller
//     — including a future one wiring this to a live gateway — can dial the
//     friction down for a financial, production or irreversible write. That is
//     the whole point: the friction is a property of the consequence, and a
//     consequence is not a caller's opinion.
//  2. **The button is really `disabled`.** Every locked state sets the DOM
//     `disabled` attribute on a real `<button>`, not a class that looks
//     disabled and an `onClick` that returns early. A control that only looks
//     disabled is a control that a script, a keyboard or an assistive
//     technology can still fire.
//  3. **`type-to-confirm` fails closed on missing data.** If the derived
//     variant is `type-to-confirm` and no word to type was supplied, the button
//     stays disabled forever and the field says so. It does NOT fall back to a
//     lower-friction variant — a missing entity name is a bug in the caller,
//     and the safe reading of a bug is "do not let this write fire".
//
// Judgment call (documented in the task report): the typed word is matched
// **case-sensitively**, after trimming leading/trailing whitespace only. Tool
// entity segments and deployment ids are both lower-snake by convention
// (CLAUDE.md §5), so a case-sensitive match asks for nothing a user cannot
// read off the label; trimming is there because a pasted value routinely
// carries a trailing space and refusing that teaches nothing. Case folding
// would make the gesture approximate, and the gesture's only job is to be
// deliberate.
//
// No gateway client exists at Wave 0, so like the whole W0-J7 family this is
// presentational: `onConfirm` is a callback the eventual integration task
// supplies.
'use client';

import * as React from 'react';
import { cn } from 'cn';

import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import type { ConsequenceView } from './types';

/** 03 §7.6's three named variants. */
export type ConfirmVariant = 'simple' | 'acknowledge' | 'type-to-confirm';

/** 03 §7.3's checkbox label, fixed. */
export const ACKNOWLEDGE_LABEL = 'I have read the plan above';

/**
 * 03 §7.3's table as a pure function of the plan's own facts.
 *
 * Exported so the derivation is directly testable and so any other surface
 * that needs the same answer asks THIS function rather than re-deriving it —
 * a second copy of this table is a second place it can be softened.
 */
export function deriveConfirmVariant(consequence: ConsequenceView): ConfirmVariant {
  // Row 4 — deployment-wide actions. Checked first: a kill switch is
  // type-to-confirm whatever the reversal class of anything else says.
  if (consequence.deploymentId !== undefined) return 'type-to-confirm';
  // Row 3 — irreversible.
  if (consequence.reversalClass === 'irreversible') return 'type-to-confirm';
  // Row 2 — financial sensitivity, or any prod environment.
  if (consequence.sensitivity === 'financial') return 'acknowledge';
  if (consequence.envClass === 'prod') return 'acknowledge';
  // Row 1 — everything else.
  return 'simple';
}

/**
 * The word the user must type, for `type-to-confirm`. `undefined` means the
 * caller supplied neither a deployment id nor an entity name, and the button
 * stays disabled (see security note 3 above).
 */
export function requiredConfirmWord(consequence: ConsequenceView): string | undefined {
  if (consequence.deploymentId !== undefined) return consequence.deploymentId;
  return consequence.entityName;
}

/** The trim-only, case-sensitive comparison. Exported so the test asserts it. */
export function confirmWordMatches(typed: string, required: string | undefined): boolean {
  if (required === undefined || required.length === 0) return false;
  return typed.trim() === required;
}

export interface ConfirmActionProps {
  /**
   * The plan's own facts. The friction level is computed from these; there is
   * deliberately no way to pass the level itself.
   */
  consequence: ConsequenceView;
  /** Fired only when the variant's own unlock condition is satisfied. */
  onConfirm: () => void;
  /** `Change arguments` — re-opens the form and voids the plan (03 §7.2 item 9). */
  onChangeArguments?: (() => void) | undefined;
  /** `Discard plan`. */
  onDiscard?: (() => void) | undefined;
  /** The primary button's label. Defaults to 03 §7.2 item 9's wording. */
  label?: string | undefined;
  /**
   * An EXTERNAL lock — expiry, an in-flight execute, an unapproved gate. It can
   * only ever add a reason the button is disabled; it can never enable one the
   * variant has locked.
   */
  disabled?: boolean | undefined;
  /** Why it is externally locked. Rendered as visible text, never a tooltip. */
  disabledReason?: string | undefined;
  className?: string | undefined;
}

export function ConfirmAction({
  consequence,
  onConfirm,
  onChangeArguments,
  onDiscard,
  label = 'Confirm and execute',
  disabled = false,
  disabledReason,
  className,
}: ConfirmActionProps) {
  const variant = deriveConfirmVariant(consequence);
  const required = requiredConfirmWord(consequence);

  const [acknowledged, setAcknowledged] = React.useState(false);
  const [typed, setTyped] = React.useState('');

  const inputId = React.useId();
  const checkboxId = React.useId();
  const hintId = React.useId();

  // The unlock condition, per variant. `disabled` can only ever subtract.
  const unlocked =
    variant === 'simple'
      ? true
      : variant === 'acknowledge'
        ? acknowledged
        : confirmWordMatches(typed, required);

  const isDisabled = disabled || !unlocked;

  return (
    <div
      data-testid="confirm-action"
      data-variant={variant}
      className={cn('flex w-full flex-col gap-3', className)}
    >
      {variant === 'acknowledge' ? (
        <div className="flex items-center gap-2">
          <Checkbox
            id={checkboxId}
            data-testid="confirm-acknowledge"
            checked={acknowledged}
            onCheckedChange={(next) => setAcknowledged(next === true)}
            disabled={disabled}
          />
          <Label htmlFor={checkboxId} className="text-[13.5px]/[1.55] text-text-1">
            {ACKNOWLEDGE_LABEL}
          </Label>
        </div>
      ) : null}

      {variant === 'type-to-confirm' ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={inputId} className="text-[13.5px]/[1.55] text-text-1">
            {required === undefined
              ? 'Type-to-confirm is required, but no confirmation word was supplied'
              : `Type ${required} to confirm`}
          </Label>
          <Input
            id={inputId}
            data-testid="confirm-type-to-confirm"
            aria-describedby={hintId}
            autoComplete="off"
            spellCheck={false}
            value={typed}
            disabled={disabled || required === undefined}
            onChange={(event) => setTyped(event.target.value)}
            className="max-w-64 font-mono"
          />
          <p id={hintId} className="text-[12.5px]/[1.5] text-text-2">
            {required === undefined
              ? 'This confirmation cannot be completed. Re-plan the change.'
              : `This cannot be undone. Nothing else unlocks ${label}.`}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          data-testid="confirm-submit"
          disabled={isDisabled}
          onClick={onConfirm}
        >
          {label}
        </Button>
        {onChangeArguments ? (
          <Button
            type="button"
            variant="outline"
            data-testid="confirm-change-arguments"
            onClick={onChangeArguments}
          >
            Change arguments
          </Button>
        ) : null}
        {onDiscard ? (
          <Button type="button" variant="ghost" data-testid="confirm-discard" onClick={onDiscard}>
            Discard plan
          </Button>
        ) : null}
      </div>

      {/* A disabled control with no visible explanation is the failure 03 §7.5
          calls out by name; the reason is text, never a tooltip. */}
      {disabled && disabledReason ? (
        <p data-testid="confirm-disabled-reason" className="text-[12.5px]/[1.5] text-text-2">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}
