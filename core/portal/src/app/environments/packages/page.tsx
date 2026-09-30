// MCPForge — W0-J17: `/environments/packages` (03 §5.3 item 3).
//
// W0-P3c: a server page reading git (`./load-packages.ts`), never a fixture.
// The body is `./packages-view.tsx`, fed by props.

import * as React from 'react';

import { loadPackagesFromGit } from './load-packages';
import { PackagesView } from './packages-view';

export const dynamic = 'force-dynamic';

export default function PackagesPage(): React.ReactElement {
  return <PackagesView packages={loadPackagesFromGit()} />;
}
