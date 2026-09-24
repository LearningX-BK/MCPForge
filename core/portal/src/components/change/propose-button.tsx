'use client';

// MCPForge — W0-J12: `ProposeButton` (03 §6.2).
//
// "the `ProposeButton` component is the only path to a [change proposal] and
// it always shows the diff first."
//
// The sequence is fixed and cannot be skipped by a caller: click → load the
// three diffs through the `ChangeHost` interface → open `ProposeDialog` with
// them → the user proposes from inside the dialog. There is no prop that
// opens the dialog without a diff and no `onPropose` fired from the button
// itself.
//
// The button knows nothing about git. It takes a `ChangeHost` (prop, else
// context) and calls `diff()` / `propose()` — `LocalGit` writes a branch,
// commit and a review record under `approvals/`; a `HostedGit` would open a
// review on a host. Nothing here can tell, and nothing here should.
import * as React from 'react';

import { Button } from '../ui/button';
import { ProposeDialog } from './propose-dialog';
import {
  useOptionalChangeHost,
  useRepoState,
  type ChangeDiffSet,
  type ChangeHost,
  type ChangeProposal,
} from '@/lib/change-host';

export interface ProposeButtonProps {
  proposal: ChangeProposal;
  /** Overrides the context host — the only injection point tests need. */
  host?: ChangeHost | undefined;
  /** Fired after a successful propose, with the updated proposal. */
  onProposed?: ((proposal: ChangeProposal) => void) | undefined;
  className?: string;
}

export function ProposeButton({ proposal, host, onProposed, className }: ProposeButtonProps) {
  const contextHost = useOptionalChangeHost();
  const repo = useRepoState();
  const activeHost = host ?? contextHost;

  const [open, setOpen] = React.useState(false);
  const [diff, setDiff] = React.useState<ChangeDiffSet | undefined>(undefined);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; next: string } | undefined>(
    undefined,
  );

  function describe(caught: unknown, next: string) {
    const withNext = caught as { message?: unknown; next?: unknown };
    setError({
      message: typeof withNext.message === 'string' ? withNext.message : 'The change host failed.',
      next: typeof withNext.next === 'string' ? withNext.next : next,
    });
  }

  async function openWithDiff() {
    if (activeHost === undefined) {
      // CLAUDE.md non-negotiable 5: never a dead end.
      setError({
        message: 'No change host is available, so this change cannot be reviewed.',
        next: 'Open the portal against a git working tree, then Propose again.',
      });
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const loaded = await activeHost.diff(proposal.id);
      setDiff(loaded);
      setOpen(true);
    } catch (caught) {
      describe(caught, 'Check the change in the change tray, then Propose again.');
    } finally {
      setBusy(false);
    }
  }

  async function propose(description: string) {
    if (activeHost === undefined) return;
    setBusy(true);
    try {
      const updated = await activeHost.propose({
        id: proposal.id,
        author: proposal.author,
        ...(description.trim().length > 0 ? { description: description.trim() } : {}),
      });
      setOpen(false);
      onProposed?.(updated);
    } catch (caught) {
      describe(caught, 'Fix the change on its branch, then Propose again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => void openWithDiff()}
      >
        Propose
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-status-danger-strong">
          {error.message} {error.next}
        </p>
      ) : null}
      {diff ? (
        <ProposeDialog
          open={open}
          onOpenChange={setOpen}
          proposal={proposal}
          diff={diff}
          remote={repo.remote}
          onPropose={propose}
          busy={busy}
        />
      ) : null}
    </>
  );
}
