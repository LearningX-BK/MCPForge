// MCPForge — W0-J17: `/environments` — "This deployment" (03 §5.3).
'use client';

import * as React from 'react';

import { EnvNav } from './_components/env-nav';
import { DeploymentFingerprintPanel } from './_components/deployment-fingerprint-panel';
import { loadDeploymentFingerprint } from './fixtures';

export default function EnvironmentsPage(): React.ReactElement {
  const fingerprint = React.useMemo(() => loadDeploymentFingerprint(), []);

  return (
    <main className="flex flex-col gap-6 px-6 py-6">
      <div>
        <h1 className="mb-1 font-display text-xl text-text-1">Environments</h1>
        <p className="max-w-[70ch] text-[13px] text-text-2">
          What am I actually looking at — this deployment&apos;s fingerprint, the enablement
          backlog, and the packages this base can be sliced into.
        </p>
      </div>

      <EnvNav />

      <DeploymentFingerprintPanel fingerprint={fingerprint} />
    </main>
  );
}
