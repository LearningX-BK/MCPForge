'use client';

// MCPForge — W0-J18: the role editor (03 §5.3 tab 1, 02 §4.3, 02 §8.1 item 4).
//
// "edit the globs on the left, and the compiled scope renders live on the right
// as an explicit tool-id list, with added/removed tools diffed against the
// currently merged scope ... None of this can be saved directly — it produces a
// [change proposal] whose diff *is* the compiled `roles/*.scope.json`."
//
// Three properties this component is built to make structurally true, not
// merely intended:
//
//  1. THE RIGHT PANE IS NEVER SYNTHESISED HERE. It renders `CompiledRoleDraft`
//     and nothing else. This file contains no glob matcher, no tool-id filter
//     and no budget arithmetic — every number and id comes from
//     `_lib/compile-role.ts`, which runs the real codegen. There is no code
//     path that could show a plausible-looking list the compiler did not
//     produce.
//  2. NOTHING SAVES DIRECTLY. There is no write of any kind in this component.
//     The only outward action is `ChangeHost.saveDraft` followed by
//     `ProposeButton` (W0-J12), and the draft's files are `proposalFiles()` —
//     the edited `roles/<id>.yaml` and the COMPILED `generated/roles/
//     <id>.scope.json` the live compile produced. The proposal's diff is
//     therefore the compiled scope, by construction.
//  3. A BROKEN EDIT SHOWS NO TOOL LIST. When the compile fails the pane shows
//     the failure and its `next`, never the previous good list — a stale list
//     presented as live is the same lie as a hidden one.
import * as React from 'react';
import { cn } from 'cn';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ProposeButton } from '@/components/change';
import { useOptionalChangeHost, type ChangeHost, type ChangeProposal } from '@/lib/change-host';

import { canProposeEdit, proposalFiles, scopeRows } from '../_lib/scope-diff';
import type { CompiledRoleDraft, RoleSource } from '../types';
import { RoleBudgetMeter } from './budget-meter';
import { SodPanel } from './sod-panel';

/** The live-compile seam. Defaults to the server action; tests inject a spy. */
export type CompileRoleFn = (
  roleId: string,
  yamlText: string,
  mergedToolIds: readonly string[],
) => Promise<CompiledRoleDraft>;

export interface RoleEditorProps {
  sources: readonly RoleSource[];
  compile: CompileRoleFn;
  /** Overrides the context host — the only injection point tests need. */
  host?: ChangeHost | undefined;
  author?: string;
}

const STATE_CLASS = {
  added: 'text-status-ok-strong',
  removed: 'text-status-danger-strong line-through',
  unchanged: 'text-text-1',
} as const;

const STATE_MARK = { added: '+', removed: '−', unchanged: ' ' } as const;

