// MCPForge — W0-J14: `/build/[draftId]` — the three-pane manifest editor.
//
// W0-P3c: a draft is read from its branch through the ChangeHost
// (`../drafts.ts`). `/build/new` opens the starter template, or, with
// `?from=<toolId>`, that tool's committed manifest from `manifests/**`.
import * as React from 'react';
import { notFound } from 'next/navigation';

import { DraftEditor } from '../_components/draft-editor';
import { ServerDraftEditor } from '../_components/server-draft-editor';
import { loadExistingServers } from '../_lib/existing-servers';
import { formFromYaml } from '../_lib/server-draft';
import { findBuildDraft, loadCommittedManifest } from '../drafts';
import { newBuildDraft } from '../new-draft';
import type { BuildDraft } from '../types';

export const dynamic = 'force-dynamic';

async function resolveDraft(draftId: string, from: string | undefined): Promise<BuildDraft | undefined> {
  if (draftId !== 'new') return findBuildDraft(draftId);
  if (from === undefined) return newBuildDraft();
  const committed = loadCommittedManifest(from);
  if (committed === undefined) return undefined;
  return { ...newBuildDraft(committed.yaml, from), manifestPath: committed.path };
}

export default async function BuildDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ draftId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}): Promise<React.ReactElement> {
  const { draftId } = await params;
  const { from } = await searchParams;
  const draft = await resolveDraft(
    decodeURIComponent(draftId),
    typeof from === 'string' && from.length > 0 ? from : undefined,
  );
  if (!draft) notFound();

  return (
    <main className="flex h-[calc(100vh-2rem)] flex-col gap-3 px-6 py-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl text-text-1">{draft.title}</h1>
        <span className="font-mono text-[11.5px] text-text-2">
          {draft.branch.length > 0 ? draft.branch : 'not saved yet'}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {draft.kind === 'server' ? (
          <ServerDraftEditor
            initial={formFromYaml(draft.yaml)}
            existing={loadExistingServers().filter((s) => s.id !== draft.toolId)}
          />
        ) : (
          <DraftEditor draft={draft} />
        )}
      </div>
    </main>
  );
}
