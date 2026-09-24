'use client';

// MCPForge — W0-J12: the Propose dialog (03 §6.2, §6.5, §11.3).
//
// "Propose — opens or updates the [change proposal]. This is the only action
// that puts work in front of another human. Never labelled 'Save,' 'Submit,'
// or 'Publish.'" and "the `ProposeButton` component is the only path to a
// [change proposal] and it always shows the diff first."
//
// So this dialog cannot be opened without a `ChangeDiffSet` — the diff is a
// required prop, not an optional panel, which makes "always shows the diff
// first" a type error to violate rather than a convention to remember.
//
// Vocabulary, fixed: the three actions are **Save draft · Propose · Discard**.
// This file contains no button labelled Save, Submit, Publish, Commit or
// Push, and `vocabulary.test.tsx` scans the whole component tree for one.
//
// 03 §11.3, verbatim, and the reason it is a constant: when no remote is
// configured the note reads *"No git remote is configured. This proposal is
// recorded locally and can be pushed later."* — "Once a remote exists, the
// note disappears and the PR link appears in its place. Nothing else
// changes." The dialog therefore branches on `RemoteInfo` (a fact about the
// repository) and never on which `ChangeHost` implementation is in use.
import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { ChangeStateDetail } from './change-state-detail';
import { ThreeDiffs } from './diff-view';
import type { ChangeDiffSet, ChangeProposal, RemoteInfo } from '@/lib/change-host';

export const NO_REMOTE_NOTE =
  'No git remote is configured. This proposal is recorded locally and can be pushed later.';

export interface ProposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposal: ChangeProposal;
  /** Required: the diff is always shown first (03 §6.2). */
  diff: ChangeDiffSet;
  remote: RemoteInfo;
  /** Called with the reviewer-facing description. */
  onPropose: (description: string) => void | Promise<void>;
  busy?: boolean;
}

export function ProposeDialog({
  open,
  onOpenChange,
  proposal,
  diff,
  remote,
  onPropose,
  busy = false,
}: ProposeDialogProps) {
  const [description, setDescription] = React.useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="propose-dialog"
        className="max-h-[85vh] gap-4 overflow-y-auto sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>Propose this change</DialogTitle>
          <DialogDescription>
            This puts {proposal.title} in front of a reviewer. Review all three diffs below before
            you propose.
          </DialogDescription>
        </DialogHeader>

        <ChangeStateDetail state={proposal.state} proposedBy={proposal.author} />

        {remote.configured ? (
          proposal.url ? (
            <p data-testid="review-link" className="text-sm text-text-2">
              Review:{' '}
              <a className="text-accent underline" href={proposal.url}>
                {proposal.url}
              </a>
            </p>
          ) : (
            <p data-testid="remote-note" className="text-sm text-text-2">
              This proposal will be pushed to {remote.name}.
            </p>
          )
        ) : (
          <p data-testid="no-remote-note" className="text-sm text-text-2">
            {NO_REMOTE_NOTE}
          </p>
        )}

        <ThreeDiffs diff={diff} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="propose-description">What changed, and why</Label>
          <Textarea
            id="propose-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="One or two sentences for the reviewer."
          />
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={() => void onPropose(description)}>
            Propose
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
