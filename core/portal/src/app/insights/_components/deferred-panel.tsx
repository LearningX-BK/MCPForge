// MCPForge — W0-J20 (reduced scope): the explicit, visible, disclosed
// deferred state for the two Insights surfaces that cannot honestly be built
// yet (task items 4 and 5). Reuses the same visual treatment
// `governance/posture/page.tsx`'s "no probe has reported" banner uses
// (status-write tokens, same border/bg/strong triple) — the precedent named
// in this task — rather than inventing a second "not yet available" style.
export interface DeferredPanelProps {
  readonly testId: string;
  readonly title: string;
  readonly reason: string;
  readonly unblockedBy: string;
}

export function DeferredPanel({ testId, title, reason, unblockedBy }: DeferredPanelProps) {
  return (
    <section
      aria-labelledby={`${testId}-heading`}
      data-testid={testId}
      className="rounded-lg border border-status-write-border bg-status-write-bg p-4"
    >
      <h3 id={`${testId}-heading`} className="text-sm font-bold text-status-write-strong">
        {title} — deferred
      </h3>
      <p data-testid={`${testId}-reason`} className="mt-1 max-w-[80ch] text-[12.5px] text-text-1">
        {reason}
      </p>
      <p data-testid={`${testId}-unblock`} className="mt-2 text-[12px] text-text-2">
        Unblocked by: {unblockedBy}
      </p>
    </section>
  );
}
