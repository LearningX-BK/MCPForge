// MCPForge — W0-J7: the plan sentence (03 §7.2 item 1).
//
// "The plan sentence, in `--font-body-lg`, as the first and largest thing on
// the card. This is the `plan` string from the gateway, rendered verbatim ...
// No paraphrase, no truncation, no tooltip. If the sentence is too long for
// the card, the card grows."
//
// CLAUDE.md §5 calls this "the highest-stakes copy in the product", so the
// component is deliberately incapable of shortening it: it takes one string,
// prints it as one text node, and exposes no `maxLength`, no `lines`, no
// `truncate` and no `title`. There is no prop combination that clips it.
//
// Judgment call — `--font-body-lg`: 03 §4.5 specifies it as 15px / 1.6, but the
// typography scale has not been minted as CSS custom properties yet (only the
// colour and font-family tiers exist in src/design/tokens.semantic.css, and
// this task's `touches` is scoped to components/write-path/**). Rather than
// add a token from outside my task's scope, the size is written as the exact
// rem equivalent of the documented value — 0.9375rem / 1.6 — so the eventual
// `--font-body-lg` token can replace it with no visual change. Size is not
// colour, so `no-raw-color` is not in play.
import { cn } from 'cn';

export interface PlanSentenceProps {
  /** The gateway's `plan` string. Rendered verbatim, always in full. */
  plan: string;
  /** Layout only. Any class that could clip text is stripped — see below. */
  className?: string | undefined;
}

/**
 * Classes that would truncate, clamp or scroll the sentence away. A caller
 * cannot smuggle one in through `className`: they are removed, not merged.
 * This is belt-and-braces over the "no truncation" rule, since `className` is
 * the only surface through which the ban could otherwise be circumvented.
 */
const CLIPPING = /^(truncate|text-ellipsis|overflow-hidden|line-clamp-\d+|max-h-.*|h-\d+)$/;

export function PlanSentence({ plan, className }: PlanSentenceProps) {
  const safe = (className ?? '')
    .split(/\s+/)
    .filter((c) => c.length > 0 && !CLIPPING.test(c))
    .join(' ');

  return (
    <p
      data-testid="plan-sentence"
      className={cn(
        // 03 §4.5 --font-body-lg: 15px / 1.6, 400.
        'text-[0.9375rem]/[1.6] font-normal text-text-1',
        // The card grows: wrap freely, break only where a long token forces it.
        'w-full whitespace-pre-wrap break-words hyphens-none',
        safe,
      )}
    >
      {plan}
    </p>
  );
}
