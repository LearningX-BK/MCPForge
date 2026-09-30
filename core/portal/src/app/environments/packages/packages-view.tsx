// MCPForge — W0-J17: the `/environments/packages` body (03 §5.3 item 3). The
// slice surface: each package's named servers, derived counts, binding types
// present, and what is not included. The standing D1 note appears verbatim
// while Decision Gate D1 is open (01_GOALS_AND_ROADMAP.md §5) — see
// `../types.ts`'s `D1_PACKAGING_NOTE` for the disclosed judgment call behind
// its exact wording. W0-P3c: fed by `./load-packages.ts` from git.

import * as React from 'react';

import { EnvNav } from '../_components/env-nav';
import { D1_PACKAGING_NOTE } from '../types';
import type { PackageSummary } from '../types';

export interface PackagesViewProps {
  readonly packages: readonly PackageSummary[];
}

export function PackagesView({ packages }: PackagesViewProps): React.ReactElement {
  return (
    <main className="flex flex-col gap-6 px-6 py-6">
      <div>
        <h1 className="mb-1 font-display text-xl text-text-1">Environments</h1>
        <p className="max-w-[70ch] text-[13px] text-text-2">
          Selections, not builds. One byte-identical core, sliced by package.
        </p>
      </div>

      <EnvNav />

      <div
        data-testid="d1-packaging-note"
        role="note"
        className="rounded-md border border-status-write-border bg-status-write-bg p-3 text-[13px]/[1.55] text-status-write-strong"
      >
        {D1_PACKAGING_NOTE}
      </div>

      {packages.length === 0 ? (
        <p data-testid="packages-empty" className="text-[13px] text-text-2">
          No packages are defined. A package is a file in <code>packages/</code>; add one through a
          change proposal, then run <code>forge codegen</code>.
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        {packages.map((pkg) => (
          <section
            key={pkg.id}
            aria-labelledby={`pkg-${pkg.id}`}
            className="rounded-lg border border-line bg-surface p-4"
          >
            <h2 id={`pkg-${pkg.id}`} className="font-display text-lg text-text-1">
              {pkg.label}
            </h2>
            <p className="mb-3 text-[13px] text-text-2">{pkg.blurb}</p>
            {pkg.compiled ? null : (
              <p data-testid="package-not-compiled" className="mb-3 text-[13px] text-text-2">
                Not compiled yet: run <code>forge codegen</code> to produce{' '}
                <code>generated/packages/{pkg.id}.selection.json</code>. The counts below are empty
                for that reason.
              </p>
            )}
            <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-1 text-[13px]/[1.5]">
              <dt className="text-text-2">Module servers</dt>
              <dd className="font-mono text-text-1">{pkg.servers.join(', ')}</dd>
              <dt className="text-text-2">Tools</dt>
              <dd className="text-text-1">{pkg.toolCount}</dd>
              <dt className="text-text-2">Roles</dt>
              <dd className="text-text-1">{pkg.roleCount}</dd>
              <dt className="text-text-2">Binding types present</dt>
              <dd className="text-text-1">{pkg.bindingTypesPresent.join(', ')}</dd>
              <dt className="text-text-2">Not included</dt>
              <dd className="font-mono text-text-1">
                {pkg.notIncluded.length === 0
                  ? 'Every defined module server is in this package.'
                  : pkg.notIncluded.join(', ')}
              </dd>
            </dl>
          </section>
        ))}
      </div>
    </main>
  );
}
