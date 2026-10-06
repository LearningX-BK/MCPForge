'use client';
// MCPForge — W0-Q9: "Suggest" for one allow-listed field of a draft.
// Note: docs/build-plan/w0-q8-assisted-authoring.md §5, §7.
//
// ABSENT, NOT BROKEN (§7): when no overlay enables authoring there is nothing
// here at all, not a disabled button and not an error. A suggestion is only text
// shown beside the field; nothing changes the draft until a person presses
// "Accept this field", one field at a time. There is no "accept all".
import * as React from 'react';
import { parse as parseYaml } from 'yaml';

import { Button } from '@/components/ui/button';
import {
  authoringAccept,
  authoringPreview,
  authoringStatus,
  authoringSuggest,
  type AuthoringStatus,
  type SuggestPayload,
} from '../_authoring/actions';

/** The closed list a model may draft (adapters/model ALLOWED_FIELDS); labels for people. */
const FIELDS: readonly { value: string; label: string; perInput?: true }[] = [
  { value: 'purpose', label: 'Purpose' },
  { value: 'disambiguation', label: 'Disambiguation' },
  { value: 'aliases', label: 'Aliases' },
  { value: 'input.desc', label: 'Input description', perInput: true },
  { value: 'input.example', label: 'Input example', perInput: true },
  { value: 'output.summaryTemplate', label: 'Result summary' },
  { value: 'writeSafety.confirm.planTemplate', label: 'Confirmation plan text' },
];

export interface SuggestPanelProps {
  readonly yamlText: string;
  readonly onYamlChange: (yaml: string) => void;
  /** The draft's provenance sidecar so far; Save draft carries it. */
  readonly provenanceYaml: string | undefined;
  readonly onProvenance: (path: string, yaml: string) => void;
  /** The linked intake request's business half, when the draft came from one. */
  readonly request?: SuggestPayload['request'];
}

type Problem = { message: string; next: string };

function inputNames(yamlText: string): string[] {
  try {
    const doc = parseYaml(yamlText) as { input?: { name?: unknown }[] } | null;
    return (doc?.input ?? []).map((i) => i.name).filter((n): n is string => typeof n === 'string');
  } catch {
    return [];
  }
}

const sel = 'rounded-md border border-line bg-canvas px-2 py-1 text-[12.5px] text-text-1';

