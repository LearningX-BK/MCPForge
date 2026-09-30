'use client';
// MCPForge — W0-J14: `governance.reviewPath`'s guided-form control.
// CLAUDE.md non-negotiable #7 / 03 §5.3: `plsql`/`function` structurally
// cannot select `expedited`, and the UI states WHY in an amber note — never
// a silently disabled control.
import * as React from 'react';
import type { BindingType, ReviewPath } from '@mcpforge/shared';
import { expeditedReviewGate } from '../_lib/review-path';
import { REVIEW_PATH_LABELS } from '../types';

export interface ReviewPathFieldProps {
  readonly bindingType: BindingType;
  readonly value: ReviewPath;
  readonly onChange: (value: ReviewPath) => void;
}

export function ReviewPathField({ bindingType, value, onChange }: ReviewPathFieldProps): React.ReactElement {
  const gate = expeditedReviewGate(bindingType);

  // Forcing `standard` the moment the binding type becomes elevated is the
  // "structurally cannot select" half of the requirement — the control
  // itself enforces it, the amber note only explains it.
  React.useEffect(() => {
    if (!gate.available && value === 'expedited') onChange('standard');
  }, [gate.available, value, onChange]);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="governance-review-path" className="text-[12px] font-medium text-text-1">
        Review path
      </label>
      <select
        id="governance-review-path"
        data-testid="review-path-select"
        className="w-fit rounded-md border border-line bg-bg-surface px-2 py-1 text-[13px] text-text-1 disabled:opacity-60"
        value={value}
        onChange={(e) => onChange(e.target.value as ReviewPath)}
      >
        <option value="standard">{REVIEW_PATH_LABELS.standard}</option>
        <option value="expedited" disabled={!gate.available}>
          {REVIEW_PATH_LABELS.expedited}
        </option>
      </select>
      {!gate.available ? (
        <p
          data-testid="expedited-review-amber-note"
          role="note"
          className="max-w-prose rounded-md border border-status-write-border bg-status-write-bg p-2 text-[12.5px]/[1.5] text-status-write-strong"
        >
          {gate.reason}
        </p>
      ) : null}
    </div>
  );
}
