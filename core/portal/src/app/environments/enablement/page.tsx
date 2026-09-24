// MCPForge — W0-J17: `/environments/enablement` (03 §5.3 item 2). The
// concept console's Application Enablement page, made real by
// `probe-report.json` — every non-`resolved` tool, grouped by owning team.
'use client';

import * as React from 'react';

import { EnvNav } from '../_components/env-nav';
import { ProbeStatusChip } from '../../../components/chips';
import { loadEnablementBacklog } from '../fixtures';

export default function EnablementPage(): React.ReactElement {
  const groups = React.useMemo(() => loadEnablementBacklog(), []);
  const totalCount = groups.reduce((n, g) => n + g.entries.length, 0);

  return (
    <main className="flex flex-col gap-6 px-6 py-6">
      <div>
        <h1 className="mb-1 font-display text-xl text-text-1">Environments</h1>
        <p className="max-w-[70ch] text-[13px] text-text-2">
          Per application: capability probe results and the enablement backlog — every tool not
          yet resolved, grouped by owning team, because that is how the work gets assigned.
        </p>
      </div>

      <EnvNav />

      <h2 className="font-display text-lg text-text-1">Enablement backlog</h2>
      <p className="text-[13px] text-text-2">
        {totalCount} tool{totalCount === 1 ? '' : 's'} not yet resolved, across {groups.length}{' '}
        owning team{groups.length === 1 ? '' : 's'}.
      </p>

      {groups.length === 0 ? (
        <p data-testid="enablement-empty" className="text-[13px] text-text-2">
          Nothing in the backlog — every tool in this catalogue is resolved.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section
              key={group.owningTeam}
              aria-labelledby={`team-${group.owningTeam}`}
              className="rounded-lg border border-line bg-surface p-4"
            >
              <h3 id={`team-${group.owningTeam}`} className="mb-2 text-sm font-bold text-text-1">
                {group.owningTeam}
                <span className="ml-2 font-normal text-text-2">
                  ({group.entries.length})
                </span>
              </h3>
              <ul className="flex flex-col gap-3">
                {group.entries.map((entry) => (
                  <li key={entry.toolId} className="flex flex-col gap-1 border-t border-line pt-2 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] text-text-1">{entry.toolId}</span>
                      <ProbeStatusChip status={entry.status} owningTeam={entry.owningTeam} />
                    </div>
                    <p className="text-[12.5px] text-text-2">
                      Failing check: <span className="font-mono">{entry.failingCheck}</span>
                    </p>
                    <p className="text-[12.5px] text-text-2">{entry.remediation}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
