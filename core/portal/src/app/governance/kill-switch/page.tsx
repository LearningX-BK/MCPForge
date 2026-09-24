'use client';

// MCPForge — W0-J18: `/governance/kill-switch` (03 §5.3 "Governance" item 4).
//
// Runtime data. There is no gateway HTTP client in the portal at Wave 0 (see
// `environments/types.ts`'s header for the standing note), so the flag list
// arrives empty and says so rather than showing invented flags — an invented
// kill flag on this screen would be read as "something is switched off", which
// is the most consequential thing this page can say.
//
// Setting a flag is likewise not wired to a gateway here: `onKill` is the seam
// the integration task supplies, exactly as `onConfirm` is for the whole W0-J7
// write-path family. What IS real is the confirmation gesture — a
// deployment-wide kill is type-to-confirm through `ConfirmAction`, and no prop
// on this page can soften it.
import * as React from 'react';

import { GovNav } from '../_components/gov-nav';
import { KillSwitchPanel } from '../_components/kill-switch-panel';
import type { KillFlagRowView } from '../types';

/** Wave 0: no gateway client, so no flags are known. Never fabricated. */
const FLAGS: readonly KillFlagRowView[] = [];

export default function GovernanceKillSwitchPage(): React.ReactElement {
  return (
    <main className="flex flex-col gap-6 px-6 py-6">
      <div>
        <h1 className="mb-1 font-display text-xl text-text-1">Governance</h1>
        <p className="max-w-[80ch] text-[13px] text-text-2">
          Stop something without a redeploy — one tool, one module server, one binding type, one
          consumer, or the whole deployment.
        </p>
      </div>

      <GovNav />

      <KillSwitchPanel flags={FLAGS} deploymentId="local" envClass="local" />
    </main>
  );
}
