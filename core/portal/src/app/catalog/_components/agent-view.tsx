// MCPForge — W0-J13: the Agent view (03 §10.4). Card / resident definition /
// describe payload, side by side, each measured against its budget with the
// REAL pinned tokenizer (`@mcpforge/shared`'s `countTokens` — never an
// estimate; see `agent-representations.ts`).
'use client';

import { cn } from 'cn';
import { buildCard, buildDescribePayload, buildResidentDefinition, type AgentRepresentation } from '../agent-representations';
import type { ToolManifest } from '../types';

export interface AgentViewProps {
  manifest: ToolManifest;
  className?: string;
}

function RepresentationCard({ rep }: { rep: AgentRepresentation }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-md border border-line bg-surface-2 p-3" data-testid={`agent-rep-${rep.label}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-text-1">{rep.label}</h3>
        <span
          data-testid="agent-rep-token-count"
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums',
            rep.withinBudget
              ? 'border-status-ok-border bg-status-ok-bg text-status-ok-strong'
              : 'border-status-danger-border bg-status-danger-bg text-status-danger-strong',
          )}
        >
          {rep.tokens} / {rep.budget} tokens
        </span>
      </div>
      {/* axe `scrollable-region-focusable`: a scrollable region needs its own keyboard access. */}
      <pre
        tabIndex={0}
        aria-label={`${rep.label} JSON`}
        className="max-h-72 overflow-auto rounded bg-surface p-2 font-mono text-[11px]/[1.5] text-text-1"
      >
        {JSON.stringify(rep.json, null, 2)}
      </pre>
    </div>
  );
}

export function AgentView({ manifest, className }: AgentViewProps) {
  const card = buildCard(manifest);
  const resident = buildResidentDefinition(manifest);
  const describe = buildDescribePayload(manifest);

  return (
    <div data-testid="agent-view" className={cn('flex flex-col gap-3', className)}>
      <p className="text-[13px] text-text-2">
        Exactly what an agent receives for this tool, at each stage — this is what makes the description quality real
        rather than aspirational (03 §10.4).
      </p>
      <div className="flex flex-col gap-3 md:flex-row">
        <RepresentationCard rep={card} />
        <RepresentationCard rep={resident} />
        <RepresentationCard rep={describe} />
      </div>
    </div>
  );
}
