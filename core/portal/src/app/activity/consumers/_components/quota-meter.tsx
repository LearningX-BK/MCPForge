'use client';

// MCPForge — W0-N13: quota headroom as a meter against a declared consumer
// limit (03 §16.3). Two meters only — `callsPerMinute` and `writesPerDay`,
// the two limits `core/gateway/caps/consumer-limits.ts` actually enforces
// (`CONSUMER_LIMIT_NAMES`). No raw colour: the fill and the state label both
// come from the existing `--status-ok` / `--status-write` / `--status-danger`
// tokens (03 §16.5 — "no new colour tokens").
import type { QuotaMeterView } from '../types';

const STATE_LABEL: Record<QuotaMeterView['state'], string> = {
  ok: 'Within limit',
  warning: 'Approaching limit',
  exceeded: 'Over limit',
};

const STATE_BAR_CLASS: Record<QuotaMeterView['state'], string> = {
  ok: 'bg-status-ok-strong',
  warning: 'bg-status-write-strong',
  exceeded: 'bg-status-danger-strong',
};

const STATE_TEXT_CLASS: Record<QuotaMeterView['state'], string> = {
  ok: 'text-status-ok-strong',
  warning: 'text-status-write-strong',
  exceeded: 'text-status-danger-strong',
};

export interface QuotaMeterProps {
  quota: QuotaMeterView;
}

export function QuotaMeter({ quota }: QuotaMeterProps) {
  const pct = Math.min(100, Math.max(0, quota.percentUsed));
  return (
    <div data-testid={`quota-meter-${quota.name}`} className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className="text-text-1">{quota.label}</span>
        <span className="font-mono text-text-2">
          {quota.current} / {quota.limit} · {quota.windowLabel}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${quota.label}: ${STATE_LABEL[quota.state]}, ${quota.current} of ${quota.limit} used, ${quota.windowLabel}.`}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className={`h-full rounded-full ${STATE_BAR_CLASS[quota.state]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span data-testid={`quota-meter-state-${quota.name}`} className={`text-[11.5px] font-bold ${STATE_TEXT_CLASS[quota.state]}`}>
        {STATE_LABEL[quota.state]}
        {quota.state === 'exceeded' ? ` — ${quota.percentUsed}% of limit` : null}
      </span>
    </div>
  );
}
