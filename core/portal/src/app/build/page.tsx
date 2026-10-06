// MCPForge — W0-J14: `/build` — the draft list (03 §5.3 "Build").
//
// W0-P3c: the list is the ChangeHost's open proposals on `forge/build-*`
// branches (`./drafts.ts`), read from git on every request. No fixture.
import * as React from 'react';
import Link from 'next/link';

import { ChangeStateChip } from '@/components/chips';
import { Button } from '@/components/ui/button';

import { listBuildDrafts } from './drafts';

export const dynamic = 'force-dynamic';

export default async function BuildPage(): Promise<React.ReactElement> {
  const result = await listBuildDrafts();

  return (
    <main className="px-6 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-display text-xl text-text-1">Build</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline" data-testid="new-server">
            <Link href="/build/servers/new">New module server</Link>
          </Button>
          <Button asChild data-testid="new-draft">
            <Link href="/build/new">New tool draft</Link>
          </Button>
        </div>
      </div>
      <p className="mb-4 text-[13px] text-text-2">
        Every draft here is a branch. Save draft, Propose and Discard are the only write vocabulary — there is no
        &quot;Save&quot; that writes anywhere but git. To change an existing tool, open it in the Catalog and start a
        draft from its committed manifest.
      </p>
      {result.kind === 'unavailable' ? (
        <section
          role="alert"
          data-testid="build-drafts-unavailable"
          className="rounded-lg border border-status-danger-border bg-status-danger-bg p-3 text-[13px] text-status-danger-strong"
        >
          <p className="font-semibold">The drafts could not be read from git: {result.message}</p>
          <p>
            <span className="font-semibold">Next: </span>
            {result.next}
          </p>
        </section>
      ) : result.drafts.length === 0 ? (
        <p data-testid="draft-list-empty" className="text-[13px] text-text-2">
          No open drafts. Start one with New tool draft or New module server; it becomes a branch the first time you Save draft.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="draft-list">
          {result.drafts.map((draft) => (
            <li key={draft.id}>
              <Link
                href={`/build/${encodeURIComponent(draft.id)}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-surface p-3 hover:bg-bg-surface-2"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13.5px] font-medium text-text-1">{draft.title}</span>
                  <span className="font-mono text-[11.5px] text-text-2">
                    {draft.toolId} · {draft.branch}
                  </span>
                </div>
                <ChangeStateChip state={draft.state} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
