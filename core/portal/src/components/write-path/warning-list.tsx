// MCPForge — W0-J7: warnings (03 §7.2 item 3).
//
// "each `warnings` entry as an amber inline note with its own icon."
// Amber is `--status-write` (03 §7.2 anchors the whole card in it); the icon is
// decorative and the note's meaning is carried by its text plus the visually
// hidden "Warning:" prefix, per 03 §12.5's colour-is-never-alone rule.
import { TriangleAlert } from 'lucide-react';
import { cn } from 'cn';

export interface WarningListProps {
  warnings: readonly string[];
  className?: string | undefined;
}

export function WarningList({ warnings, className }: WarningListProps) {
  if (warnings.length === 0) return null;

  return (
    <section aria-labelledby="plan-warnings-heading" className={cn('w-full', className)}>
      <h3
        id="plan-warnings-heading"
        className="mb-1 text-[11px]/[1.4] font-semibold tracking-[0.5px] uppercase text-text-2"
      >
        Warnings
      </h3>
      <ul data-testid="warning-list" className="flex flex-col gap-1">
        {warnings.map((w, i) => (
          <li
            key={`${i}:${w}`}
            data-testid="warning-item"
            className={cn(
              'flex items-start gap-2 rounded-md border px-2 py-1.5',
              'border-status-write-border bg-status-write-bg text-[13.5px]/[1.55] text-status-write-strong',
            )}
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="sr-only">Warning: </span>
              {w}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
