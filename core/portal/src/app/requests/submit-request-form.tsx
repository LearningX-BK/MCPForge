// MCPForge — W0-Q5: "Submit as a request". The business half of the intake
// record (w0-q4-intake-requests.md §2); the governance half is the triager's.
// Submit = a change proposal carrying `requests/<id>.request.yaml`: proposed,
// never written (CLAUDE.md §3). `requestedBy` is stamped by the server action
// from the signed-in session; nothing here can name it.
'use client';

import * as React from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { submitRequest } from '@/lib/change-host/submit-request';
import type { RequestVerdict } from './types';

export interface SubmitRequestFormProps {
  readonly ask: string;
  readonly verdict: RequestVerdict;
  readonly indexDigest: string;
}

function verdictSnapshot(v: RequestVerdict): {
  tier: 'exists' | 'near_miss' | 'new';
  matches: { toolId: string; score: number }[];
} {
  if (v.tier === 'exists')
    return { tier: v.tier, matches: [{ toolId: v.match.toolId, score: v.match.score }] };
  if (v.tier === 'near_miss') {
    return { tier: v.tier, matches: v.matches.map((m) => ({ toolId: m.toolId, score: m.score })) };
  }
  return { tier: 'new', matches: [] };
}

const fieldClass = 'rounded-md border border-line bg-canvas px-3 py-2 text-[13px] text-text-1';

export function SubmitRequestForm({
  ask,
  verdict,
  indexDigest,
}: SubmitRequestFormProps): React.ReactElement {
  const [does, setDoes] = React.useState('');
  const [app, setApp] = React.useState('');
  const [module_, setModule] = React.useState('');
  const [access, setAccess] = React.useState<'read' | 'write'>('read');
  const [inputs, setInputs] = React.useState('');
  const [goodAnswer, setGoodAnswer] = React.useState('');
  const [whoMayRun, setWhoMayRun] = React.useState('');
  const [justification, setJustification] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; next: string } | undefined>();
  const [submittedId, setSubmittedId] = React.useState<string | undefined>();

  const missing = does.trim() === '' || app.trim() === '' || module_.trim() === '';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (missing) {
      setError({
        message: 'The request is incomplete.',
        next: 'Say what it should do and name the app and module, then Submit again.',
      });
      return;
    }
    setBusy(true);
    try {
      const snapshot = verdictSnapshot(verdict);
      const result = await submitRequest({
        ask,
        business: {
          does,
          app,
          module: module_,
          access,
          inputs: inputs
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
          goodAnswer,
          whoMayRun,
        },
        verdict: snapshot,
        indexDigest,
        ...(justification.trim() === '' ? {} : { justification }),
      });
      if (result.ok) setSubmittedId(result.value.branch.replace(/^forge\//, ''));
      else {
        // The shared sign-in copy says "your draft is kept", which is true of a
        // tool draft but not of a request: nothing was saved. What is kept is the
        // form on this page.
        setError({
          message: result.message,
          next:
            result.code === 'CHANGE_SIGN_IN_REQUIRED'
              ? 'Sign in, then Submit again; what you typed stays on this page until you leave it.'
              : result.next,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  if (submittedId !== undefined) {
    return (
      <p data-testid="request-submitted" className="text-[13px] text-text-1">
        Submitted as a change proposal. It shows as Submitted until it is merged.{' '}
        <Link href={`/requests/${submittedId}`} className="font-medium text-accent underline">
          Open {submittedId}
        </Link>
      </p>
    );
  }

  return (
    <form
      aria-label="Submit as a request"
      onSubmit={onSubmit}
      className="mt-2 flex flex-col gap-2 border-t border-line pt-3"
    >
      <h2 className="text-[13px] font-semibold text-text-1">
        {verdict.tier === 'exists' ? 'Still need something different?' : 'Submit as a request'}
      </h2>
      <label className="flex flex-col gap-1 text-[12.5px] text-text-1">
        What should it do?
        <textarea
          value={does}
          onChange={(e) => setDoes(e.target.value)}
          rows={2}
          className={fieldClass}
        />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-[12.5px] text-text-1">
          App
          <input value={app} onChange={(e) => setApp(e.target.value)} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-text-1">
          Module
          <input
            value={module_}
            onChange={(e) => setModule(e.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-text-1">
          Read or write
          <select
            value={access}
            onChange={(e) => setAccess(e.target.value as 'read' | 'write')}
            className={fieldClass}
          >
            <option value="read">Read</option>
            <option value="write">Write</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[12.5px] text-text-1">
        What the user supplies (comma separated)
        <input value={inputs} onChange={(e) => setInputs(e.target.value)} className={fieldClass} />
      </label>
      <label className="flex flex-col gap-1 text-[12.5px] text-text-1">
        What a good answer looks like
        <textarea
          value={goodAnswer}
          onChange={(e) => setGoodAnswer(e.target.value)}
          rows={2}
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-[12.5px] text-text-1">
        Who may run it
        <input
          value={whoMayRun}
          onChange={(e) => setWhoMayRun(e.target.value)}
          className={fieldClass}
        />
      </label>
      {verdict.tier !== 'new' && (
        <label className="flex flex-col gap-1 text-[12.5px] text-text-1">
          Why is this not covered by the matches above?
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={2}
            className={fieldClass}
          />
        </label>
      )}
      {error !== undefined && (
        <p role="alert" className="text-[12.5px] text-status-error-strong">
          {error.message} <span className="text-text-2">{error.next}</span>
        </p>
      )}
      <div>
        <Button type="submit" disabled={busy}>
          Submit request
        </Button>
      </div>
    </form>
  );
}
