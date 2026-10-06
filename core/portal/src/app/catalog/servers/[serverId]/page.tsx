// MCPForge — W0-Q2: `/catalog/servers/[serverId]`. Definitions from git; probe
// and kill-switch state from `/api/v1` as the viewer. A failed runtime read is
// named in place and the git half still renders; nothing is faked.

import { notFound } from 'next/navigation';
import * as React from 'react';

import { readDeployment, readEnablement } from '@/lib/gateway-client/read-client';

import { loadServerDetailDefinition, toServerRuntime } from './load-detail';
import { ServerDetailView } from './server-detail-view';

export const dynamic = 'force-dynamic';

export default async function ServerDetailPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}): Promise<React.ReactElement> {
  const { serverId } = await params;
  const detail = loadServerDetailDefinition(decodeURIComponent(serverId));
  if (detail === undefined) notFound();
  const [enablement, deployment] = await Promise.all([readEnablement(), readDeployment()]);
  const failed =
    enablement.kind !== 'ok' ? enablement : deployment.kind !== 'ok' ? deployment : null;
  return (
    <ServerDetailView
      detail={detail}
      runtime={toServerRuntime(
        detail.def,
        enablement.kind === 'ok' ? enablement.data : null,
        deployment.kind === 'ok' ? deployment.data : null,
      )}
      runtimeNotice={
        failed === null
          ? undefined
          : { state: failed, subject: 'Probe status and kill-switch state' }
      }
    />
  );
}
