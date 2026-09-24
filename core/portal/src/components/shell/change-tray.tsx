// MCPForge — W0-J6: the change tray (03 §6.3).
//
// "Collapsed to a single pill (`3 changes`) by default; hidden entirely at
// zero. Expanding shows the list with per-item actions, and one
// 'Propose all' that batches related edits into a single PR." Vocabulary is
// Save draft · Propose · Discard per CLAUDE.md — this component only ever
// uses "Propose"/"Discard", never "Save"/"commit"/"push".
//
// Judgment call: `items` is prop-driven (no drafts API yet) — see the
// ShellProps doc comment in app-shell.tsx for the same rationale used
// throughout this task.
import * as React from 'react';
import { ChevronUp, X } from 'lucide-react';
import { cn } from 'cn';

import { Button } from '../ui/button';
import { ChangeStateChip, type ChangeStateChipProps } from '../chips';

export interface ChangeTrayItem {
  id: string;
  label: string;
  state: ChangeStateChipProps['state'];
}

export interface ChangeTrayProps {
  items?: readonly ChangeTrayItem[];
  onProposeAll?: (() => void) | undefined;
  onProposeOne?: ((id: string) => void) | undefined;
  onDiscardOne?: ((id: string) => void) | undefined;
  className?: string;
}

export function ChangeTray({
  items = [],
  onProposeAll,
  onProposeOne,
  onDiscardOne,
  className,
}: ChangeTrayProps) {
  const [expanded, setExpanded] = React.useState(false);

  if (items.length === 0) {
    // Hidden entirely at zero (03 §6.3) — not merely collapsed.
    return null;
  }

  return (
    <div
      data-testid="change-tray"
      className={cn('fixed right-4 bottom-4 z-40 w-80 max-w-[calc(100vw-2rem)]', className)}
    >
      {expanded ? (
        <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <h2 className="text-sm font-bold text-text-1">
              {items.length} {items.length === 1 ? 'change' : 'changes'}
            </h2>
            <button
              type="button"
              aria-label="Collapse change tray"
              onClick={() => setExpanded(false)}
              className="flex size-6 items-center justify-center rounded text-text-2 hover:bg-surface-2 hover:text-text-1 focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              <ChevronUp aria-hidden="true" className="size-4 rotate-180" />
            </button>
          </div>
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto p-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-sm text-text-1">{item.label}</span>
                  <ChangeStateChip state={item.state} />
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onProposeOne?.(item.id)}
                  >
                    Propose
                  </Button>
                  <button
                    type="button"
                    aria-label={`Discard ${item.label}`}
                    onClick={() => onDiscardOne?.(item.id)}
                    className="flex size-6 items-center justify-center rounded text-text-2 hover:bg-surface-2 hover:text-status-danger focus-visible:outline-2 focus-visible:outline-focus-ring"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-line p-2">
            <Button type="button" className="w-full" onClick={() => onProposeAll?.()}>
              Propose all
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={`${items.length} uncommitted ${items.length === 1 ? 'change' : 'changes'}. Expand to review.`}
          className="ml-auto flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-text-1 shadow-md hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          {items.length} {items.length === 1 ? 'change' : 'changes'}
        </button>
      )}
    </div>
  );
}
