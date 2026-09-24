// MCPForge — W0-J12: the eight change states, rendered distinctly (03 §6.1).
//
// The chip family (W0-J5) already renders one state; this adds the row-level
// treatment the state table asks for and the two things a chip alone cannot
// carry:
//
//  * WHERE THE STATE LIVES ("git branch", "CI", "PR host", "git", "gw").
//    A user who does not know whether a state is something CI will change or
//    something a reviewer must change cannot act on it.
//  * `MERGED` AND `DEPLOYED` ARE NEVER CONFLATED. They render with different
//    labels, different "lives in" text, different explanations, and
//    `deployed` — and only `deployed` — renders the probe status chip beside
//    it, exactly as 03 §6.1's Chip column specifies. "A merged manifest that
//    has not been deployed... is not a working tool." `merged` additionally
//    renders the explicit caveat, because that is the misreading the section
//    exists to prevent.
//
// Motion: `validating`'s "animated dot" is static under reduced motion
// (03 §6.1) — handled with `motion-safe:` so the default in a reduced-motion
// environment is no animation at all.
import type { ChangeState } from '@mcpforge/shared';
import { cn } from 'cn';

import { ChangeStateChip, ProbeStatusChip } from '../chips';
import type { ProbeStatusChipProps } from '../chips';

/** Where the state lives — 03 §6.1's third column, verbatim in meaning. */
export const CHANGE_STATE_LOCUS: Readonly<Record<ChangeState, string>> = {
  draft: 'git branch',
  validating: 'CI',
  invalid: 'CI',
  in_review: 'review host',
  changes_requested: 'review host',
  approved: 'review host',
  merged: 'git',
  deployed: 'gateway',
  withdrawn: 'review host',
};

/**
 * One sentence per state. `merged` and `deployed` are deliberately written
 * against each other so neither can be read as the other.
 */
export const CHANGE_STATE_MEANING: Readonly<Record<ChangeState, string>> = {
  draft: 'Committed to a working branch. No change proposal has been opened.',
  validating: 'CI is running forge validate, codegen and the budget gates.',
  invalid: 'A validate rule or a budget gate failed.',
  in_review: 'A change proposal is open and waiting on a reviewer.',
  changes_requested: 'A reviewer asked for changes.',
  approved: 'Approved, and not yet merged.',
  merged: 'In the main branch. Not yet in the running catalogue — this tool is not live.',
  deployed: 'In the running catalogue artefact. Its probe status decides whether it works.',
  withdrawn: 'The change proposal was closed without merging.',
};

export interface ChangeStateDetailProps {
  state: ChangeState;
  proposedBy?: string;
  proposedAgo?: string;
  /** The failing rule name, shown for `invalid` (03 §6.1). */
  invalidRule?: string;
  /** The reviewer's name, shown for `changes_requested` (03 §6.1). */
  reviewer?: string;
  /** Only ever rendered for `deployed` — never for `merged`. */
  probeStatus?: ProbeStatusChipProps['status'];
  probeOwningTeam?: string;
  className?: string;
}

export function ChangeStateDetail({
  state,
  proposedBy,
  proposedAgo,
  invalidRule,
  reviewer,
  probeStatus,
  probeOwningTeam,
  className,
}: ChangeStateDetailProps) {
  // 03 §6.1 chip column: draft and approved are outline, merged is filled.
  const treatment = state === 'draft' || state === 'approved' ? 'outline' : 'soft';

  return (
    <div
      data-testid={`change-state-${state}`}
      data-change-state={state}
      className={cn('flex flex-col gap-1', className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ChangeStateChip
          state={state}
          treatment={state === 'merged' ? 'filled' : treatment}
          {...(proposedBy === undefined ? {} : { proposedBy })}
          {...(proposedAgo === undefined ? {} : { proposedAgo })}
        />
        {state === 'validating' ? (
          <span
            aria-hidden="true"
            data-testid="validating-dot"
            className="size-1.5 rounded-full bg-status-neutral-strong motion-safe:animate-pulse"
          />
        ) : null}
        {state === 'deployed' && probeStatus !== undefined ? (
          <ProbeStatusChip
            status={probeStatus}
            {...(probeOwningTeam === undefined ? {} : { owningTeam: probeOwningTeam })}
          />
        ) : null}
        <span className="text-[11px] tracking-[0.3px] text-text-2 uppercase">
          {CHANGE_STATE_LOCUS[state]}
        </span>
      </div>
      <p className="text-sm text-text-2">
        {CHANGE_STATE_MEANING[state]}
        {state === 'invalid' && invalidRule ? ` Rule: ${invalidRule}.` : ''}
        {state === 'changes_requested' && reviewer ? ` Reviewer: ${reviewer}.` : ''}
      </p>
    </div>
  );
}
