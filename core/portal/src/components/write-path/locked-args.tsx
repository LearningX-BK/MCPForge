// MCPForge — W0-J7: arguments, locked (03 §7.2 item 7).
//
// "the canonical arguments as they will be sent, with the short `argsHash`
// (first 8 chars, mono) beside them. Locked means the inputs above are now
// read-only."
//
// Read-only here means genuinely non-editable rendering: a definition list of
// rendered values, no form controls at all — not a disabled input, which still
// looks like a field someone might type into. The hash is the value the
// confirm token is bound to (02 §3.1.1 / policy `argsCanonicalHash`), so it is
// rendered mono and beside the arguments it summarises, per 03 §4.5's rule
// that hashes and business keys are always mono.
import { Lock } from 'lucide-react';
import { cn } from 'cn';

import type { LockedArgsView } from './types';

export interface LockedArgsProps {
  locked: LockedArgsView;
  className?: string | undefined;
}

/** First 8 characters of the canonical hash — the short form the UI shows. */
export function shortHash(hash: string): string {
  return hash.slice(0, 8);
}

function renderArg(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function LockedArgs({ locked, className }: LockedArgsProps) {
  const entries = Object.entries(locked.args);

  return (
    <section
      data-testid="locked-args"
      aria-labelledby="plan-args-heading"
      className={cn('w-full', className)}
    >
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3
          id="plan-args-heading"
          className="flex items-center gap-1 text-[11px]/[1.4] font-semibold tracking-[0.5px] uppercase text-text-2"
        >
          <Lock aria-hidden="true" className="size-3" />
          Arguments, locked
        </h3>
        <span
          data-testid="args-hash"
          className="font-mono text-[11.5px]/[1.45] tabular-nums text-text-2"
        >
          <span className="sr-only">Canonical argument hash, short form: </span>
          {shortHash(locked.argsCanonicalHash)}
        </span>
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 rounded-md bg-inset px-3 py-2 text-[12.5px]/[1.5]">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-mono text-[11.5px]/[1.45] text-text-2">{k}</dt>
            <dd className="font-mono text-[11.5px]/[1.45] tabular-nums text-text-1 break-words">
              {renderArg(v)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
