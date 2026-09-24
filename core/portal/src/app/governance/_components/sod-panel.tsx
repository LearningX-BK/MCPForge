'use client';

// MCPForge — W0-J18: the segregation-of-duties panel (02 §4.3, 03 §5.3 tab 1).
//
// "the SoD panel shows declared conflicts and implicit `create`/`approve` pairs
// with dispositions."
//
// BOTH halves, always, and they are not interchangeable. A declared conflict
// carries the disposition its author wrote — 02 §4.3's vocabulary, `block` |
// `warn-and-require-exception` | `warn`. An implicit create/approve pair that
// nobody declared has NO disposition, and this panel says exactly that rather
// than inventing one: "no decision recorded" is the finding, and softening it
// into a default would be the same escalation `sod.ts` refuses to allow by
// suppressing the implicit line when a declared entry covers it.
import { cn } from 'cn';

import { sortSodFindings } from '../_lib/scope-diff';
import type { SodFindingView } from '../types';

export const NO_DISPOSITION_LABEL = 'no decision recorded';

export interface SodPanelProps {
  findings: readonly SodFindingView[];
}

const RULE_LABEL: Record<SodFindingView['ruleId'], string> = {
  'sod.declared-conflict': 'Declared conflict',
  'sod.implicit-create-approve': 'Implicit create/approve pair',
};

export function SodPanel({ findings }: SodPanelProps) {
  const rows = sortSodFindings(findings);
  return (
    <section
      aria-labelledby="sod-heading"
      data-testid="sod-panel"
      className="rounded-lg border border-line bg-surface p-4"
    >
      <h3 id="sod-heading" className="mb-2 text-sm font-bold text-text-1">
        Segregation of duties
      </h3>
      {rows.length === 0 ? (
        <p data-testid="sod-empty" className="text-[12.5px] text-text-2">
          This compiled scope grants no declared conflict and no create/approve pair on one entity.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((f) => (
            <li
              key={`${f.ruleId}:${f.pair.join(',')}`}
              data-testid={f.ruleId}
              className="flex flex-col gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-semibold text-text-1">
                  {RULE_LABEL[f.ruleId]}
                </span>
                <span
                  data-testid="sod-disposition"
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11.5px] font-semibold',
                    f.severity === 'error'
                      ? 'border-status-danger-border bg-status-danger-bg text-status-danger-strong'
                      : 'border-status-write-border bg-status-write-bg text-status-write-strong',
                  )}
                >
                  {f.disposition ?? NO_DISPOSITION_LABEL}
                </span>
              </div>
              <p className="font-mono text-[12.5px] text-text-1">{f.pair.join('  ·  ')}</p>
              {f.message === '' ? null : (
                <p className="max-w-[80ch] text-[12px] text-text-2">{f.message}</p>
              )}
              {f.fix === '' ? null : (
                <p className="max-w-[80ch] text-[12px] text-text-2">{f.fix}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
