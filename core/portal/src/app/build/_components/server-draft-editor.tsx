'use client';
// MCPForge — W0-Q3: the "New module server" editor (03 §6, 02 §4.1).
//
// The form is the one input; the YAML beside it is derived from it, so the two
// cannot disagree. The only outward actions are the fixed vocabulary, Save
// draft · Propose · Discard (03 §6.2). Save draft puts the manifest on a
// `forge/build-server-<id>` branch through the ChangeHost; nothing is written
// to the working tree, to the gateway, or to a database. The checks pane runs
// the real `forge validate` (`runFullDraftValidation`), never a second validator.
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { ProposeButton, ReviewActions } from '@/components/change';
import { useOptionalChangeHost, type ChangeHost, type ChangeProposal } from '@/lib/change-host';

import { runFullDraftValidation, type DraftValidationResult } from '../_lib/repo-validate';
import {
  PROMOTION_CONDITIONS,
  SPLIT_RULE_TEXT,
  boundaryWarnings,
  formProblems,
  serverBranchFor,
  serverManifestPath,
  serverYaml,
  type ExistingServer,
  type ServerForm,
  type ServerMode,
} from '../_lib/server-draft';

export interface ServerDraftEditorProps {
  readonly initial: ServerForm;
  /** The proposal this draft already lives on, when it was opened from one. */
  readonly initialProposal?: ChangeProposal | undefined;
  readonly existing: readonly ExistingServer[];
  readonly host?: ChangeHost | undefined;
}

const inputClass =
  'rounded-md border border-line bg-bg-surface px-2 py-1 text-[13px] text-text-1';

interface FieldProps {
  readonly name: keyof ServerForm;
  readonly label: string;
  readonly form: ServerForm;
  readonly set: (name: keyof ServerForm, value: string) => void;
  readonly hint?: string;
  readonly mono?: boolean;
  readonly problem: string | undefined;
}

