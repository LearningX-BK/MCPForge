// MCPForge — W0-J9: `ResultKeyChip` (03 §7.5, §7.6).
//
// "**Result keys as first-class chips** — `document_number 00123456` ·
// `document_type PV` · `document_company 00100`, each click-to-copy and each
// linked into Activity's business-key search. These are the reversal handle and
// the audit handle; they get prominence, not a details expander."
//
// SHAPE NOTES:
//
//  1. **Not a `StatusChip`.** `StatusChip` renders a closed status vocabulary
//     (`@mcpforge/shared`'s `StatusEntry`) and is a `<span>` by construction. A
//     result key is open-vocabulary data, and it must be operable — copy, and
//     navigate. So this is a chip-SHAPED control that borrows `StatusChip`'s
//     geometry classes deliberately (same radius, padding, border, size) so the
//     chip vocabulary stays visually consistent, but it is its own component
//     with real interactive semantics rather than a `<span>` with a handler.
//  2. **Copy is a real `navigator.clipboard.writeText`,** optional-chained
//     because jsdom does not implement the Clipboard API. The confirmation is a
//     TEXT CHANGE ("Copied"), never an animated toast — no animation anywhere
//     in this family, and a copy confirmation that fades is a confirmation a
//     screen reader may never get.
//  3. **The value is copied, not the label.** `document_number 00123456` copies
//     `00123456`: the thing you paste into JD Edwards.
'use client';

import * as React from 'react';
import { cn } from 'cn';

import type { ResultKeyView } from './types';

export const COPY_IDLE_LABEL = 'Copy';
export const COPY_DONE_LABEL = 'Copied';

/** How long the "Copied" text stands before reverting, ms. */
const COPY_FEEDBACK_MS = 2000;

export interface ResultKeyChipProps {
  resultKey: ResultKeyView;
  className?: string | undefined;
}

export function ResultKeyChip({ resultKey, className }: ResultKeyChipProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );

  const copy = React.useCallback(() => {
    // Optional-chained twice: jsdom has no `navigator.clipboard` at all, and a
    // non-secure browsing context has the object but not the method.
    void navigator.clipboard?.writeText?.(resultKey.value);
    setCopied(true);
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  }, [resultKey.value]);

  return (
    <span
      data-testid="result-key-chip"
      data-result-key={resultKey.name}
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5',
        'border-status-ok-border bg-status-ok-bg text-status-ok-strong',
        'text-[10.5px] font-bold tracking-[0.4px] whitespace-nowrap',
        className,
      )}
    >
      <span className="text-text-2">{resultKey.name}</span>

      {resultKey.searchHref ? (
        <a
          data-testid="result-key-search-link"
          href={resultKey.searchHref}
          className="font-mono text-[11px] underline underline-offset-2"
        >
          {resultKey.value}
          <span className="sr-only"> — find every call carrying this business key</span>
        </a>
      ) : (
        <span className="font-mono text-[11px]">{resultKey.value}</span>
      )}

      <button
        type="button"
        data-testid="result-key-copy"
        onClick={copy}
        className="cursor-pointer font-bold underline underline-offset-2"
      >
        {copied ? COPY_DONE_LABEL : COPY_IDLE_LABEL}
        <span className="sr-only">{` ${resultKey.name} ${resultKey.value}`}</span>
      </button>

      {/* The confirmation is announced as well as shown; it is text, not motion. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? `${resultKey.name} copied` : ''}
      </span>
    </span>
  );
}
