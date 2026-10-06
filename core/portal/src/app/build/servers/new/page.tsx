// MCPForge — W0-Q3: `/build/servers/new` — draft a new module server (02 §4.1).
// The committed servers are read from git for the duplicate-boundary warning.
import * as React from 'react';
import Link from 'next/link';

import { ServerDraftEditor } from '../../_components/server-draft-editor';
import { loadExistingServers } from '../../_lib/existing-servers';
import { EMPTY_SERVER_FORM } from '../../_lib/server-draft';

export const dynamic = 'force-dynamic';

export default function NewServerPage(): React.ReactElement {
  return (
    <main className="flex flex-col gap-3 px-6 py-6">
      <Link href="/build" className="text-[13px] text-text-2 underline decoration-dotted underline-offset-2">
        ← Build
      </Link>
      <h1 className="font-display text-xl text-text-1">New module server</h1>
      <ServerDraftEditor initial={EMPTY_SERVER_FORM} existing={loadExistingServers()} />
    </main>
  );
}
