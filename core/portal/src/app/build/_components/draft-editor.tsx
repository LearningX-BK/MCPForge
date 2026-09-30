'use client';
// MCPForge — W0-J14: `/build/[draftId]` — the three-pane editor (03 §5.3).
//
// LAYOUT JUDGMENT CALL (documented here and in the task report): 03 §5.3
// names three panes (left editor / centre preview / right checks) plus two
// more pieces of behaviour — the guided form and the sandbox run — without
// fixing their screen position. The guided form is placed ABOVE the
// CodeMirror editor, inside the left pane, collapsible but never replacing
// the editor ("the YAML always visible" — 03 §5.3 verbatim) rather than as a
// separate route or a modal. The sandbox run is placed in its own panel
// below the three-pane row, because it is a full interaction sequence
// (plan -> confirm -> execute), not a static preview, and cramming it into
// the already-dense centre or right column would either truncate it or push
// the previews/checks below the fold.
import * as React from 'react';
import { YamlEditor } from './yaml-editor';
import { GuidedForm } from './guided-form';
import { PreviewPane } from './preview-pane';
import { ChecksPane } from './checks-pane';
import { SandboxRun } from './sandbox-run';
import { Button } from '@/components/ui/button';
import { ProposeButton } from '@/components/change';
import { useOptionalChangeHost, type ChangeHost, type ChangeProposal } from '@/lib/change-host';
import { buildPreviews } from '../_lib/representations';
import type { BuildDraft } from '../types';

export interface DraftEditorProps {
  readonly draft: BuildDraft;
  /** Overrides the context host — the only injection point tests need. */
  readonly host?: ChangeHost | undefined;
}

/** `forge/build-<slug>` — the branch a draft's Save draft lands on. Stable
 * per tool id so re-saving the same draft keeps updating one branch, exactly
 * as `role-editor.tsx`'s `forge/role-<roleId>` does per role. */
function branchFor(draft: BuildDraft): string {
  const slug = draft.toolId.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `forge/build-${slug || draft.id}`;
}

function manifestPathFor(toolId: string): string {
  // `manifests/{app}/{module}/{entity}.{verb}.tool.yaml` (02 §2.2's own
  // naming convention) — derived from the tool id, which is the only thing
  // a draft reliably has before `forge validate` confirms the rest.
  const [app, module_, entity, verb] = toolId.split('.');
  return `manifests/${app}/${module_}/${entity}.${verb}.tool.yaml`;
}

