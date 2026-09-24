// MCPForge — W0-J20 (reduced scope): the per-role TTFC breakdown (task item
// 2), sourced from the real `TtfcReport.byRole` — 02 §5.10's closing
// sentence: "the checkpoint will see, because CI reports TTFC per role."
import { cn } from 'cn';
import type { RoleTtfcRow } from '../types';

function fmt(v: number | null): string {
  return v === null ? 'n/a' : String(Math.round(v));
}

export function RoleTtfcTable({ rows }: { readonly rows: readonly RoleTtfcRow[] }) {
  if (rows.length === 0) {
    return (
      <p data-testid="role-ttfc-empty" className="text-[12.5px] text-text-2">
        No intents authored yet for any role — nothing to break down. Add positive intents under
        <code> evals/&lt;server&gt;/intents.yaml</code>.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-bg-surface">
      <table data-testid="role-ttfc-table" className="w-full text-left text-[12.5px]">
        <thead className="border-b border-line text-text-2">
          <tr>
            <th scope="col" className="px-3 py-2">Role</th>
            <th scope="col" className="px-3 py-2">Core-hit TTFC (max)</th>
            <th scope="col" className="px-3 py-2">Core-miss TTFC (max)</th>
            <th scope="col" className="px-3 py-2">Cold TTFC (max)</th>
            <th scope="col" className="px-3 py-2">VTC</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ role, ttfc }) => (
            <tr key={role} data-testid={`role-ttfc-row-${role}`} className="border-b border-line last:border-b-0">
              <th scope="row" className="px-3 py-2 text-left font-mono font-normal text-text-1">
                {role}
              </th>
              <td className="px-3 py-2 text-text-1">{fmt(ttfc.coreHit.max)}</td>
              <td className="px-3 py-2 text-text-1">{fmt(ttfc.coreMiss.max)}</td>
              <td className="px-3 py-2 text-text-1">{fmt(ttfc.cold.max)}</td>
              <td className="px-3 py-2">
                <span
                  className={cn(
                    'font-mono font-semibold',
                    ttfc.vtcWithinDefault
                      ? 'text-text-1'
                      : ttfc.vtcWithinHardCap
                        ? 'text-status-write-strong'
                        : 'text-status-danger-strong',
                  )}
                >
                  {ttfc.vtc}
                </span>
                {ttfc.residentSetKnown ? null : (
                  <span className="ml-2 text-[11px] text-text-2">no Role manifest — resident set unknown</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
