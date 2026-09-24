'use client';

// MCPForge — W0-N13: the detector table — each detector's state, threshold
// and last fire (03 §16.3, `done:`). All seven of 02 §11.6's declared
// patterns are listed, not only the three Wave 0 implements (W0-N9) — an
// unimplemented detector is shown as "not yet implemented", never silently
// absent (the same discipline `anomaly/config.ts`'s own header states).
import type { DetectorRowView } from '../types';

const SEVERITY_CLASS: Record<DetectorRowView['severity'], string> = {
  low: 'bg-status-neutral-bg text-status-neutral-strong border-status-neutral-border',
  medium: 'bg-status-write-bg text-status-write-strong border-status-write-border',
  high: 'bg-status-write-bg text-status-write-strong border-status-write-border',
  critical: 'bg-status-danger-bg text-status-danger-strong border-status-danger-border',
};

const STATE_CLASS: Record<string, string> = {
  open: 'bg-status-danger-bg text-status-danger-strong border-status-danger-border',
  acknowledged: 'bg-status-write-bg text-status-write-strong border-status-write-border',
  resolved: 'bg-status-ok-bg text-status-ok-strong border-status-ok-border',
  'no findings yet': 'bg-status-neutral-bg text-status-neutral-strong border-status-neutral-border',
};

function chip(label: string, cls: string) {
  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold tracking-[0.4px] whitespace-nowrap ${cls}`}
    >
      {label}
    </span>
  );
}

export interface DetectorTableProps {
  rows: readonly DetectorRowView[];
}

export function DetectorTable({ rows }: DetectorTableProps) {
  return (
    <section aria-labelledby="detector-table-heading" className="flex flex-col gap-2">
      <h2 id="detector-table-heading" className="font-display text-base text-text-1">
        Detectors
      </h2>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table data-testid="detector-table" className="w-full text-left text-[12.5px]">
          <thead className="border-b border-line text-text-2">
            <tr>
              <th scope="col" className="px-3 py-2">Detector</th>
              <th scope="col" className="px-3 py-2">Window</th>
              <th scope="col" className="px-3 py-2">Threshold</th>
              <th scope="col" className="px-3 py-2">Severity</th>
              <th scope="col" className="px-3 py-2">State</th>
              <th scope="col" className="px-3 py-2">Last fire</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.detectorId}
                data-testid={`detector-row-${row.detectorId}`}
                className="border-b border-line align-top last:border-b-0"
              >
                <td className="px-3 py-2">
                  <div className="font-mono text-text-1">{row.detectorId}</div>
                  <div className="max-w-[42ch] text-[11.5px] text-text-2">{row.describes}</div>
                  {!row.implemented ? (
                    <span
                      data-testid={`detector-unimplemented-${row.detectorId}`}
                      className="mt-1 inline-block text-[11px] text-text-2"
                    >
                      Declared, not yet implemented (Wave 3).
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 font-mono text-text-2">{row.window}</td>
                <td className="px-3 py-2 font-mono text-text-1">{row.threshold}</td>
                <td className="px-3 py-2">{chip(row.severity, SEVERITY_CLASS[row.severity])}</td>
                <td className="px-3 py-2">
                  {chip(row.state, STATE_CLASS[row.state] ?? STATE_CLASS['no findings yet']!)}
                </td>
                <td className="px-3 py-2 font-mono text-text-2">
                  {row.lastFireTs ? new Date(row.lastFireTs).toLocaleString() : 'never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