export function RoleEditor({ sources, compile, host, author = 'portal' }: RoleEditorProps) {
  const contextHost = useOptionalChangeHost();
  const activeHost = host ?? contextHost;

  const [roleId, setRoleId] = React.useState(sources[0]?.roleId ?? '');
  const source = sources.find((s) => s.roleId === roleId);

  const [yamlText, setYamlText] = React.useState(source?.yamlText ?? '');
  const [draft, setDraft] = React.useState<CompiledRoleDraft | undefined>(undefined);
  const [compiling, setCompiling] = React.useState(false);
  const [proposal, setProposal] = React.useState<ChangeProposal | undefined>(undefined);
  const [saveError, setSaveError] = React.useState<
    { message: string; next: string } | undefined
  >(undefined);

  // Re-seed when the selected role changes.
  React.useEffect(() => {
    setYamlText(source?.yamlText ?? '');
    setDraft(undefined);
    setProposal(undefined);
    setSaveError(undefined);
  }, [source?.roleId, source?.yamlText]);

  // The live loop: every edit recompiles. Debounced, because each compile is a
  // real codegen run — but debounced, never skipped: the pane must not lag
  // behind the source it claims to describe.
  React.useEffect(() => {
    if (source === undefined || yamlText === '') return;
    let live = true;
    setCompiling(true);
    const timer = setTimeout(() => {
      void compile(source.roleId, yamlText, source.mergedToolIds)
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
  }, [compile, source, yamlText]);

  if (source === undefined) {
    return (
      <p data-testid="roles-empty" className="text-[13px] text-text-2">
        No roles are defined in <code>roles/</code> yet. Add one and it appears here with its
        compiled scope.
      </p>
    );
  }

  const rows = draft?.error === undefined && draft !== undefined
    ? scopeRows(source.mergedToolIds, draft.toolIds)
    : [];
  const proposable = canProposeEdit(source, yamlText, draft);

  async function onSaveDraft() {
    setSaveError(undefined);
    if (activeHost === undefined) {
      setSaveError({
        message: 'No change host is available, so this role edit cannot be recorded.',
        next: 'Open the portal against a git working tree, then Save draft again.',
      });
      return;
    }
    if (draft === undefined || draft.error !== undefined || source === undefined) return;
    try {
      const saved = await activeHost.saveDraft({
        title: `Role ${source.roleId}: scope change`,
        branch: `forge/role-${source.roleId}`,
        files: proposalFiles(source, yamlText, draft),
        author,
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="role-select" className="text-[12.5px] font-semibold text-text-1">
          Role
        </label>
        <select
          id="role-select"
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          className="rounded-md border border-line bg-surface px-2 py-1 text-[12.5px] text-text-1"
        >
          {sources.map((s) => (
            <option key={s.roleId} value={s.roleId}>
              {s.label} ({s.roleId})
            </option>
          ))}
        </select>
        <span className="font-mono text-[12px] text-text-2">{source.path}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT — the globs. */}
        <section aria-labelledby="role-source-heading" className="flex flex-col gap-2">
          <h2 id="role-source-heading" className="font-display text-base text-text-1">
            Role source
          </h2>
          <p className="text-[12px] text-text-2">
            Edit <code>includes</code>, <code>excludes</code> and <code>coreTools</code>. Every
            edit recompiles the scope on the right.
          </p>
          <Textarea
            aria-label={`YAML source for role ${source.roleId}`}
            data-testid="role-yaml"
            value={yamlText}
            onChange={(e) => setYamlText(e.target.value)}
            spellCheck={false}
            className="min-h-[420px] font-mono text-[12.5px]"
          />
        </section>

        {/* RIGHT — the compiled scope, explicit and diffed. */}
        <section aria-labelledby="compiled-scope-heading" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="compiled-scope-heading" className="font-display text-base text-text-1">
              Compiled scope
            </h2>
            <span data-testid="compile-state" className="text-[12px] text-text-2">
              {compiling ? 'compiling…' : draft === undefined ? 'not yet compiled' : source.scopePath}
            </span>
          </div>

          {draft?.error !== undefined ? (
            <div
              data-testid="compile-error"
              role="alert"
              className="rounded-lg border border-status-danger-border bg-status-danger-bg p-3"
            >
              <p className="text-[12.5px] font-semibold text-status-danger-strong">
                {draft.error.message}
              </p>
              <p className="mt-1 text-[12px] text-text-1">{draft.error.next}</p>
            </div>
          ) : (
            <>
              <p className="text-[12px] text-text-2">
                <span data-testid="scope-count">{draft?.toolIds.length ?? 0}</span> tools granted ·{' '}
                <span data-testid="scope-added-count" className="text-status-ok-strong">
                  +{draft?.toolsAdded.length ?? 0}
                </span>{' '}
                <span data-testid="scope-removed-count" className="text-status-danger-strong">
                  −{draft?.toolsRemoved.length ?? 0}
                </span>{' '}
                against the merged scope
              </p>
              <ul
                data-testid="compiled-tool-list"
                className="max-h-[420px] overflow-y-auto rounded-lg border border-line bg-surface p-3"
              >
                {rows.map((row) => (
                  <li
                    key={row.toolId}
                    data-testid={`scope-row-${row.state}`}
                    data-tool-id={row.toolId}
                    className={cn('font-mono text-[12.5px]', STATE_CLASS[row.state])}
                  >
                    <span aria-hidden="true">{STATE_MARK[row.state]} </span>
                    {row.toolId}
                    <span className="sr-only"> — {row.state}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {draft !== undefined && draft.error === undefined ? (
          <RoleBudgetMeter budget={draft.budget} />
        ) : (
          <div />
        )}
        {draft !== undefined && draft.error === undefined ? (
          <SodPanel findings={draft.sod} />
        ) : (
          <div />
        )}
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
        <p className="max-w-[60ch] text-[12px] text-text-2">
          Nothing here is written to the running gateway. Save draft records the edit on a branch;
          the change proposal&rsquo;s diff is the compiled{' '}
          <code>{source.scopePath}</code>.
        </p>
      </div>

      {/* 03 §12.4: state transitions announce on a polite `role="status"`
          region. Save draft and Propose are the only two outward actions
          this component has, so this is the one place their outcome needs
          to be announced — same pattern as the write-path's plan/execute
          regions. */}
      {proposal === undefined ? null : (
        <p role="status" aria-live="polite" data-testid="role-editor-status" className="text-[12px] text-text-2">
          {proposal.state === 'draft'
            ? `Draft saved on ${proposal.branch}.`
            : `Proposed — this change is now ${proposal.state.replace(/_/g, ' ')}.`}
        </p>
      )}

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
