// MCPForge — W0-Q5: the serialisable row the list page hands the client view.
import type { TrackedRequest } from './load-requests';
import { DERIVED_LABELS, type DerivedState } from './derive-state';

export interface RequestSummary {
  readonly id: string;
  readonly ask: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly state: DerivedState;
  readonly stateLabel: string;
  readonly tier: 'exists' | 'near_miss' | 'new';
  readonly owner: string | null;
}

export function toSummary(t: TrackedRequest): RequestSummary {
  return {
    id: t.request.id,
    ask: t.request.ask,
    requestedBy: t.request.requestedBy,
    requestedAt: t.request.requestedAt,
    state: t.derivation.state,
    stateLabel: DERIVED_LABELS[t.derivation.state],
    tier: t.request.verdictAtSubmit.tier,
    owner: t.request.governance?.owner ?? null,
  };
}
