// MCPForge — W0-J16: `/activity` — the run explorer over `audit_call` (03
// §5.3 "Activity").
'use client';

import * as React from 'react';

import { DataTable } from '../../components/data';
import { activityColumns } from './columns';
import { BusinessKeySearch, matchesBusinessKey } from './business-key-search';
import { IntegrityPanel } from './integrity-panel';
import {
  CURRENT_USER_SUBJECT,
  loadActivityCalls,
  loadIntegrityVerification,
} from './fixtures';
import { SAVED_VIEWS } from './saved-views';
import type { ActivityCallSummary } from './types';

type ActiveView = 'all' | (typeof SAVED_VIEWS)[number]['id'];

export default function ActivityPage(): React.ReactElement {
  const calls = React.useMemo(() => loadActivityCalls(), []);
  const verification = React.useMemo(() => loadIntegrityVerification(), []);
  const now = React.useMemo(() => Date.now(), []);

  const [activeView, setActiveView] = React.useState<ActiveView>('all');
  const [query, setQuery] = React.useState('');

  const rows: ActivityCallSummary[] = React.useMemo(() => {
    if (query.trim() !== '') {
      return calls.filter((call) => matchesBusinessKey(call, query));
    }
    if (activeView === 'all') return [...calls];
    const view = SAVED_VIEWS.find((v) => v.id === activeView);
    return view ? view.apply(calls, CURRENT_USER_SUBJECT, now) : [...calls];
  }, [calls, activeView, query, now]);

  return (
    <main className="flex flex-col gap-6 px-6 py-6">
      <div>
        <h1 className="mb-1 font-display text-xl text-text-1">Activity</h1>
        <p className="max-w-[70ch] text-[13px] text-text-2">
          Audit and consumption, in one dataset. Every call the gateway made a decision about —
          planned, executed, rejected or reversed.
        </p>
      </div>

      {/* The business-key search box — first-class, at the top, one field. */}
      <BusinessKeySearch value={query} onChange={setQuery} />

      {/* The two fixed saved views, shipped with the product. */}
      <div role="tablist" aria-label="Saved views" className="flex flex-wrap gap-2">
        <button
          type="button"
          role="tab"
          aria-selected={activeView === 'all'}
          data-testid="saved-view-all"
          disabled={query.trim() !== ''}
          onClick={() => setActiveView('all')}
          className="rounded-full border border-line px-3 py-1 text-[12.5px] text-text-1 aria-selected:border-accent-border aria-selected:bg-accent-tint aria-selected:text-accent disabled:opacity-50"
        >
          Everything
        </button>
        {SAVED_VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={activeView === view.id}
            data-testid={`saved-view-${view.id}`}
            disabled={query.trim() !== ''}
            title={view.description}
            onClick={() => setActiveView(view.id)}
            className="rounded-full border border-line px-3 py-1 text-[12.5px] text-text-1 aria-selected:border-accent-border aria-selected:bg-accent-tint aria-selected:text-accent disabled:opacity-50"
          >
            {view.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p data-testid="activity-empty-state" className="text-[13px] text-text-2">
          No calls recorded yet. This local instance stores audit records in SQLite; they start
          empty on a fresh checkout.
        </p>
      ) : (
        <DataTable
          columns={activityColumns}
          data={rows}
          caption="Calls"
          onRowOpen={(row) => {
            window.location.href = `/activity/calls/${row.id}`;
          }}
          getRowId={(row) => row.id}
        />
      )}

      <IntegrityPanel verification={verification} />
    </main>
  );
}
