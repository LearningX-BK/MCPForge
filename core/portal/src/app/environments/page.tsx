// MCPForge — W0-J17: `/environments` — "This deployment" (03 §5.3).
// W0-P3b: live. The fingerprint is read from `/api/v1/deployment` (and the
// last probe run from `/api/v1/enablement`); the git remote from the
// ChangeHost. A failed read renders its notice in place of the panel.

import * as React from 'react';

import { LiveStateNotice } from '@/components/live/live-state-notice';
import { serverChangeHost } from '@/lib/change-host/server';
import { readDeployment, readEnablement } from '@/lib/gateway-client/read-client';

import { DeploymentFingerprintPanel } from './_components/deployment-fingerprint-panel';
import { EnvNav } from './_components/env-nav';
import { toFingerprint } from './live';

export const dynamic = 'force-dynamic';

export default async function EnvironmentsPage(): Promise<React.ReactElement> {
  const [deployment, enablement, remote] = await Promise.all([
    readDeployment(),
    readEnablement(),
    serverChangeHost.describeRemote().catch(() => ({ configured: false as const })),
  ]);

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

      {deployment.kind === 'ok' ? (
        <DeploymentFingerprintPanel
          fingerprint={toFingerprint(
            deployment.data,
            enablement.kind === 'ok' ? enablement.data : null,
            remote,
          )}
        />
      ) : (
        <LiveStateNotice state={deployment} subject="This deployment" />
      )}
    </main>
  );
}
