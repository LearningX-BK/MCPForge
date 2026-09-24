'use client';
// MCPForge — W0-J15: `ApprovalQueueList`, the one list (03 §5.3 "Approvals").
//
// "one list holding both runtime and definitional approvals ... differentiated
// but not separated — expiring runtime approvals pin to the top with a live
// countdown ... bulk actions are available for definitional approvals and
// structurally unavailable for runtime write approvals."
//
// SECURITY SHAPE — bulk actions are STRUCTURALLY unavailable for runtime rows,
// not merely hidden by convention:
//
//  1. `RuntimeApprovalRow` (below) takes no selection props at all — no
//     `selected`, no `onToggleSelect`. There is no `<Checkbox>` element, no
//     conditional that could render one, and no prop through which a caller
//     could wire one in. Reading this component in isolation, there is
//     nothing to remove to make batch-approval impossible — it was never
//     possible.
//  2. The selection `Set<string>` this list owns is typed and populated ONLY
//     from `entryId()` calls on `DefinitionalApprovalEntry` values (see
//     `toggleSelection` below) — a runtime entry's id is never inserted, so
//     even a bug in the row layer could not make a runtime id appear in a
//     bulk-action payload.
//  3. The bulk-action bar's two handlers (`onBulkApprove`/`onBulkDecline`)
//     are typed to take `readonly string[]` of DEFINITIONAL ids and are
//     rendered ONLY when the selection set is non-empty — there is no
//     "select all" that could sweep a runtime row into it, because runtime
//     rows contribute no selectable id to sweep.
//
// A pending runtime row's execute path — the actual mint/confirm — is not
// this component's concern at all: 03 §7.4 puts it on the approver, one
// call at a time, in `ApproverDecisionPanel` at `/approvals/[approvalId]`,
// which this list only links to.
import * as React from 'react';
import Link from 'next/link';
import { cn } from 'cn';

import { ChangeStateChip } from '@/components/chips';
import { PlanExpiryCountdown } from '@/components/write-path';
import type { ApprovalQueueEntry, DefinitionalApprovalEntry, RuntimeApprovalEntry } from './types';
import { entryId, orderApprovalQueue } from './order';
import { KindChip, RuntimeStateChip } from './runtime-state-chip';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';

function relativeAge(iso: string, now: number): string {
  const ms = Math.max(0, now - new Date(iso).getTime());
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function RuntimeApprovalRow({ entry, now }: { entry: RuntimeApprovalEntry; now: number }) {
  const { approval } = entry;
  const expiring = approval.state === 'pending';
  return (
    <li key={entryId(entry)} data-testid="approval-row" data-kind="runtime" data-approval-state={approval.state}>
      <Link
        href={entry.href}
        className={cn(
          'flex flex-col gap-1.5 rounded-lg border border-line bg-bg-surface p-3 hover:bg-bg-surface-2',
          expiring && 'border-l-4 border-l-status-write',
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <KindChip kind="runtime" />
          <RuntimeStateChip state={approval.state} />
          <span className="font-mono text-[12px] text-text-1">{approval.toolId}</span>
          <span className="text-[12px] text-text-2">{entry.application}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12.5px] text-text-2">
            Requested by {approval.requester.displayName ?? approval.requester.subject} ·{' '}
            {relativeAge(approval.raisedAt, now)}
          </span>
          {/* The live countdown — only a still-expiring (pending) row shows one. */}
          {expiring ? (
            <PlanExpiryCountdown expiresAt={approval.expiresAt} />
          ) : (
            <span className="text-[12px] text-text-2">
              {approval.state === 'expired'
                ? `Expired ${relativeAge(approval.expiresAt, now)}`
                : `Decided ${approval.decidedAt ? relativeAge(approval.decidedAt, now) : ''}`}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

interface DefinitionalRowProps {
  entry: DefinitionalApprovalEntry;
  now: number;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}

function DefinitionalApprovalRow({ entry, now, selected, onToggleSelect }: DefinitionalRowProps) {
  const id = entryId(entry);
  return (
    <li key={id} data-testid="approval-row" data-kind="definitional" data-change-state={entry.state}>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-bg-surface p-3 hover:bg-bg-surface-2">
        {/* Bulk-selection affordance — DEFINITIONAL rows only. See the file
            header: there is no equivalent branch for a runtime row. */}
        <Checkbox
          data-testid="approval-row-select"
          aria-label={`Select ${entry.title} for a bulk action`}
          checked={selected}
          onCheckedChange={() => onToggleSelect(id)}
        />
        <Link href={entry.href} className="flex flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <KindChip kind="definitional" />
            <ChangeStateChip state={entry.state} />
            <span className="text-[13px] text-text-1">{entry.title}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12.5px] text-text-2">
              {entry.author} · {entry.application}
            </span>
            <span className="text-[12px] text-text-2">{relativeAge(entry.createdAt, now)}</span>
          </div>
        </Link>
      </div>
    </li>
  );
}

export interface ApprovalQueueListProps {
  entries: readonly ApprovalQueueEntry[];
  /** Injectable clock, for tests — same discipline as `PlanExpiryCountdown`. */
  now?: number | undefined;
  onBulkApprove?: ((ids: readonly string[]) => void) | undefined;
  onBulkDecline?: ((ids: readonly string[]) => void) | undefined;
  className?: string | undefined;
}

export function ApprovalQueueList({
  entries,
  now = Date.now(),
  onBulkApprove,
  onBulkDecline,
  className,
}: ApprovalQueueListProps) {
  const ordered = React.useMemo(() => orderApprovalQueue(entries), [entries]);
  // Selection state holds ONLY definitional ids — see `toggleSelection`.
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());

  const toggleSelection = React.useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedIds = React.useMemo(() => Array.from(selected), [selected]);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {selectedIds.length > 0 ? (
        <div
          data-testid="bulk-action-bar"
          className="flex items-center gap-2 rounded-md border border-status-write-border bg-status-write-bg p-2"
        >
          <span className="text-[12.5px] text-text-1">
            {selectedIds.length} definitional {selectedIds.length === 1 ? 'proposal' : 'proposals'} selected
          </span>
          <Button
            type="button"
            size="sm"
            data-testid="bulk-approve"
            onClick={() => onBulkApprove?.(selectedIds)}
          >
            Approve selected
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            data-testid="bulk-decline"
            onClick={() => onBulkDecline?.(selectedIds)}
          >
            Decline selected
          </Button>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2" data-testid="approval-queue-list">
        {ordered.map((entry) =>
          entry.kind === 'runtime' ? (
            <RuntimeApprovalRow key={entryId(entry)} entry={entry} now={now} />
          ) : (
            <DefinitionalApprovalRow
              key={entryId(entry)}
              entry={entry}
              now={now}
              selected={selected.has(entryId(entry))}
              onToggleSelect={toggleSelection}
            />
          ),
        )}
      </ul>

      {ordered.length === 0 ? (
        <p data-testid="approval-queue-empty" className="text-[13px] text-text-2">
          Nothing is waiting for approval.
        </p>
      ) : null}
    </div>
  );
}
