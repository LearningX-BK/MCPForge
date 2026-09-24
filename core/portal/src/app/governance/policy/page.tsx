// MCPForge — W0-J18: `/governance/policy` (03 §5.3 "Governance" item 2).
//
// "the guardrails declared across the catalogue, in one table ... Plus
// deployment-level caps from the overlay (row caps, rate limits, concurrency)
// shown as values with their compiled-in hard ceilings beside them, so it is
// visible that a customer can tighten but not loosen."
//
// BESIDE. Two columns, two real numbers, never one merged figure — a single
// "effective" number would make the one-directional rule invisible, which is
// the only thing this table exists to show. The effective value is shown as a
// third column so the merge is legible, not as a replacement for either.
import * as React from 'react';
import Link from 'next/link';

import { GovNav } from '../_components/gov-nav';
import { loadCapRows, loadGuardrailRows } from '../_lib/policy';

export default function GovernancePolicyPage(): React.ReactElement {
  const guardrails = loadGuardrailRows();
  const caps = loadCapRows();

  return (
    <main className="flex flex-col gap-6 px-6 py-6">
      <div>
        <h1 className="mb-1 font-display text-xl text-text-1">Governance</h1>
        <p className="max-w-[80ch] text-[13px] text-text-2">
          What the catalogue refuses, and what this deployment refuses on top of it.
        </p>
      </div>

      <GovNav />

      <section aria-labelledby="guardrails-heading" className="flex flex-col gap-2">
        <h2 id="guardrails-heading" className="font-display text-lg text-text-1">
          Declared guardrails
        </h2>
        <p className="max-w-[80ch] text-[12.5px] text-text-2">
          A read-only view over the manifests. Changing one is a manifest change:{' '}
          <Link href="/build" className="text-accent underline">
            propose it in Build
          </Link>
          .
        </p>
        {guardrails.length === 0 ? (
          <p data-testid="guardrails-empty" className="text-[12.5px] text-text-2">
            No guardrails are declared in this catalogue.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table data-testid="guardrail-table" className="w-full text-left text-[12.5px]">
              <thead className="border-b border-line text-text-2">
                <tr>
                  <th scope="col" className="px-3 py-2">Kind</th>
                  <th scope="col" className="px-3 py-2">Field</th>
                  <th scope="col" className="px-3 py-2">Threshold</th>
                  <th scope="col" className="px-3 py-2">Message</th>
                  <th scope="col" className="px-3 py-2">Tools</th>
                </tr>
              </thead>
              <tbody>
                {guardrails.map((g) => (
                  <tr key={`${g.kind}-${g.field}-${g.threshold}`} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 font-mono text-text-1">{g.kind}</td>
                    <td className="px-3 py-2 font-mono text-text-1">{g.field ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-text-1">{g.threshold}</td>
                    <td className="px-3 py-2 text-text-2">
                      {g.message === '' ? 'built-in message (names field, value and limit)' : g.message}
                    </td>
                    <td className="px-3 py-2 font-mono text-text-2">{g.toolIds.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="caps-heading" className="flex flex-col gap-2">
        <h2 id="caps-heading" className="font-display text-lg text-text-1">
          Deployment caps
        </h2>
        <p className="max-w-[80ch] text-[12.5px] text-text-2">
          An overlay can tighten these; it cannot loosen them. The hard ceiling is a compiled-in
          constant — changing one is a release, not a deployment edit.
        </p>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table data-testid="caps-table" className="w-full text-left text-[12.5px]">
            <thead className="border-b border-line text-text-2">
              <tr>
                <th scope="col" className="px-3 py-2">Cap</th>
                <th scope="col" className="px-3 py-2">Overlay value</th>
                <th scope="col" className="px-3 py-2">Compiled-in hard ceiling</th>
                <th scope="col" className="px-3 py-2">In force</th>
              </tr>
            </thead>
            <tbody>
              {caps.map((c) => (
                <tr key={c.name} data-testid={`cap-row-${c.name}`} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 text-text-1">
                    {c.label}
                    <span className="ml-2 font-mono text-text-3">{c.name}</span>
                  </td>
                  <td data-testid={`cap-overlay-${c.name}`} className="px-3 py-2 font-mono text-text-1">
                    {c.overlayValue === null ? (
                      <span className="text-text-2">not tightened</span>
                    ) : (
                      c.overlayValue.toLocaleString('en-GB')
                    )}
                    {c.clamped ? (
                      <span className="ml-2 rounded-full border border-status-danger-border bg-status-danger-bg px-2 py-0.5 text-[11.5px] font-semibold text-status-danger-strong">
                        clamped to the ceiling
                      </span>
                    ) : null}
                  </td>
                  <td data-testid={`cap-ceiling-${c.name}`} className="px-3 py-2 font-mono text-text-1">
                    {c.hardCeiling.toLocaleString('en-GB')}
                  </td>
                  <td data-testid={`cap-effective-${c.name}`} className="px-3 py-2 font-mono text-text-2">
                    {c.effective.toLocaleString('en-GB')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
