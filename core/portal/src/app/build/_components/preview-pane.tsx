// MCPForge — W0-J14: the centre pane — the four live previews, each
// measured against its real budget (`_lib/representations.ts`).
import * as React from 'react';
import { cn } from 'cn';
import type { LivePreview } from '../_lib/representations';

function BudgetChip({ preview }: { preview: LivePreview }) {
  if (preview.budget === undefined) {
    return (
      <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-text-2">
        {preview.tokens} tokens · no declared budget
      </span>
    );
  }
  return (
    <span
      data-testid="budget-chip"
      className={cn(
        'rounded-full border px-2 py-0.5 text-[11px] font-medium',
        preview.withinBudget
          ? 'border-status-ok-border bg-status-ok-bg text-status-ok-strong'
          : 'border-status-danger-border bg-status-danger-bg text-status-danger-strong',
      )}
    >
      {preview.tokens} / {preview.budget} tokens
    </span>
  );
}

function PreviewCard({ preview }: { preview: LivePreview }) {
  return (
    <section
      data-testid={`preview-${preview.label}`}
      aria-label={preview.label}
      className="flex flex-col gap-2 rounded-lg border border-line bg-bg-surface-2 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.4px] text-text-2">{preview.label}</h3>
        <BudgetChip preview={preview} />
      </div>
      {/* axe `scrollable-region-focusable`: a scrollable region needs its own keyboard access. */}
      <pre
        tabIndex={0}
        aria-label={`${preview.label} JSON`}
        className="max-h-64 overflow-auto rounded-md bg-bg-inset p-2 font-mono text-[11.5px]/[1.5] text-text-1"
      >
        {JSON.stringify(preview.json, null, 2)}
      </pre>
    </section>
  );
}

export interface PreviewPaneProps {
  readonly card: LivePreview;
  readonly resident: LivePreview;
  readonly describe: LivePreview;
  readonly schema: LivePreview;
}

export function PreviewPane({ card, resident, describe, schema }: PreviewPaneProps): React.ReactElement {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3" aria-label="Live previews">
      <PreviewCard preview={card} />
      <PreviewCard preview={resident} />
      <PreviewCard preview={describe} />
      <PreviewCard preview={schema} />
    </div>
  );
}
