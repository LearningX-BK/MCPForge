// MCPForge — the change-state chip (03 §6.1, §12.5's own worked example:
// `in review` → "Change state: in review. Proposed by Priya, 2 days ago.").
import { CHANGE_STATE, type ChangeState } from '@mcpforge/shared';

import { StatusChip, type ChipTreatment } from './status-chip';

export interface ChangeStateChipProps {
  state: ChangeState;
  /** e.g. "Priya" — folded into the accessible name when known. */
  proposedBy?: string;
  /** A pre-formatted relative time, e.g. "2 days ago" — this component does
   * no date math; the caller supplies an already-humanised string. */
  proposedAgo?: string;
  treatment?: ChipTreatment;
  className?: string;
}

export function ChangeStateChip({
  state,
  proposedBy,
  proposedAgo,
  treatment,
  className,
}: ChangeStateChipProps) {
  const entry = CHANGE_STATE[state];
  const detail = proposedBy
    ? ` Proposed by ${proposedBy}${proposedAgo ? `, ${proposedAgo}` : ''}.`
    : undefined;
  const srLabel = detail ? `${entry.srLabel}${detail}` : undefined;
  return <StatusChip entry={entry} srLabel={srLabel} treatment={treatment} className={className} />;
}
