'use client';

// MCPForge — W0-N12: the consumer detail editor (03 §16.2, 02 §11.2).
//
// "The detail editor, in the Roles-tab style: edit on the left, the compiled
// authorization artefact rendered explicitly on the right, and nothing saves
// directly — every change produces a change proposal whose diff is the
// compiled artefact."
//
// It is deliberately W0-J18's `../../_components/role-editor.tsx` in structure,
// prop shape and vocabulary, and the same three properties are structurally
// true here rather than merely intended:
//
//  1. THE RIGHT PANE IS NEVER SYNTHESISED HERE. It renders
//     `CompiledConsumerDraft` and nothing else. This file contains no binding
//     -type filter, no sensitivity comparison, no expiry arithmetic and no
//     approval resolution — every value comes from `_lib/compile-consumer.ts`,
//     which runs the real codegen. There is no code path that could show a
//     plausible-looking authorization the compiler did not produce.
//  2. NOTHING SAVES DIRECTLY. There is no write of any kind in this component.
//     The only outward action is `ChangeHost.saveDraft` followed by
//     `ProposeButton` (W0-J12), and the draft's files are `proposalFiles()` —
//     the edited `consumers/<id>.consumer.yaml` and the COMPILED
//     `generated/consumers/<id>.authorization.json` the live compile produced.
//     The proposal's diff is therefore the compiled artefact, by construction.
//     The vocabulary is 03 §6.2's fixed three: Save draft · Propose · Discard.
//  3. A BROKEN EDIT SHOWS NO AUTHORIZATION. When the compile fails the pane
//     shows the failure and its `next`, never the previous good artefact — a
//     stale authorization presented as live is the same lie as a hidden one.
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ProposeButton } from '@/components/change';
import { useOptionalChangeHost, type ChangeHost, type ChangeProposal } from '@/lib/change-host';

import { canProposeEdit, proposalFiles } from '../_lib/authorization-view';
import type { CompiledConsumerDraft, ConsumerSource } from '../types';
import { CompiledAuthorization } from './compiled-authorization';

/** The live-compile seam. Defaults to the server action; tests inject a spy. */
export type CompileConsumerFn = (
  consumerId: string,
  yamlText: string,
  mergedArtefactJson: string,
) => Promise<CompiledConsumerDraft>;

export interface ConsumerEditorProps {
  source: ConsumerSource;
  compile: CompileConsumerFn;
  /** Overrides the context host — the only injection point tests need. */
  host?: ChangeHost | undefined;
  author?: string;
}

export function ConsumerEditor({ source, compile, host, author = 'portal' }: ConsumerEditorProps) {
  const contextHost = useOptionalChangeHost();
  const activeHost = host ?? contextHost;

  const [yamlText, setYamlText] = React.useState(source.yamlText);
  const [draft, setDraft] = React.useState<CompiledConsumerDraft | undefined>(undefined);
  const [compiling, setCompiling] = React.useState(false);
  const [proposal, setProposal] = React.useState<ChangeProposal | undefined>(undefined);
  const [saveError, setSaveError] = React.useState<{ message: string; next: string } | undefined>(
    undefined,
  );

  // Re-seed when the selected consumer changes.
  React.useEffect(() => {
    setYamlText(source.yamlText);
    setDraft(undefined);
    setProposal(undefined);
    setSaveError(undefined);
  }, [source.consumerId, source.yamlText]);

  // The live loop: every edit recompiles. Debounced, because each compile is a
  // real codegen run — but debounced, never skipped: the pane must not lag
  // behind the record it claims to describe.
  React.useEffect(() => {
    if (yamlText === '') return;
    let live = true;
    setCompiling(true);
    const timer = setTimeout(() => {
      void compile(source.consumerId, yamlText, source.mergedArtefactJson)
        .then((result) => {
          if (live) setDraft(result);
        })
        .finally(() => {
          if (live) setCompiling(false);
        });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
      setCompiling(false);
    };
  }, [compile, source.consumerId, source.mergedArtefactJson, yamlText]);

  const proposable = canProposeEdit(source, yamlText, draft);

  async function onSaveDraft() {
    setSaveError(undefined);
    if (activeHost === undefined) {
      setSaveError({
        message: 'No change host is available, so this registration edit cannot be recorded.',
        next: 'Open the portal against a git working tree, then Save draft again.',
      });
      return;
    }
    if (draft === undefined || draft.error !== undefined) return;
    try {
      const saved = await activeHost.saveDraft({
        title: source.isNew
          ? `Consumer ${source.consumerId}: registration`
          : `Consumer ${source.consumerId}: authorization change`,
        branch: `forge/consumer-${source.consumerId}`,
        files: proposalFiles(source, yamlText, draft),
        author,
      });
      setProposal(saved);
    } catch (caught) {
      const err = caught as { message?: unknown; next?: unknown };
      setSaveError({
        message:
          typeof err.message === 'string' ? err.message : 'The change host refused the draft.',
        next:
          typeof err.next === 'string'
            ? err.next
            : 'Check the change tray for an existing draft on this branch, then Save draft again.',
      });
    }
  }

  function onDiscard() {
    setYamlText(source.yamlText);
    setProposal(undefined);
    setSaveError(undefined);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] text-text-2">{source.path}</span>
        {source.isNew ? (
          <span data-testid="consumer-is-new" className="text-[12px] text-text-2">
            new registration — nothing exists under <code>consumers/</code> for this id yet
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT — the authored record. */}
        <section aria-labelledby="consumer-source-heading" className="flex flex-col gap-2">
          <h2 id="consumer-source-heading" className="font-display text-base text-text-1">
            Consumer record
          </h2>
          <p className="max-w-[80ch] text-[12px] text-text-2">
            Edit <code>authorizations</code>, <code>limits</code>, <code>attestation</code> and{' '}
            <code>bindingGrants</code>. Every edit recompiles the authorization on the right.{' '}
            <code>credential.ref</code> is a reference and never a value — a secret typed here
            would be refused by <code>forge validate</code>.
          </p>
          <Textarea
            aria-label={`YAML source for consumer ${source.consumerId}`}
            data-testid="consumer-yaml"
            value={yamlText}
            onChange={(e) => setYamlText(e.target.value)}
            spellCheck={false}
            className="min-h-[520px] font-mono text-[12.5px]"
          />
        </section>

        {/* RIGHT — the compiled authorization artefact, explicit and diffed. */}
        <CompiledAuthorization
          draft={draft}
          compiling={compiling}
          artefactPath={source.artefactPath}
        />
      </div>

      {/* The only outward action. 03 §6.2's fixed vocabulary. */}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <Button
          type="button"
          variant="secondary"
          disabled={!proposable}
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
        <Button type="button" variant="ghost" onClick={onDiscard} data-testid="discard">
          Discard
        </Button>
        <p className="max-w-[60ch] text-[12px] text-text-2">
          Nothing here is written to the running gateway or to{' '}
          <code>consumers/</code>. Save draft records the edit on a branch; the change
          proposal&rsquo;s diff is the compiled <code>{source.artefactPath}</code>, and the
          registration takes effect only once it is approved and merged.
        </p>
      </div>

      {saveError === undefined ? null : (
        <div
          role="alert"
          data-testid="save-error"
          className="rounded-lg border border-status-danger-border bg-status-danger-bg p-3"
        >
          <p className="text-[12.5px] font-semibold text-status-danger-strong">
            {saveError.message}
          </p>
          <p className="mt-1 text-[12px] text-text-1">{saveError.next}</p>
        </div>
      )}
    </div>
  );
}
