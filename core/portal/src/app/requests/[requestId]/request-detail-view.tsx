// MCPForge — W0-Q5: the body of `/requests/[requestId]`. Server-renderable.

import * as React from 'react';
import Link from 'next/link';

import { DERIVED_LABELS, DERIVED_LIFECYCLE } from '../_lib/derive-state';
import type { TrackedRequest } from '../_lib/load-requests';

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-[11rem_1fr] gap-3 py-1 text-[13px]">
      <dt className="text-text-2">{label}</dt>
      <dd className="text-text-1">{children}</dd>
    </div>
  );
}

export function RequestDetailView({
  tracked,
}: {
  readonly tracked: TrackedRequest;
}): React.ReactElement {
  const { request: r, derivation } = tracked;
  const g = r.governance;
  const closed = derivation.state === 'declined' || derivation.state === 'withdrawn';
  const reached = DERIVED_LIFECYCLE.indexOf(derivation.state);

  return (
    <main className="px-6 py-6">
      <p className="mb-1 text-[12px] text-text-2">
        <Link href="/requests" className="underline">
          Requests
        </Link>
      </p>
      <h1 className="mb-1 font-display text-xl text-text-1">{r.ask}</h1>
      <p className="mb-4 font-mono text-[12px] text-text-2">{r.id}</p>

      <section
        aria-labelledby="lifecycle"
        className="mb-6 rounded-lg border border-line bg-bg-surface p-4"
      >
        <h2 id="lifecycle" className="mb-2 text-[13px] font-semibold text-text-1">
          Status: <span data-testid="request-state">{DERIVED_LABELS[derivation.state]}</span>
        </h2>
        {closed ? (
          <p data-testid="closed" className="text-[13px] text-text-1">
            {DERIVED_LABELS[derivation.state]} by {r.closed?.by} on {r.closed?.at}:{' '}
            {r.closed?.reason}
          </p>
        ) : (
          <ol data-testid="lifecycle" className="flex flex-wrap gap-2 text-[12px]">
            {DERIVED_LIFECYCLE.map((s, i) => (
              <li
                key={s}
                aria-current={i === reached ? 'step' : undefined}
                className={`rounded border border-line px-1.5 py-0.5 ${
                  i <= reached ? 'font-medium text-text-1' : 'text-text-2'
                }`}
              >
                {DERIVED_LABELS[s]}
              </li>
            ))}
          </ol>
        )}
        {derivation.blocker !== null && (
          <p data-testid="blocker" className="mt-2 text-[13px] text-text-1">
            {derivation.blocker}
          </p>
        )}
        {derivation.state === 'submitted' && g === undefined && (
          <p className="mt-2 text-[12.5px] text-text-2">
            Waiting for a triager to name an owner, a steward and the tool id it will become.
          </p>
        )}
        <p className="mt-2 text-[11.5px] text-text-2">
          Derived from the change proposal, the manifest, the approval record, the discovery index
          and the probe report. Nothing here is stored as a status.
        </p>
      </section>

      <section aria-labelledby="asked" className="mb-6">
        <h2 id="asked" className="mb-1 text-[13px] font-semibold text-text-1">
          What was asked
        </h2>
        <dl>
          <Row label="Requested by">{r.requestedBy}</Row>
          <Row label="Requested at">{r.requestedAt}</Row>
          <Row label="What it should do">{r.business.does}</Row>
          <Row label="App / module">
            {r.business.app} / {r.business.module}
          </Row>
          <Row label="Read or write">{r.business.access}</Row>
          {r.business.inputs.length > 0 && (
            <Row label="User supplies">{r.business.inputs.join(', ')}</Row>
          )}
          {r.business.goodAnswer !== '' && <Row label="A good answer">{r.business.goodAnswer}</Row>}
          {r.business.whoMayRun !== '' && <Row label="Who may run it">{r.business.whoMayRun}</Row>}
        </dl>
      </section>

      <section aria-labelledby="verdict" className="mb-6">
        <h2 id="verdict" className="mb-1 text-[13px] font-semibold text-text-1">
          Search verdict when submitted
        </h2>
        <dl>
          <Row label="Verdict">{r.verdictAtSubmit.tier.replace('_', ' ')}</Row>
          {r.verdictAtSubmit.matches.map((m) => (
            <Row key={m.toolId} label="Closest">
              <span className="font-mono">{m.toolId}</span>{' '}
              <span className="font-mono text-text-2">score {m.score.toFixed(3)}</span>
            </Row>
          ))}
          {r.verdictAtSubmit.decision?.kind === 'justify' && (
            <Row label="Why still needed">{r.verdictAtSubmit.decision.text}</Row>
          )}
          {r.verdictAtSubmit.decision?.kind === 'merge' && (
            <Row label="Merged into">{r.verdictAtSubmit.decision.into}</Row>
          )}
        </dl>
      </section>

      <section aria-labelledby="gov" className="mb-6">
        <h2 id="gov" className="mb-1 text-[13px] font-semibold text-text-1">
          Triage
        </h2>
        {g === undefined ? (
          <p data-testid="not-triaged" className="text-[13px] text-text-2">
            Not triaged yet.
          </p>
        ) : (
          <dl>
            <Row label="Intended tool id">
              <span className="font-mono">{g.intendedToolId}</span>
            </Row>
            <Row label="Server">{g.server}</Row>
            <Row label="Owner">
              <span data-testid="owning-team">{g.owner}</span>
            </Row>
            <Row label="Steward">{g.steward}</Row>
            <Row label="Sensitivity">{g.sensitivity}</Row>
            {g.processTag !== '' && <Row label="Process tag">{g.processTag}</Row>}
            {g.expectedVolume !== '' && <Row label="Expected volume">{g.expectedVolume}</Row>}
          </dl>
        )}
      </section>

      {(tracked.submissionProposalId !== undefined || tracked.draftProposalId !== undefined) && (
        <section aria-labelledby="links">
          <h2 id="links" className="mb-1 text-[13px] font-semibold text-text-1">
            Linked changes
          </h2>
          <ul className="text-[13px] text-text-1">
            {tracked.submissionProposalId !== undefined && (
              <li>
                Submission: change proposal{' '}
                <span className="font-mono">{tracked.submissionProposalId}</span>
              </li>
            )}
            {tracked.draftProposalId !== undefined && (
              <li>
                Draft: change proposal <span className="font-mono">{tracked.draftProposalId}</span>
              </li>
            )}
          </ul>
        </section>
      )}
    </main>
  );
}
