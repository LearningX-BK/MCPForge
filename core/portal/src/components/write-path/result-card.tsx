// MCPForge — W0-J9: `ResultCard` (03 §7.5, §7.6).
//
// Contents, in this order, for the same reason PlanReviewCard's order is fixed:
//
//   -  replay banner (when replayed)   ReplayNotice   — first, above everything
//   1  the rendered summaryTemplate
//   2  result keys, as first-class chips             ResultKeyChip
//   3  identity echo (mismatch => danger banner, role="alert")
//   4  audit link + latency breakdown (gateway vs target)
//   5  linked calls, both directions (reverses / reversed_by)
//   6  the reverse action slot                        — ReversalAction, supplied
//
// SECURITY SHAPE:
//
//  1. **Result keys are never behind a disclosure.** They render directly in
//     the card body, as a flat list of chips. There is no `collapsed`,
//     `showDetails`, `expandable` or `maxKeys` prop, so a caller cannot bury the
//     reversal handle and the audit handle in a "show details" expander — which
//     is precisely what 03 §7.5 forbids.
//  2. **The identity-echo mismatch is derived, not declared.** The banner fires
//     on `observed !== expected`, including when `observed` is `null`. There is
//     no `mismatch` boolean a caller could leave false. It announces on
//     `role="alert"` — the same rule as W0-J8's refusal banners — because this
//     is "the OIC/`function` risk showing up live".
//  3. **A replay restyles the whole card,** not just adds a banner. See
//     replay-notice.tsx note 1.
//  4. No animation, in either motion setting.
import { TriangleAlert } from 'lucide-react';
import { cn } from 'cn';

import { ReplayNotice } from './replay-notice';
import { ResultKeyChip } from './result-key-chip';
import type { ReactNode } from 'react';
import type { IdentityEchoView, ResultView } from './types';

/** True when the target did not echo back the identity the gateway called as. */
export function identityEchoMismatched(echo: IdentityEchoView): boolean {
  return echo.observed !== echo.expected;
}

export interface ResultCardProps {
  result: ResultView;
  /**
   * The reverse action. `ReversalAction` fills this slot; the card never
   * invents a reverse control of its own, exactly as PlanReviewCard never
   * invents a confirm.
   */
  reverseAction?: ReactNode;
  className?: string | undefined;
}

export function ResultCard({ result, reverseAction, className }: ResultCardProps) {
  const replayed = result.replay !== undefined;
  const echo = result.identityEcho;
  const mismatch = echo !== undefined && identityEchoMismatched(echo);
  const links = result.links;
  const hasLinks =
    links !== undefined &&
    (links.reversesCallId !== undefined || links.reversedByCallId !== undefined);

  return (
    <section
      data-testid="result-card"
      data-replayed={replayed ? 'true' : 'false'}
      aria-label={replayed ? 'Replayed call result' : 'Call result'}
      className={cn(
        'flex w-full flex-col gap-4 rounded-lg border bg-surface-2 p-4 border-l-4',
        replayed
          ? 'border-status-write-border border-l-status-write'
          : 'border-status-ok-border border-l-status-ok',
        className,
      )}
    >
      {result.replay ? <ReplayNotice replay={result.replay} /> : null}

      {/* 1 — the rendered summaryTemplate, first and largest. */}
      <p data-testid="result-summary" className="text-[1.0625rem]/[1.55] font-semibold text-text-1">
        {result.summary}
      </p>

      {/* 2 — first-class chips. Not in an expander. See security note 1. */}
      {result.resultKeys.length > 0 ? (
        <section data-testid="result-keys" aria-label="Result keys">
          <h3 className="mb-1 text-[11px]/[1.4] font-semibold tracking-[0.5px] uppercase text-text-2">
            Result keys
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {result.resultKeys.map((key) => (
              <ResultKeyChip key={key.name} resultKey={key} />
            ))}
          </div>
        </section>
      ) : null}

      {/* 3 — identity echo. */}
      {echo ? (
        mismatch ? (
          <section
            data-testid="identity-echo-mismatch"
            role="alert"
            aria-labelledby="identity-echo-heading"
            className="flex w-full items-start gap-2 rounded-md border border-status-danger-strong bg-status-danger-strong px-3 py-2 text-white"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <div className="min-w-0">
              <h3 id="identity-echo-heading" className="text-[0.9375rem]/[1.6] font-bold">
                Identity mismatch in the target
              </h3>
              <p className="text-[13.5px]/[1.55]">
                {`This call was made as ${echo.expected}, but the target reported ${
                  echo.observed === null ? 'no identity at all' : echo.observed
                }.`}
              </p>
              <p className="text-[12.5px]/[1.5]">
                Report this to the module steward with the correlation id before making another
                call on this binding.
              </p>
            </div>
          </section>
        ) : (
          <dl
            data-testid="identity-echo"
            className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[13.5px]/[1.55]"
          >
            <dt className="text-text-2">Identity observed in target</dt>
            <dd className="font-mono text-[11.5px]/[1.45] text-text-1">{echo.expected}</dd>
          </dl>
        )
      ) : null}

      {/* 4 — audit link and the latency split. */}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[13.5px]/[1.55]">
        <dt className="text-text-2">Call</dt>
        <dd className="font-mono text-[11.5px]/[1.45] text-text-1">
          {result.auditHref ? (
            <a data-testid="result-audit-link" className="underline underline-offset-2" href={result.auditHref}>
              {result.callId}
            </a>
          ) : (
            result.callId
          )}
        </dd>

        <dt className="text-text-2">Tool</dt>
        <dd className="font-mono text-[11.5px]/[1.45] text-text-1">
          {result.toolVersion ? `${result.toolId} ${result.toolVersion}` : result.toolId}
        </dd>

        {result.latency ? (
          <>
            <dt className="text-text-2">Latency</dt>
            <dd data-testid="result-latency" className="text-text-1">
              {`${result.latency.totalMs} ms total — ${result.latency.gatewayMs} ms gateway, ${result.latency.targetMs} ms target`}
            </dd>
          </>
        ) : null}
      </dl>

      {/* 5 — the reversal edge, rendered from both ends. */}
      {hasLinks ? (
        <dl
          data-testid="result-links"
          className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[13.5px]/[1.55]"
        >
          {links.reversesCallId ? (
            <>
              <dt className="text-text-2">Reverses</dt>
              <dd data-testid="result-reverses-link" className="font-mono text-[11.5px]/[1.45] text-text-1">
                {links.reversesCallHref ? (
                  <a className="underline underline-offset-2" href={links.reversesCallHref}>
                    {links.reversesCallId}
                  </a>
                ) : (
                  links.reversesCallId
                )}
              </dd>
            </>
          ) : null}
          {links.reversedByCallId ? (
            <>
              <dt className="text-text-2">Reversed by</dt>
              <dd data-testid="result-reversed-by-link" className="font-mono text-[11.5px]/[1.45] text-text-1">
                {links.reversedByCallHref ? (
                  <a className="underline underline-offset-2" href={links.reversedByCallHref}>
                    {links.reversedByCallId}
                  </a>
                ) : (
                  links.reversedByCallId
                )}
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {/* 6 — ReversalAction's slot. */}
      {reverseAction ? <div data-testid="result-reverse-action">{reverseAction}</div> : null}
    </section>
  );
}