export function DraftEditor({ draft, host }: DraftEditorProps): React.ReactElement {
  const contextHost = useOptionalChangeHost();
  const activeHost = host ?? contextHost;

  const [yamlText, setYamlText] = React.useState(draft.yaml);
  const [guidedFormOpen, setGuidedFormOpen] = React.useState(false);
  const [proposal, setProposal] = React.useState<ChangeProposal | undefined>(undefined);
  const [saveError, setSaveError] = React.useState<
    { message: string; next: string } | undefined
  >(undefined);
  const previews = React.useMemo(() => buildPreviews(yamlText), [yamlText]);
  // W0-P3c: a draft opened from an existing file (a committed manifest, or a
  // saved draft) keeps writing to THAT file while its id is unchanged, so an
  // edit never lands as a second manifest with the same id. Only a new tool,
  // or a changed id, gets the path derived from the id.
  const pathFor = React.useCallback(
    (toolId: string) =>
      draft.manifestPath !== undefined && toolId === draft.toolId
        ? draft.manifestPath
        : manifestPathFor(toolId),
    [draft.manifestPath, draft.toolId],
  );
  const manifestPath = React.useMemo(() => pathFor(draft.toolId), [pathFor, draft.toolId]);
  const liveManifestPath = React.useMemo(
    () => pathFor(previews.toolView.id),
    [pathFor, previews.toolView.id],
  );

  async function onSaveDraft() {
    setSaveError(undefined);
    if (activeHost === undefined) {
      setSaveError({
        message: 'No change host is available, so this draft cannot be recorded.',
        next: 'Open the portal against a git working tree, then Save draft again.',
      });
      return;
    }
    try {
      const saved = await activeHost.saveDraft({
        title: `${previews.toolView.id}: manifest draft`,
        branch: branchFor({ ...draft, toolId: previews.toolView.id }),
        files: { [liveManifestPath]: yamlText },
      });
      setProposal(saved);
    } catch (caught) {
      const err = caught as { message?: unknown; next?: unknown };
      setSaveError({
        message: typeof err.message === 'string' ? err.message : 'The change host refused the draft.',
        next:
          typeof err.next === 'string'
            ? err.next
            : 'Check the change tray for an existing draft on this branch, then Save draft again.',
      });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-3" style={{ gridAutoRows: '1fr' }}>
        {/* Left: guided form (collapsible) + the YAML editor, always visible. */}
        <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-line bg-bg-surface p-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.4px] text-text-2">Manifest YAML</h2>
            <Button size="sm" variant="outline" onClick={() => setGuidedFormOpen((v) => !v)} data-testid="toggle-guided-form">
              {guidedFormOpen ? 'Hide guided form' : 'Guided form'}
            </Button>
          </div>
          {guidedFormOpen ? (
            <div className="max-h-[45%] overflow-auto rounded-md border border-line bg-bg-surface-2">
              <GuidedForm yamlText={yamlText} onChange={setYamlText} />
            </div>
          ) : null}
          <div className="min-h-0 flex-1">
            <YamlEditor value={yamlText} onChange={setYamlText} aria-label="Manifest YAML" />
          </div>
        </div>

        {/* Centre: live previews. */}
        <div className="min-h-0 rounded-lg border border-line bg-bg-surface">
          <PreviewPane card={previews.card} resident={previews.resident} describe={previews.describe} schema={previews.schema} />
        </div>

        {/* Right: checks. */}
        <div className="min-h-0 rounded-lg border border-line bg-bg-surface">
          <ChecksPane
            manifestPath={manifestPath}
            yamlText={yamlText}
            toolId={previews.toolView.id}
            sodGuardrails={previews.toolView.writeSafety?.guardrails.filter((g) => g.kind === 'sodConflict') ?? []}
          />
        </div>
      </div>

      <div className="rounded-lg border border-line bg-bg-surface">
        <h2 className="px-3 pt-3 text-[12px] font-semibold uppercase tracking-[0.4px] text-text-2">Sandbox run</h2>
        <SandboxRun tool={previews.toolView} />
      </div>

      {/* The only outward action. 03 §6.2's fixed vocabulary — same pattern
          as `governance/_components/role-editor.tsx`'s Save draft / Propose. */}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() => void onSaveDraft()}
          data-testid="save-draft"
        >
          Save draft
        </Button>
        {proposal === undefined ? null : (
          <ProposeButton
            proposal={proposal}
            {...(host === undefined ? {} : { host })}
            onProposed={setProposal}
          />
        )}
        <p className="max-w-[60ch] text-[12px] text-text-2">
          Nothing here is written to the running gateway. Save draft records the manifest on a
          branch (<code>{liveManifestPath}</code>); Propose opens the change for review.
        </p>
      </div>

      {saveError !== undefined && (
        <div
          data-testid="save-error"
          role="alert"
          className="rounded-lg border border-status-danger-border bg-status-danger-bg p-3"
        >
          <p className="text-[12.5px] font-semibold text-status-danger-strong">{saveError.message}</p>
          <p className="mt-1 text-[12px] text-text-1">{saveError.next}</p>
        </div>
      )}

      {proposal !== undefined && (
        <p role="status" aria-live="polite" data-testid="draft-editor-status" className="text-[12px] text-text-2">
          {proposal.state === 'draft'
            ? `Draft saved on ${proposal.branch}.`
            : `Proposed — this change is now ${proposal.state.replace(/_/g, ' ')}.`}
        </p>
      )}
    </div>
  );
}