function Field({ name, label, form, set, hint, mono, problem }: FieldProps): React.ReactElement {
  const id = `server-field-${name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-medium text-text-1">
        {label}
      </label>
      <input
        id={id}
        data-testid={`field-${name}`}
        className={`${inputClass} ${mono === true ? 'font-mono' : ''}`}
        value={form[name]}
        onChange={(e) => set(name, e.target.value)}
        aria-invalid={problem === undefined ? undefined : true}
        aria-describedby={problem === undefined ? undefined : `${id}-problem`}
      />
      {hint === undefined ? null : <p className="text-[11.5px] text-text-2">{hint}</p>}
      {problem === undefined ? null : (
        <p id={`${id}-problem`} data-testid={`problem-${name}`} className="text-[11.5px] text-status-danger-strong">
          {problem}
        </p>
      )}
    </div>
  );
}

export function ServerDraftEditor({
  initial,
  initialProposal,
  existing,
  host,
}: ServerDraftEditorProps): React.ReactElement {
  const contextHost = useOptionalChangeHost();
  const activeHost = host ?? contextHost;

  const [form, setForm] = React.useState<ServerForm>(initial);
  const [touched, setTouched] = React.useState(false);
  const [proposal, setProposal] = React.useState<ChangeProposal | undefined>(initialProposal);
  const [discarded, setDiscarded] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; next: string } | undefined>(undefined);
  const [checks, setChecks] = React.useState<DraftValidationResult | undefined>(undefined);
  const [running, setRunning] = React.useState(false);

  const set = (name: keyof ServerForm, value: string) => {
    setTouched(true);
    setChecks(undefined);
    setForm((f) => ({ ...f, [name]: name === 'mode' ? (value as ServerMode) : value }));
  };

  const problems = React.useMemo(() => formProblems(form), [form]);
  const problemFor = (f: keyof ServerForm) =>
    touched ? problems.find((p) => p.field === f)?.message : undefined;
  const warnings = React.useMemo(() => boundaryWarnings(form, existing), [form, existing]);
  const yaml = React.useMemo(() => serverYaml(form), [form]);
  const path = serverManifestPath(form.id.trim() === '' ? '<id>' : form.id.trim());
  // An id collision cannot be proposed; a module-boundary duplicate can, with the warning on screen.
  const blocked = problems.length > 0 || warnings.some((w) => w.kind === 'same-id');

  function describe(caught: unknown, fallbackNext: string) {
    const e = caught as { message?: unknown; next?: unknown };
    setError({
      message: typeof e.message === 'string' ? e.message : 'The change host refused the request.',
      next: typeof e.next === 'string' ? e.next : fallbackNext,
    });
  }

  async function onSaveDraft() {
    setError(undefined);
    setTouched(true);
    if (blocked) {
      setError({
        message: 'This server draft cannot be saved yet.',
        next: 'Fix the fields marked above (and any id collision), then Save draft again.',
      });
      return;
    }
    if (activeHost === undefined) {
      setError({
        message: 'No change host is available, so this draft cannot be recorded.',
        next: 'Open the portal against a git working tree, then Save draft again.',
      });
      return;
    }
    try {
      const saved = await activeHost.saveDraft({
        title: `${form.id.trim()}: module server draft`,
        branch: serverBranchFor(form.id),
        files: { [path]: yaml },
      });
      setProposal(saved);
    } catch (caught) {
      describe(caught, 'Check the change tray for an existing draft on this branch, then Save draft again.');
    }
  }

  async function onDiscard() {
    if (proposal === undefined || activeHost === undefined) return;
    // The confirm belongs to the UI (types.ts: "the confirm belongs to the UI").
    if (!window.confirm(`Discard the draft on ${proposal.branch}? This deletes the branch.`)) return;
    try {
      await activeHost.discard(proposal.id);
      setProposal(undefined);
      setDiscarded(true);
    } catch (caught) {
      describe(caught, 'Open the change tray and discard the draft from there.');
    }
  }

  async function onRunChecks() {
    setRunning(true);
    try {
      setChecks(await runFullDraftValidation(path, yaml));
    } finally {
      setRunning(false);
    }
  }

  const draftChecks = checks?.failures.filter((f) => f.concernsDraft) ?? [];
  const otherChecks = checks?.failures.filter((f) => !f.concernsDraft) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="split-rule-heading" className="rounded-lg border border-line bg-bg-surface p-3">
        <h2 id="split-rule-heading" className="text-[12px] font-semibold uppercase tracking-[0.4px] text-text-2">
          The split rule
        </h2>
        <p data-testid="split-rule" className="mt-1 max-w-[80ch] text-[13px] text-text-1">
          {SPLIT_RULE_TEXT}
        </p>
        <p className="mt-2 text-[12px] text-text-2">Mode B is for one of:</p>
        <ul className="ml-4 list-disc text-[12px] text-text-2">
          {PROMOTION_CONDITIONS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <form
          aria-label="New module server"
          className="flex flex-col gap-3 rounded-lg border border-line bg-bg-surface p-3"
          onSubmit={(e) => e.preventDefault()}
        >
          <Field name="id" label="Server id" form={form} set={set} mono problem={problemFor('id')} hint="Immutable once merged: renaming is a retire-and-create pair." />
          <Field name="label" label="Label" form={form} set={set} problem={problemFor('label')} />
          <div className="grid grid-cols-2 gap-3">
            <Field name="app" label="App" form={form} set={set} mono problem={problemFor('app')} />
            <Field name="module" label="Module" form={form} set={set} mono problem={problemFor('module')} />
          </div>
          <Field name="version" label="Version" form={form} set={set} mono problem={problemFor('version')} />
          <div className="flex flex-col gap-1">
            <label htmlFor="server-field-mode" className="text-[12px] font-medium text-text-1">
              Mode
            </label>
            <select
              id="server-field-mode"
              data-testid="field-mode"
              className={`${inputClass} w-fit`}
              value={form.mode}
              onChange={(e) => set('mode', e.target.value)}
            >
              <option value="A">A — in the gateway process (default)</option>
              <option value="B">B — its own process (promotion)</option>
            </select>
          </div>
          {form.mode === 'B' ? (
            <Field name="promotionReason" label="Promotion reason" form={form} set={set} problem={problemFor('promotionReason')} />
          ) : null}
          <Field name="owner" label="Owning team" form={form} set={set} problem={problemFor('owner')} />
          <Field name="steward" label="Steward (a named person)" form={form} set={set} problem={problemFor('steward')} />
        </form>

        <div className="flex flex-col gap-3">
          <section aria-labelledby="boundary-heading" className="rounded-lg border border-line bg-bg-surface p-3">
            <h2 id="boundary-heading" className="text-[12px] font-semibold uppercase tracking-[0.4px] text-text-2">
              Module boundaries
            </h2>
            {warnings.length === 0 ? (
              <p data-testid="boundary-clear" className="mt-1 text-[12.5px] text-text-2">
                No existing server serves this app and module.
              </p>
            ) : (
              <div role="alert" data-testid="boundary-warnings">
              <ul className="mt-1 flex flex-col gap-2">
                {warnings.map((w) => (
                  <li
                    key={`${w.kind}-${w.server.id}`}
                    data-testid={`boundary-${w.kind}`}
                    className="rounded-md border border-status-warn-border bg-status-warn-bg p-2 text-[12.5px] text-status-warn-strong"
                  >
                    {w.message}
                  </li>
                ))}
              </ul>
              </div>
            )}
          </section>

          <section aria-labelledby="yaml-heading" className="rounded-lg border border-line bg-bg-surface p-3">
            <h2 id="yaml-heading" className="text-[12px] font-semibold uppercase tracking-[0.4px] text-text-2">
              Manifest YAML
            </h2>
            <p className="font-mono text-[11.5px] text-text-2">{path}</p>
            <pre data-testid="server-yaml" className="mt-1 overflow-auto font-mono text-[12px] text-text-1">
              {yaml}
            </pre>
          </section>

          <section aria-labelledby="checks-heading" className="rounded-lg border border-line bg-bg-surface p-3">
            <div className="flex items-center justify-between">
              <h2 id="checks-heading" className="text-[12px] font-semibold uppercase tracking-[0.4px] text-text-2">
                Checks
              </h2>
              <Button size="sm" onClick={() => void onRunChecks()} disabled={running || problems.length > 0} data-testid="run-checks-button">
                {running ? 'Running…' : 'Run checks'}
              </Button>
            </div>
            {checks === undefined ? (
              <p className="mt-1 text-[12.5px] text-text-2">
                Runs the real <code>forge validate</code> on a copy of the repo with this manifest added.
              </p>
            ) : (
              <div data-testid="checks-result" role="status" className="mt-1 text-[12.5px] text-text-1">
                <p data-testid="checks-verdict" className="font-semibold">
                  {draftChecks.length === 0
                    ? `forge validate: no failures in this manifest (${checks.filesChecked} files checked).`
                    : `forge validate: ${draftChecks.length} failure(s) in this manifest.`}
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {draftChecks.map((f, i) => (
                    <li key={i} data-testid="check-failure" className="text-status-danger-strong">
                      [{f.ruleId}] {f.message} <span className="font-semibold">Fix: </span>
                      {f.fix}
                    </li>
                  ))}
                </ul>
                {otherChecks.length > 0 ? (
                  <p data-testid="checks-other" className="mt-1 text-text-2">
                    {otherChecks.length} failure(s) elsewhere in the repo, not from this draft.
                  </p>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <Button type="button" variant="secondary" onClick={() => void onSaveDraft()} data-testid="save-draft">
          Save draft
        </Button>
        {proposal === undefined ? null : (
          <ProposeButton proposal={proposal} {...(host === undefined ? {} : { host })} onProposed={setProposal} />
        )}
        {proposal === undefined ? null : (
          <ReviewActions proposal={proposal} {...(host === undefined ? {} : { host })} onChanged={setProposal} />
        )}
        {proposal === undefined ? null : (
          <Button type="button" variant="outline" onClick={() => void onDiscard()} data-testid="discard-draft">
            Discard
          </Button>
        )}
        <p className="max-w-[60ch] text-[12px] text-text-2">
          Nothing here is written to the running gateway. Save draft records the manifest on a branch (
          <code>{path}</code>); Propose opens the change for review; Discard deletes the branch.
        </p>
      </div>

      {error === undefined ? null : (
        <div data-testid="save-error" role="alert" className="rounded-lg border border-status-danger-border bg-status-danger-bg p-3">
          <p className="text-[12.5px] font-semibold text-status-danger-strong">{error.message}</p>
          <p className="mt-1 text-[12px] text-text-1">
            <span className="font-semibold">Next: </span>
            {error.next}
          </p>
        </div>
      )}
      {discarded ? (
        <p role="status" data-testid="server-draft-discarded" className="text-[12px] text-text-2">
          The draft branch was discarded.
        </p>
      ) : null}
      {proposal !== undefined ? (
        <p role="status" aria-live="polite" data-testid="draft-editor-status" className="text-[12px] text-text-2">
          {proposal.state === 'draft'
            ? `Draft saved on ${proposal.branch}.`
            : `This change is now ${proposal.state.replace(/_/g, ' ')}.`}
        </p>
      ) : null}
    </div>
  );
}
