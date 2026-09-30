// MCPForge — W0-P3e: a Catalog row's probe status, including the two states a
// probe report cannot express. `not_probed`: the gateway answered and no probe
// report names this tool, so it is not enabled. `unknown`: the portal could not
// ask. They look different on purpose: one is a fact about the tool, the other
// about the connection (W0-P2 §4(c)).
import { ProbeStatusChip, StatusChip } from '@/components/chips';
import type { StatusEntry } from '@mcpforge/shared';

import type { CatalogProbeState } from '../types';

export const NOT_PROBED: StatusEntry = {
  token: 'status-neutral',
  label: 'Not probed',
  srLabel: 'Probe status: not probed. No probe report names this tool, so it is not enabled.',
  icon: 'CircleDashed',
};

export const STATUS_UNKNOWN: StatusEntry = {
  token: 'status-neutral',
  label: 'Status unknown',
  srLabel: 'Probe status: unknown. The portal could not read it from the gateway.',
  icon: 'CircleHelp',
};

export function CatalogStatusChip({
  status,
  owningTeam,
  className,
}: {
  readonly status: CatalogProbeState;
  readonly owningTeam?: string | undefined;
  readonly className?: string | undefined;
}) {
  if (status === 'not_probed') return <StatusChip entry={NOT_PROBED} className={className} />;
  if (status === 'unknown') return <StatusChip entry={STATUS_UNKNOWN} className={className} />;
  return (
    <ProbeStatusChip
      status={status}
      {...(owningTeam === undefined ? {} : { owningTeam })}
      {...(className === undefined ? {} : { className })}
    />
  );
}
