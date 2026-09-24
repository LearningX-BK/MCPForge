// MCPForge — W0-J8: `RefusalBanner`, variants per error code (03 §7.3, §7.6).
//
// "Three refusal states must render as **distinct, explained outcomes, not
// toasts**." This file is the reason there is no toast: a refusal on the write
// path renders in place, in the flow, with its own detail, and it stays on
// screen until the user acts on it.
//
// Accessibility (03 §12.7): "Refusals announce on `role=\"alert\"` (assertive),
// because a refusal is not something to discover later." Every variant below
// renders on `role="alert"`.
//
// SECURITY SHAPE:
//
//  1. **A banner cannot say less than the refusal knows.** `RefusalView`
//     (./types.ts) makes each code's detail REQUIRED, and this component
//     renders all of it. `PLAN_ARGUMENT_MISMATCH` renders EVERY entry of
//     `changes` — no `max`, no "and 3 more", no expander. The mismatch banner
//     is the one that catches an agent planning £100 and executing £100,000;
//     a truncated list of changed fields is exactly the failure mode.
//  2. **Never "invalid request".** There is no generic fallback string in this
//     file. Each code has its own heading, its own body and its own `next`.
//  3. **The `next` is always rendered.** Non-negotiable #5: every error path
//     carries a non-empty, agent-actionable `next`, and a `next` the user
//     cannot see is a `next` that does not exist.
//
// The labels and icons come from `@mcpforge/shared`'s `ERROR_CODE` map so the
// banner and `StatusChip` cannot drift apart in vocabulary — but this is NOT a
// wrapped chip: a chip carries a label, and 03 §7.3 requires the banner to
// carry the changed fields and the guardrail's own message, which a chip has
// nowhere to put.
import { ERROR_CODE } from '@mcpforge/shared';
import { cn } from 'cn';

import { StatusIcon } from '../chips/icon';
import type { RefusalView } from './types';

export interface RefusalBannerProps {
  refusal: RefusalView;
  className?: string | undefined;
}

/** `PLAN_EXPIRED` is amber (`status-write`); the other two are danger. */
function toneClasses(code: RefusalView['code']): string {
  return code === 'PLAN_EXPIRED'
    ? 'border-status-write-border bg-status-write-bg text-status-write-strong'
    : 'border-status-danger-border bg-status-danger-bg text-status-danger-strong';
}

export function RefusalBanner({ refusal, className }: RefusalBannerProps) {
  const entry = ERROR_CODE[refusal.code];

  return (
    <section
      // Assertive, per 03 §12.7. A refusal is not something to discover later.
      role="alert"
      data-testid="refusal-banner"
      data-code={refusal.code}
      className={cn(
        'flex w-full flex-col gap-2 rounded-lg border p-3 text-[13.5px]/[1.55]',
        toneClasses(refusal.code),
        className,
      )}
    >
      <h3 className="flex items-center gap-2 text-[14px]/[1.5] font-semibold">
        <StatusIcon name={entry.icon} className="size-4 shrink-0" />
        <span data-testid="refusal-title">{entry.label}</span>
      </h3>

      {refusal.code === 'PLAN_EXPIRED' ? (
        <p data-testid="refusal-message">
          {refusal.message ??
            'This plan is past its expiry. Nothing was executed. The plan above is what you had; plan again to get a fresh one.'}
        </p>
      ) : null}

      {refusal.code === 'PLAN_ARGUMENT_MISMATCH' ? (
        <>
          <p data-testid="refusal-message">
            {refusal.message ??
              'The arguments presented do not match the plan you confirmed. Nothing was executed.'}
          </p>
          <table
            data-testid="refusal-changes"
            className="w-full border-collapse text-left text-[13px]/[1.5]"
          >
            <caption className="sr-only">
              Arguments that changed between the plan and this call, with the planned value and the
              presented value side by side.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="border-b border-current/20 py-1 pr-3 font-semibold">
                  Field
                </th>
                <th scope="col" className="border-b border-current/20 py-1 pr-3 font-semibold">
                  Planned
                </th>
                <th scope="col" className="border-b border-current/20 py-1 font-semibold">
                  Presented
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Every entry. No cap, no expander — see security note 1. */}
              {refusal.changes.map((change) => (
                <tr key={change.field} data-testid="refusal-change-row" data-field={change.field}>
                  <th
                    scope="row"
                    className="py-1 pr-3 text-left font-mono text-[12.5px]/[1.5] font-normal"
                  >
                    {change.field}
                  </th>
                  <td data-testid="refusal-change-planned" className="py-1 pr-3 font-mono">
                    {change.planned ?? '— absent —'}
                  </td>
                  <td
                    data-testid="refusal-change-presented"
                    className="py-1 font-mono font-semibold"
                  >
                    {change.presented ?? '— absent —'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {refusal.code === 'POLICY_GUARDRAIL_BREACH' ? (
        <>
          {/* The guardrail's own message, verbatim. */}
          <p data-testid="refusal-message">{refusal.message}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]/[1.5]">
            <dt className="font-semibold">Rule</dt>
            <dd data-testid="refusal-rule" className="font-mono">
              {refusal.rule}
            </dd>
            <dt className="font-semibold">Value</dt>
            <dd data-testid="refusal-value">{refusal.valueBreached}</dd>
          </dl>
          {refusal.sodGrants && refusal.sodGrants.length > 0 ? (
            <div data-testid="refusal-sod">
              <p className="font-semibold">
                Separation of duties: you hold conflicting grants, from these roles.
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {refusal.sodGrants.map((g) => (
                  <li key={`${g.role}:${g.grant}`} data-testid="refusal-sod-grant">
                    <span className="font-mono">{g.grant}</span>
                    <span> — granted by role </span>
                    <span data-testid="refusal-sod-role" className="font-mono">
                      {g.role}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      {/* Non-negotiable #5. Always rendered, always specific. */}
      <p data-testid="refusal-next">
        <span className="font-semibold">Next: </span>
        {refusal.next}
      </p>
    </section>
  );
}
