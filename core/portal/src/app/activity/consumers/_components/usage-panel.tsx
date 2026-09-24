'use client';

// MCPForge — W0-N13: per-consumer usage over time (03 §16.3, `done:`).
// A table, not a canvas graph — 03 §12.2's graph-view rule ("each graph ships
// with an equivalent table view toggled by a visible control") applies to
// canvas interaction this portal does not build at Wave 0; a plain table is
// itself the accessible path with no canvas to toggle away from.
import type { ConsumerUsagePointView } from '../types';

export interface UsagePanelProps {
  points: readonly ConsumerUsagePointView[];
}

export function UsagePanel({ points }: UsagePanelProps) {
  // Most recent first — same convention as every other Activity list.
  const rows = [...points].reverse();
  return (
    <section aria-labelledby="usage-panel-heading" className="flex flex-col gap-2">
      <h2 id="usage-panel-heading" className="font-display text-base text-text-1">
        Usage over time
      </h2>
      <div className="max-h-72 overflow-y-auto overflow-x-auto rounded-lg border border-line bg-surface">
        <table data-testid="usage-panel-table" className="w-full text-left text-[12.5px]">
          <thead className="sticky top-0 border-b border-line bg-surface text-text-2">
            <tr>
              <th scope="col" className="px-3 py-2">Bucket</th>
              <th scope="col" className="px-3 py-2">Calls</th>
              <th scope="col" className="px-3 py-2">Writes</th>
              <th scope="col" className="px-3 py-2">Plans minted</th>
              <th scope="col" className="px-3 py-2">Never confirmed</th>
              <th scope="col" className="px-3 py-2">Identity mismatches</th>
              <th scope="col" className="px-3 py-2">p95 latency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((point) => (
              <tr
                key={point.bucketStart}
                data-testid="usage-panel-row"
                className="border-b border-line last:border-b-0"
              >
                <td className="px-3 py-2 font-mono text-text-1">
                  {new Date(point.bucketStart).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-text-1">{point.calls}</td>
                <td className="px-3 py-2 text-text-1">{point.writes}</td>
                <td className="px-3 py-2 text-text-2">{point.plansMinted}</td>
                <td className={point.plansNeverConfirmed > 0 ? 'px-3 py-2 text-status-write-strong' : 'px-3 py-2 text-text-2'}>
                  {point.plansNeverConfirmed}
                </td>
                <td className={point.identityMismatches > 0 ? 'px-3 py-2 text-status-danger-strong' : 'px-3 py-2 text-text-2'}>
                  {point.identityMismatches}
                </td>
                <td className="px-3 py-2 font-mono text-text-2">
                  {point.p95LatencyMs === null ? '—' : `${point.p95LatencyMs}ms`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
