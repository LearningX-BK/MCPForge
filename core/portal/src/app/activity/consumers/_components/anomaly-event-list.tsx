'use client';

// MCPForge — W0-N13: the anomaly-event list, every event linking into the
// audit calls that triggered it (03 §16.3, `done:`). Each event's evidence
// links go straight to `/activity/calls/[callId]` (W0-J16), the same route
// the rest of Activity already uses for one call's detail.
import type { AnomalyEventRowView } from '../types';

const SEVERITY_CLASS: Record<AnomalyEventRowView['severity'], string> = {
  low: 'bg-status-neutral-bg text-status-neutral-strong border-status-neutral-border',
  medium: 'bg-status-write-bg text-status-write-strong border-status-write-border',
  high: 'bg-status-write-bg text-status-write-strong border-status-write-border',
  critical: 'bg-status-danger-bg text-status-danger-strong border-status-danger-border',
};

export interface AnomalyEventListProps {
  events: readonly AnomalyEventRowView[];
}

export function AnomalyEventList({ events }: AnomalyEventListProps) {
  return (
    <section aria-labelledby="anomaly-events-heading" className="flex flex-col gap-2">
      <h2 id="anomaly-events-heading" className="font-display text-base text-text-1">
        Anomaly events
      </h2>
      {events.length === 0 ? (
        <p data-testid="anomaly-events-empty" className="text-[12.5px] text-text-2">
          No anomaly events recorded for this consumer.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((event) => (
            <li
              key={event.id}
              data-testid={`anomaly-event-${event.id}`}
              className="rounded-lg border border-line bg-surface p-3 text-[12.5px]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold tracking-[0.4px] whitespace-nowrap ${SEVERITY_CLASS[event.severity]}`}
                >
                  {event.severity}
                </span>
                <span className="font-mono text-text-1">{event.detectorId}</span>
                <span className="text-text-2">
                  observed {event.observed} vs threshold {event.threshold} over {event.window}
                </span>
                <span className="ml-auto text-text-2">{new Date(event.ts).toLocaleString()}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-text-2">Evidence:</span>
                {event.auditCallLinks.map((link) => (
                  <a
                    key={link.callId}
                    href={link.href}
                    data-testid={`anomaly-event-evidence-${event.id}-${link.callId}`}
                    className="rounded-full border border-line px-2 py-0.5 font-mono text-accent underline"
                  >
                    {link.callId}
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
