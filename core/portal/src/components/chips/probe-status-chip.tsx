// MCPForge — the probe-status chip (03 §12.5's own worked example: `disabled`
// → "Probe status: disabled — identity unverified. Owner: JDE CNC.").
import { PROBE_STATUS, type ProbeStatus } from '@mcpforge/shared';

import { StatusChip, type ChipTreatment } from './status-chip';

export interface ProbeStatusChipProps {
  status: ProbeStatus;
  /**
   * Folded into the accessible name as "Owner: <team>." when a `disabled_*`
   * status names an owning team (02 §4.5's probe report always carries one
   * for a disabled tool) — the same worked example 03 §12.5 gives.
   */
  owningTeam?: string;
  treatment?: ChipTreatment;
  className?: string;
}

export function ProbeStatusChip({ status, owningTeam, treatment, className }: ProbeStatusChipProps) {
  const entry = PROBE_STATUS[status];
  const srLabel = owningTeam ? `${entry.srLabel} Owner: ${owningTeam}.` : undefined;
  return <StatusChip entry={entry} srLabel={srLabel} treatment={treatment} className={className} />;
}
