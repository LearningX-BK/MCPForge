// MCPForge — W0-J13: identity carriage, three visually distinct states
// (03 §5.3 tool-detail section 5; CLAUDE.md non-negotiable #2).
//
// This wraps `write-path/identity-block.tsx` (W0-J7) rather than
// reimplementing it — IdentityBlock already refuses to assert `verified`
// without a `probeRef` (see its file header) and already renders distinct
// TEXT per state. What it does not add is COLOUR, because in its original
// context (the Plan Review card) colour comes from the surrounding card
// treatment. The tool detail page needs the three states distinguishable at
// a glance on their own, so this file adds ONE coloured `StatusChip` above
// the same `IdentityBlock`, driven by the identical `carries` value — never
// a second source of truth about carriage.
'use client';

import { StatusChip } from '@/components/chips';
import { IdentityBlock, type ProbeIdentityView } from '@/components/write-path';

export interface IdentityCarriageProps {
  identity: ProbeIdentityView;
  className?: string;
}

/**
 * `carries: 'verified'` may only ever come from a real probe reference —
 * `probeRef` is a required field on `ProbeIdentityView`, and the caller
 * (`_components/tool-detail.tsx`) builds this prop from `CatalogTool.probeIdentity`,
 * never from `binding.identity` (see `types.ts`). When no probe has ever run
 * (`probeIdentity: null` upstream), the caller still supplies `carries:
 * 'unverified'` with an EMPTY `probeRef` — `IdentityBlock` already renders
 * that as "Not established by a probe," and the badge below renders the
 * same neutral, no-probe state rather than the amber "declared" one, so the
 * two distinct absences (declared-but-unverified vs. never-probed) are not
 * conflated as identical text with identical colour.
 */
function badgeFor(identity: ProbeIdentityView) {
  const hasProbe = identity.probeRef.trim().length > 0;
  if (!hasProbe) {
    return { token: 'status-neutral' as const, label: 'No probe run', icon: 'HelpCircle' };
  }
  if (identity.carries === 'verified') {
    return { token: 'status-ok' as const, label: 'Verified', icon: 'CircleCheck' };
  }
  if (identity.carries === 'unverified') {
    return { token: 'status-write' as const, label: 'Declared — unverified', icon: 'TriangleAlert' };
  }
  return { token: 'status-neutral' as const, label: 'No native carriage', icon: 'ShieldOff' };
}

export function IdentityCarriage({ identity, className }: IdentityCarriageProps) {
  const badge = badgeFor(identity);
  return (
    <div className={className} data-testid="identity-carriage">
      <StatusChip
        entry={{ token: badge.token, label: badge.label, srLabel: `Identity carriage: ${badge.label}.`, icon: badge.icon }}
        className="mb-2"
      />
      <IdentityBlock identity={identity} />
    </div>
  );
}
