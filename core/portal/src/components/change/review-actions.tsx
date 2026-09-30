'use client';

// MCPForge — W0-P33b: Approve and Merge for a definitional change (docs/
// build-plan/w0-p33-portal-merge.md §2.2, §2.3).
//
// The two acts after Propose. Approve is offered while the change is
// `in_review`, Merge once it is `approved`. Neither button decides anything:
// the server actions behind `ChangeHost.approve` / `.merge` hold the gates (an
// admin approves, a super admin merges) and run `forge codegen` and
// `forge validate` before any merge. Every refusal is shown verbatim with its
// `next`. Merged is not deployed (03 §6.1), and the copy says so.
import * as React from 'react';

import { Button } from '../ui/button';
import { useOptionalChangeHost, type ChangeHost, type ChangeProposal } from '@/lib/change-host';

export interface ReviewActionsProps {
  proposal: ChangeProposal;
  /** Overrides the context host — the only injection point tests need. */
  host?: ChangeHost | undefined;
  /** Fired with the updated proposal after Approve or Merge. */
  onChanged?: ((proposal: ChangeProposal) => void) | undefined;
}

export function ReviewActions({ proposal, host, onChanged }: ReviewActionsProps) {
  const contextHost = useOptionalChangeHost();
  const activeHost = host ?? contextHost;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; next: string } | undefined>();
  const [merged, setMerged] = React.useState<{ commit: string; next: string } | undefined>();

  async function act(kind: 'approve' | 'merge') {
    if (activeHost === undefined) {
      setError({
        message: 'No change host is available, so this change cannot be reviewed.',
        next: 'Open the portal against a git working tree, then try the action again from the change.',
      });
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (kind === 'approve') {
        onChanged?.(await activeHost.approve(proposal.id));
      } else {
        const result = await activeHost.merge(proposal.id);
        setMerged({ commit: result.mergeCommit, next: result.next });
        onChanged?.(result.proposal);
      }
    } catch (caught) {
      const withNext = caught as { message?: unknown; next?: unknown };
      setError({
        message:
          typeof withNext.message === 'string' ? withNext.message : 'The change host failed.',
        next:
          typeof withNext.next === 'string'
            ? withNext.next
            : 'Open the change again to see its state.',
      });
    } finally {
      setBusy(false);
    }
  }

  if (proposal.state !== 'in_review' && proposal.state !== 'approved' && merged === undefined) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2" data-testid="review-actions">
      <div className="flex gap-2">
        {proposal.state === 'in_review' ? (
          <Button type="button" disabled={busy} onClick={() => void act('approve')}>
            Approve
          </Button>
        ) : null}
        {proposal.state === 'approved' ? (
          <Button type="button" disabled={busy} onClick={() => void act('merge')}>
            Merge
          </Button>
        ) : null}
      </div>
      {proposal.state === 'approved' && merged === undefined ? (
        <p className="max-w-[60ch] text-[12px] text-text-2">
          Merge runs <code>forge codegen</code> and <code>forge validate</code> on this change
          first, and merges only if both pass. Super admins only.
        </p>
      ) : null}
      {merged !== undefined ? (
        <p role="status" data-testid="review-merged" className="text-[12.5px] text-text-1">
          Merged as <code className="font-mono">{merged.commit.slice(0, 12)}</code>. {merged.next}
        </p>
      ) : null}
      {error !== undefined ? (
        <p role="alert" data-testid="review-error" className="text-sm text-status-danger-strong">
          {error.message} {error.next}
        </p>
      ) : null}
    </div>
  );
}
