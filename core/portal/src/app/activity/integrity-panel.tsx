// MCPForge — W0-J16: the Integrity panel (03 §5.3 "Activity"; 02 §10.4 item
// 1). "the result of `forge audit verify`: chain intact, or the first break
// with its row. Small, but it must be visible somewhere, and this is here."
//
// Wording, per this task's `done:` criterion: a short chain on a LOCAL
// instance must read as EXPECTED, not alarming. `AuditChainVerification`
// already distinguishes `empty` / `intact` / `intact_from_retention_boundary`
// / `broken` (`core/gateway/store/audit/verify.ts`) — this panel's only job
// is to word each of those states so a fresh local checkout (few rows,
// `intact`, genesis origin) reads as the healthy, expected state it is, and
// reserves alarm language for `broken` alone.
import { CircleCheck, TriangleAlert, FileClock, Info } from 'lucide-react';
import { cn } from 'cn';

import type { AuditChainVerification } from './types';

export interface IntegrityPanelProps {
  verification: AuditChainVerification;
  className?: string | undefined;
}

function statusSentence(v: AuditChainVerification): string {
  switch (v.status) {
    case 'empty':
      return 'No calls recorded yet for this deployment. That is the expected state of a fresh local checkout — there is no chain to verify until the first call is written.';
    case 'intact':
      return v.rowsChecked <= 20
        ? `Chain intact — ${v.rowsChecked} row${v.rowsChecked === 1 ? '' : 's'} checked, unbroken back to genesis. A short chain like this is normal on a local instance; it simply means the store is young, not that anything is missing.`
        : `Chain intact — ${v.rowsChecked} rows checked, unbroken back to genesis.`;
    case 'intact_from_retention_boundary':
      return `Chain intact from a retention boundary — ${v.rowsChecked} rows checked, with an attestation accounting for the removed prefix. This is the expected shape after a retention sweep, not a gap.`;
    case 'broken':
      return 'Chain integrity check FAILED. The first break is detailed below.';
  }
}

export function IntegrityPanel({ verification, className }: IntegrityPanelProps) {
  const broken = verification.status === 'broken';
  const Icon = broken ? TriangleAlert : verification.status === 'empty' ? Info : CircleCheck;

  return (
    <section
      data-testid="integrity-panel"
      data-status={verification.status}
      aria-label="Audit chain integrity"
      className={cn(
        'flex w-full flex-col gap-2 rounded-lg border p-4',
        broken ? 'border-status-danger-border bg-status-danger-bg' : 'border-line bg-surface-2',
        className,
      )}
    >
      <h2 className="flex items-center gap-2 text-[13px]/[1.4] font-semibold tracking-[0.5px] uppercase text-text-2">
        <Icon aria-hidden="true" className={cn('size-4', broken && 'text-status-danger-strong')} />
        Integrity — forge audit verify
      </h2>

      <p
        data-testid="integrity-sentence"
        role={broken ? 'alert' : undefined}
        className="text-[13.5px]/[1.55] text-text-1"
      >
        {statusSentence(verification)}
      </p>

      {verification.origin ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12.5px]/[1.5]">
          <dt className="text-text-2">Origin</dt>
          <dd className="flex items-center gap-1 text-text-1" data-testid="integrity-origin">
            <FileClock aria-hidden="true" className="size-3.5" />
            {verification.origin.kind === 'genesis'
              ? 'Genesis — this is the very first row ever written for this deployment.'
              : `Retention boundary — accounted for by attestation on call ${verification.origin.attestation?.callId ?? '—'}.`}
          </dd>
          <dt className="text-text-2">First row</dt>
          <dd className="font-mono text-[11.5px]/[1.45] text-text-1">{verification.origin.firstRowId}</dd>
        </dl>
      ) : null}

      {verification.firstBreak ? (
        <dl
          data-testid="integrity-first-break"
          className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 rounded-md bg-inset px-3 py-2 text-[12.5px]/[1.5]"
        >
          <dt className="text-text-2">Row</dt>
          <dd className="font-mono text-[11.5px]/[1.45] text-text-1">{verification.firstBreak.rowId}</dd>
          <dt className="text-text-2">Reason</dt>
          <dd className="text-text-1">{verification.firstBreak.reason}</dd>
          <dt className="text-text-2">Message</dt>
          <dd className="text-text-1">{verification.firstBreak.message}</dd>
          <dt className="text-text-2">Next</dt>
          <dd data-testid="integrity-break-next" className="text-text-1">
            {verification.firstBreak.next}
          </dd>
        </dl>
      ) : null}
    </section>
  );
}
