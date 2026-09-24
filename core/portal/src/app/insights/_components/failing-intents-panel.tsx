// MCPForge — W0-J20 follow-up: the failing-benchmark-cases panel (task item
// 5), now real. `Sa1Report.failingIntents` (`core/cli/src/commands/bench.ts`)
// carries every `hit === false` intent from the last rank-1 run — this panel
// renders it, distinguishing a confused near-miss pair (`category ===
// 'near_miss'`: `expect` vs `actual` IS the confused pair) from a negative
// wrongly answered with a tool (`category` is `negative`/`sod_negative` and
// `actual !== 'none'`) — both read straight off real fields, nothing
// re-derived. Same card/section visual language as `budget-pressure-panel.tsx`.
import type { FailingIntent } from '../types';

const CATEGORY_LABEL: Readonly<Record<FailingIntent['category'], string>> = {
  direct: 'missed positive',
  near_miss: 'near-miss confused',
  negative: 'negative wrongly answered',
  sod_negative: 'SoD-negative wrongly answered',
};

function descriptionFor(fi: FailingIntent): string {
  if (fi.category === 'near_miss') {
    return `expected ${fi.expect}, got ${fi.actual}`;
  }
  if (fi.category === 'negative' || fi.category === 'sod_negative') {
    return fi.actual === 'none'
      ? `expected a refusal, got ${fi.actual}`
      : `should have refused, but matched ${fi.actual}`;
  }
  return `expected ${fi.expect}, got ${fi.actual}`;
}

export interface FailingIntentsPanelProps {
  readonly rows: readonly FailingIntent[];
}

export function FailingIntentsPanel({ rows }: FailingIntentsPanelProps) {
  return (
    <section
      aria-labelledby="failing-intents-heading"
      data-testid="failing-intents-panel"
      className="rounded-lg border border-line bg-bg-surface p-4"
    >
      <h3 id="failing-intents-heading" className="mb-1 text-sm font-bold text-text-1">
        Failing benchmark cases
      </h3>
      <p className="mb-3 text-[11.5px] text-text-2">
        Every intent the last rank-1 run (02 §5.9) did not resolve correctly — which near-miss
        pair was confused, which negative was wrongly answered with a tool.
      </p>
      {rows.length === 0 ? (
        <p data-testid="failing-intents-empty" className="text-[12.5px] text-text-2">
          No failing intents in the last run.
        </p>
      ) : (
        <ul data-testid="failing-intents-list" className="flex flex-col gap-2">
          {rows.map((fi, i) => (
            <li
              key={`${fi.role}-${fi.intent}-${i}`}
              data-testid={`failing-intent-row-${i}`}
              data-category={fi.category}
              className="flex flex-col gap-1 rounded-lg border border-line bg-canvas p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[12.5px] text-text-1">&quot;{fi.intent}&quot;</span>
                <span className="text-[11px] font-semibold uppercase text-text-2">
                  {CATEGORY_LABEL[fi.category]}
                </span>
              </div>
              <div className="flex flex-wrap items-baseline gap-2 text-[11.5px] text-text-2">
                <span className="font-mono">role: {fi.role}</span>
                <span>{descriptionFor(fi)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