export function SuggestPanel({ yamlText, onYamlChange, provenanceYaml, onProvenance, request }: SuggestPanelProps): React.ReactElement | null {
  const [status, setStatus] = React.useState<AuthoringStatus | undefined>(undefined);
  const [field, setField] = React.useState('purpose');
  const [input, setInput] = React.useState('');
  const [provider, setProvider] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<Problem | undefined>(undefined);
  const [preview, setPreview] = React.useState<{ provider: string; system: string; user: string } | undefined>(undefined);
  const [suggestion, setSuggestion] = React.useState<
    { text: string; provenance: { provider: string; model: string; requestId: string } } | undefined
  >(undefined);
  const [accepted, setAccepted] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    let live = true;
    authoringStatus()
      .then((s) => {
        if (!live) return;
        setStatus(s);
        setProvider(s.defaultProvider ?? '');
      })
      .catch(() => live && setStatus({ enabled: false, providers: [], defaultProvider: null }));
    return () => {
      live = false;
    };
  }, []);

  const names = React.useMemo(() => inputNames(yamlText), [yamlText]);
  if (status === undefined || !status.enabled) return null;

  const perInput = FIELDS.find((f) => f.value === field)?.perInput === true;
  const payload = (): SuggestPayload => ({
    yaml: yamlText,
    field,
    ...(perInput && input !== '' ? { inputName: input } : {}),
    ...(provider !== '' ? { providerId: provider } : {}),
    ...(request === undefined ? {} : { request }),
  });
  const needsInput = perInput && input === '';

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setProblem(undefined);
    setAccepted(undefined);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }

  async function onPreview() {
    setSuggestion(undefined);
    const r = await run(() => authoringPreview(payload()));
    if (r === undefined) return;
    if (r.ok) setPreview(r);
    else {
      setPreview(undefined);
      setProblem({ message: r.message, next: r.next });
    }
  }

  async function onSuggest() {
    setPreview(undefined);
    const r = await run(() => authoringSuggest(payload()));
    if (r === undefined) return;
    if (r.ok) setSuggestion({ text: r.text, provenance: r.provenance });
    else {
      setSuggestion(undefined);
      setProblem({ message: r.message, next: r.next });
    }
  }

  async function onAccept() {
    if (suggestion === undefined) return;
    const r = await run(() =>
      authoringAccept({ ...payload(), text: suggestion.text, provenance: suggestion.provenance, provenanceYaml }),
    );
    if (r === undefined) return;
    if (r.ok) {
      onYamlChange(r.yaml);
      onProvenance(r.provenancePath, r.provenanceYaml);
      setSuggestion(undefined);
      setAccepted(field + (perInput ? ` (${input})` : ''));
    } else {
      setProblem({ message: r.message, next: r.next });
    }
  }

  return (
    <section aria-labelledby="suggest-heading" data-testid="suggest-panel" className="rounded-lg border border-line bg-bg-surface p-3">
      <h2 id="suggest-heading" className="text-[12px] font-semibold uppercase tracking-[0.4px] text-text-2">
        Suggest copy
      </h2>
      <p className="mt-1 max-w-[80ch] text-[12px] text-text-2">
        A model drafts text for one field you choose. Nothing changes until you accept that field. Bindings, write
        safety, identity and grants are never drafted by a model.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-text-1">
          Field
          <select value={field} onChange={(e) => { setField(e.target.value); setSuggestion(undefined); setPreview(undefined); }} className={sel}>
            {FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {perInput && (
          <label className="flex flex-col gap-1 text-[12px] text-text-1">
            Input
            <select value={input} onChange={(e) => setInput(e.target.value)} className={sel}>
              <option value="">Choose an input</option>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-[12px] text-text-1">
          Provider
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className={sel}>
            {status.providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.available}>
                {p.id}
                {p.available ? '' : ' (no key stored)'}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" size="sm" variant="outline" disabled={busy || needsInput} onClick={() => void onPreview()}>
          Show what will be sent
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={busy || needsInput} onClick={() => void onSuggest()}>
          Suggest
        </Button>
      </div>

      {preview !== undefined && (
        <div data-testid="suggest-preview" className="mt-3 rounded-md border border-line bg-bg-surface-2 p-2">
          <p className="text-[12px] text-text-1">
            Exactly this would be sent to <span className="font-mono">{preview.provider}</span>. Nothing was sent.
          </p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[11.5px] text-text-2">{`${preview.system}\n\n${preview.user}`}</pre>
        </div>
      )}

      {suggestion !== undefined && (
        <div data-testid="suggest-result" className="mt-3 rounded-md border border-line bg-bg-surface-2 p-2">
          <p className="text-[12px] text-text-2">
            From <span className="font-mono">{suggestion.provenance.provider}</span> /{' '}
            <span className="font-mono">{suggestion.provenance.model}</span>:
          </p>
          <p data-testid="suggest-text" className="mt-1 whitespace-pre-wrap text-[13px] text-text-1">
            {suggestion.text}
          </p>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" onClick={() => void onAccept()} disabled={busy}>
              Accept this field
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setSuggestion(undefined)}>
              Discard
            </Button>
          </div>
        </div>
      )}

      {accepted !== undefined && (
        <p role="status" data-testid="suggest-accepted" className="mt-2 text-[12.5px] text-text-1">
          Accepted {accepted}. It is recorded as model-drafted in the proposal, with you as the acceptor.
        </p>
      )}
      {problem !== undefined && (
        <p role="alert" data-testid="suggest-problem" className="mt-2 text-[12.5px] text-status-danger-strong">
          {problem.message} <span className="text-text-2">{problem.next}</span>
        </p>
      )}
    </section>
  );
}
