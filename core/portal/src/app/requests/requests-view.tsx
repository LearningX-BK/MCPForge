// MCPForge — W0-J19: the `/requests` body — the three-tier verdict off the
// real ranker, and the request lifecycle ending at `enabled` (03 §5.3
// "Requests"). W0-P3c: fed by `./page.tsx` with the committed index and the
// tracked requests, as props; this component reads no source of its own.
'use client';

import * as React from 'react';
import Link from 'next/link';
import { verdictFor, type RequestCatalog } from './rank-adapter';
import { DERIVED_LABELS, DERIVED_LIFECYCLE } from './_lib/derive-state';
import type { RequestProblem } from './_lib/load-requests';
import type { RequestSummary } from './_lib/summary';
import { SubmitRequestForm } from './submit-request-form';
import type { RequestVerdict } from './types';

function scoreLabel(score: number): string {
  return score.toFixed(3);
}

function VerdictPanel({ verdict }: { readonly verdict: RequestVerdict }): React.ReactElement {
  if (verdict.tier === 'exists') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-status-ok-border bg-status-ok-bg p-2">
        <span className="rounded border border-status-ok-border px-1.5 py-0.5 text-[11px] font-medium text-status-ok-strong">
          Exists
        </span>
        <span className="text-[12.5px] text-text-1">This already exists —</span>
        <Link href={verdict.match.href} className="text-[12.5px] font-medium text-accent underline">
          {verdict.match.title}
        </Link>
        <span data-testid="verdict-score" className="ml-auto font-mono text-[11px] text-text-2">
          score {scoreLabel(verdict.match.score)}
        </span>
      </div>
    );
  }

  if (verdict.tier === 'near_miss') {
    return (
      <div className="flex flex-col gap-1.5 rounded-md border border-status-write-border bg-status-write-bg p-2">
        <span className="w-fit rounded border border-status-write-border px-1.5 py-0.5 text-[11px] font-medium text-status-write-strong">
          Near miss
        </span>
        <p className="text-[12.5px] text-text-1">
          Closest existing tools — none is an exact match:
        </p>
        <ul className="flex flex-col gap-1">
          {verdict.matches.map((m) => (
            <li key={m.toolId} className="flex items-center gap-2">
              <Link href={m.href} className="text-[12.5px] font-medium text-accent underline">
                {m.title}
              </Link>
              {m.disambiguation !== null && (
                <span className="text-[11.5px] text-text-2">{m.disambiguation}</span>
              )}
              <span
                data-testid="verdict-score"
                className="ml-auto font-mono text-[11px] text-text-2"
              >
                score {scoreLabel(m.score)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-status-platform-border bg-status-platform-bg p-2">
      <span className="rounded border border-status-platform-border px-1.5 py-0.5 text-[11px] font-medium text-status-platform-strong">
        New
      </span>
      <span className="text-[12.5px] text-text-1">
        No match found — pre-filled into a new Build draft.
      </span>
      <span className="ml-auto font-mono text-[11px] text-text-2">{verdict.draftTemplate.id}</span>
    </div>
  );
}

function RequestRow({ record }: { readonly record: RequestSummary }): React.ReactElement {
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-line bg-bg-surface p-3">
      <div className="flex items-center gap-2">
        <Link
          href={`/requests/${record.id}`}
          className="text-[13px] font-medium text-accent underline"
        >
          {record.ask}
        </Link>
        <span
          data-testid="request-state"
          className="ml-auto rounded border border-line px-1.5 py-0.5 text-[11px] text-text-2"
        >
          {record.stateLabel}
        </span>
      </div>
      <div className="flex items-center gap-3 text-[11.5px] text-text-2">
        <span className="font-mono">{record.id}</span>
        <span>{record.requestedBy}</span>
        {record.owner !== null ? (
          <span data-testid="owning-team">
            Waiting on <span className="font-medium text-text-1">{record.owner}</span>
          </span>
        ) : (
          record.state !== 'declined' &&
          record.state !== 'withdrawn' && <span>No owning team named yet: set once triaged.</span>
        )}
      </div>
    </li>
  );
}

export interface RequestsViewProps {
  /** The committed discovery index plus titles (`./source.ts`). */
  readonly catalog: RequestCatalog;
  /** Tracked requests, read from `requests/` (W0-Q5). */
  readonly requests: readonly RequestSummary[];
  /** Hash of the discovery index the live verdict ranks against; stored on a submission. */
  readonly indexDigest?: string | undefined;
  /** `requests/` files that could not be read as a Request. */
  readonly problems?: readonly RequestProblem[] | undefined;
}

export function RequestsView({
  catalog,
  requests,
  indexDigest = 'sha256:absent',
  problems = [],
}: RequestsViewProps): React.ReactElement {
  const [askText, setAskText] = React.useState('');
  const liveVerdict = React.useMemo(
    () => (askText.trim().length > 0 ? verdictFor(askText, catalog) : null),
    [askText, catalog],
  );

  return (
    <main className="px-6 py-6">
      <h1 className="mb-1 font-display text-xl text-text-1">Requests</h1>
      <p className="mb-4 max-w-[70ch] text-[13px] text-text-2">
        This is the same search your agents use — the same <code>forge.find</code> index and ranker,
        run for a plain-English ask instead of an agent&apos;s query.
      </p>

      <section className="mb-6 flex flex-col gap-2 rounded-lg border border-line bg-bg-surface p-4">
        <label htmlFor="ask" className="text-[12.5px] font-medium text-text-1">
          Ask
        </label>
        <input
          id="ask"
          type="text"
          value={askText}
          onChange={(e) => setAskText(e.target.value)}
          placeholder="What do you need to do?"
          className="rounded-md border border-line bg-canvas px-3 py-2 text-[13px] text-text-1"
        />
        {liveVerdict !== null && <VerdictPanel verdict={liveVerdict} />}
        {liveVerdict !== null && (
          <SubmitRequestForm ask={askText} verdict={liveVerdict} indexDigest={indexDigest} />
        )}
      </section>

      <h2 className="mb-2 font-display text-[15px] text-text-1">My requests</h2>
      {requests.length === 0 ? (
        <p data-testid="request-list-empty" className="max-w-[70ch] text-[13px] text-text-2">
          No tracked requests yet. Ask above, then submit the ask as a request: it is recorded as a
          file in git through a change proposal, and its status follows the real change, approval
          and probe.
        </p>
      ) : (
        <ul data-testid="request-list" className="flex flex-col gap-2">
          {requests.map((r) => (
            <RequestRow key={r.id} record={r} />
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <ul
          data-testid="request-problems"
          className="mt-3 flex flex-col gap-1 text-[12px] text-text-2"
        >
          {problems.map((p) => (
            <li key={p.path}>
              <span className="font-mono">{p.path}</span>: {p.message} {p.next}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-[11px] text-text-2">
        Lifecycle: {DERIVED_LIFECYCLE.map((s) => DERIVED_LABELS[s]).join(' → ')}. The final state is{' '}
        <span className="font-medium text-text-1">Enabled</span>, not Merged — a merged manifest
        whose probe reports it disabled is not a delivered capability.
      </p>
    </main>
  );
}
