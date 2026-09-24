// MCPForge — W0-J20 (reduced scope): the five metric cards (task item 1).
import { cn } from 'cn';
import type { MetricCardView } from '../types';

function Badge({ ciPass }: { readonly ciPass: boolean | null }) {
  if (ciPass === null) {
    return (
      <span
        data-testid="metric-badge-unknown"
        className="rounded-full border border-line px-2 py-0.5 text-[10.5px] font-bold text-text-2"
      >
        no baseline recorded
      </span>
    );
  }
  return (
    <span
      data-testid={ciPass ? 'metric-badge-pass' : 'metric-badge-fail'}
      className={cn(
        'rounded-full border px-2 py-0.5 text-[10.5px] font-bold',
        ciPass
          ? 'border-status-ok-border bg-status-ok-bg text-status-ok-strong'
          : 'border-status-danger-border bg-status-danger-bg text-status-danger-strong',
      )}
    >
      {ciPass ? 'CI pass' : 'CI fail'}
    </span>
  );
}

function Trend({ trend }: { readonly trend: MetricCardView['trend'] }) {
  if (!trend) {
    return (
      <p data-testid="metric-trend-none" className="text-[11.5px] text-text-2">
        no baseline recorded for this metric
      </p>
    );
  }
  const wentUp = trend.currentValue > trend.baselineValue;
  const wentDown = trend.currentValue < trend.baselineValue;
  const displayArrow = wentUp ? '↑' : wentDown ? '↓' : '→';
  return (
    <p
      data-testid="metric-trend"
      className={cn(
        'text-[11.5px] font-semibold',
        trend.regressed ? 'text-status-danger-strong' : trend.improved ? 'text-status-ok-strong' : 'text-text-2',
      )}
    >
      {displayArrow} vs baseline ({trend.baselineValue.toFixed(2)} → {trend.currentValue.toFixed(2)})
    </p>
  );
}

export function MetricCard({ card }: { readonly card: MetricCardView }) {
  return (
    <div
      data-testid={`metric-card-${card.id}`}
      className="flex flex-col gap-2 rounded-lg border border-line bg-bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[12.5px] font-bold text-text-1">{card.label}</h3>
        <Badge ciPass={card.ciPass} />
      </div>
      <div data-testid="metric-current" className="font-display text-xl text-text-1">
        {card.currentText}
      </div>
      <p data-testid="metric-target" className="text-[11.5px] text-text-2">
        Target: {card.targetText}
      </p>
      <Trend trend={card.trend} />
    </div>
  );
}

export function MetricCardRow({ cards }: { readonly cards: readonly MetricCardView[] }) {
  return (
    <div data-testid="metric-card-row" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => (
        <MetricCard key={card.id} card={card} />
      ))}
    </div>
  );
}
