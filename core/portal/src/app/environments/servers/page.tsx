// MCPForge — W0-P6: `/environments/servers` — the module-server inventory.
// Definitions from git (`./load-servers.ts`); probe status and kill flags from
// `/api/v1` as the viewer. A failed read is named in place; the git half still
// renders (the W0-P3e Catalog pattern).

import * as React from 'react';

import { readDeployment, readEnablement } from '@/lib/gateway-client/read-client';

import { loadServerDefinitions, toInventory } from './load-servers';
import { ServersView } from './servers-view';

export const dynamic = 'force-dynamic';

export default async function ServersPage(): Promise<React.ReactElement> {
  const defs = loadServerDefinitions();
  const [enablement, deployment] = await Promise.all([readEnablement(), readDeployment()]);

  const failed =
    enablement.kind !== 'ok' ? enablement : deployment.kind !== 'ok' ? deployment : null;
  return (
    <ServersView
      servers={toInventory(
        defs,
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
