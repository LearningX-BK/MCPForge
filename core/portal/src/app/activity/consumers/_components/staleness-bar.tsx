'use client';

// MCPForge — W0-N13: the staleness marker + manual refresh control, 03
// §11.4 ("Every runtime-data surface carries an `Updated 4m ago` marker with
// a manual refresh, positioned consistently at the top-right of the panel"
// / "Approvals and Activity poll on a slow interval (30s) ... they do not
// stream"). Reuses `../../environments/staleness.ts`'s `asOfLabel` math
// (W0-J17) rather than a second implementation of "how stale" — see that
// file's own header for why it is dependency-free arithmetic safe to import
// from a sibling client route.
import * as React from 'react';
import { asOfLabel } from '../../../environments/staleness';

export interface StalenessBarProps {
  generatedAt: string;
  onRefresh: () => void;
}

export function StalenessBar({ generatedAt, onRefresh }: StalenessBarProps) {
  return (
    <div className="flex items-center justify-end gap-2 text-[12px] text-text-2">
      <span data-testid="consumers-staleness-marker">Updated {asOfLabel(generatedAt)}</span>
      <button
        type="button"
        data-testid="consumers-refresh-button"
        onClick={onRefresh}
        className="rounded-full border border-line px-2 py-0.5 text-text-1 hover:bg-accent-tint"
      >
        Refresh
      </button>
    </div>
  );
}
