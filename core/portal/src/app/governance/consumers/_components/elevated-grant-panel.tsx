// MCPForge — W0-N12: the elevated-grant panel (03 §16.2, 02 §11.4, CLAUDE.md #7).
//
// "each `bindingGrant` with its standing authorization, approver and expiry —
// chipped `--status-write` within 30 days of expiry, `--status-danger` past it."
//
// Three properties this component is built to make structurally true:
//
//  1. EVERY FIELD IS THE COMPILER'S. `expired`, and a standing
//     authorization's `status` / `approver` / `expiresAt` / `effective`, are
//     read out of the compiled artefact. This file contains no expiry
//     arithmetic and no approval resolution; the only derived value is the
//     30-day presentation threshold, which lives in
//     `_lib/authorization-view.ts` and is tested there.
//  2. NO NEW COLOUR AND NO NEW CHIP TREATMENT. `--status-write` and
//     `--status-danger` reach the screen through W0-J5's `StatusChip`, whose
//     `token` is one of `status.ts`'s six semantic roles. 03 §16.5: "No new
//     colour tokens."
//  3. A DEAD GRANT IS STILL SHOWN. An expired grant, and an unresolvable
//     standing authorization, are rendered with their failing state rather
//     than filtered out — for the reason `compileGrant` states: a
//     disappearance and an absence look identical, and "who could execute
//     this wrapper package in March" must have an answer.
import * as React from 'react';

import type { StatusEntry } from '@mcpforge/shared';
import { StatusChip } from '@/components/chips';

import { sortGrants } from '../_lib/authorization-view';
import type { GrantExpiryView, GrantRowView } from '../types';

/**
 * The expiry chip. Built from the derived `GrantExpiryView`, which already
 * carries the semantic token, so this is a projection and not a second
 * decision. `icon` names a lucide icon exactly as `status.ts`'s own entries do.
 */
function expiryEntry(expiry: GrantExpiryView): StatusEntry {
  return {
    token: expiry.token,
    label: expiry.label,
    srLabel: expiry.srLabel,
    icon:
      expiry.state === 'expired'
        ? 'ShieldOff'
        : expiry.state === 'expiring'
          ? 'TriangleAlert'
          : expiry.state === 'undated'
            ? 'CircleHelp'
            : 'ShieldCheck',
  };
}

/** 02 §11.4.4's closed `StandingStatus` vocabulary, said in words. */
const STANDING_STATUS_COPY: Readonly<Record<string, string>> = {
  active: 'In force — writes take the ordinary plan → confirm path.',
  unresolved: 'Names no committed record under approvals/. Every write reverts to a per-call human approval.',
  'no-approver': 'The approval record names no approver. Every write reverts to a per-call human approval.',
  'no-expiry': 'The approval record states no usable expiry. Every write reverts to a per-call human approval.',
  'not-approved': 'The approval record is not an approval — pending, declined or silent. Every write reverts to a per-call human approval.',
  expired: "The approval record's own expiry has passed. Every write reverts to a per-call human approval.",
};

export interface ElevatedGrantPanelProps {
  grants: readonly GrantRowView[];
}

export function ElevatedGrantPanel({ grants }: ElevatedGrantPanelProps) {
  const rows = sortGrants(grants);

  return (
    <section
      aria-labelledby="elevated-grants-heading"
      data-testid="elevated-grant-panel"
      className="flex flex-col gap-2"
    >
      <h2 id="elevated-grants-heading" className="font-display text-base text-text-1">
        Elevated binding grants
      </h2>
      <p className="max-w-[80ch] text-[12px] text-text-2">
        Catalogue membership is discovery; scope is visibility; neither is permission. Executing a{' '}
        <code>plsql</code> or <code>function</code> binding, a write-classified{' '}
        <code>wrapped-vendor</code> tool, or anything carrying a policy exception needs a named,
        expiring, approval-recorded grant below.
      </p>

      {rows.length === 0 ? (
        <p data-testid="elevated-grants-empty" className="text-[12.5px] text-text-2">
          This consumer holds no elevated binding grant. It may execute no <code>plsql</code> or{' '}
          <code>function</code> binding, whatever its roles include.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((grant) => (
            <li
              key={`${grant.bindingType}:${grant.approvalRef}:${grant.names.join(',')}`}
              data-testid="grant-row"
              data-binding-type={grant.bindingType}
              data-expiry-state={grant.expiry.state}
              data-expiry-token={grant.expiry.token}
              className="rounded-lg border border-line bg-surface p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-[12.5px] text-text-1">{grant.bindingType}</span>
                <StatusChip entry={expiryEntry(grant.expiry)} />
              </div>

              {grant.names.length === 0 ? null : (
                <p data-testid="grant-names" className="mt-1 font-mono text-[12px] text-text-2">
                  {grant.names.join(' · ')}
                </p>
              )}

              <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12px]">
                <dt className="text-text-2">Approver</dt>
                <dd data-testid="grant-approver" className="text-text-1">
                  {grant.approver === '' ? 'not named — this grant authorizes nothing' : grant.approver}
                </dd>
                <dt className="text-text-2">Approval record</dt>
                <dd data-testid="grant-approval-ref" className="font-mono text-text-1">
                  {grant.approvalRef === '' ? 'none' : grant.approvalRef}
                </dd>
                <dt className="text-text-2">Expires</dt>
                <dd data-testid="grant-expires-at" className="font-mono text-text-1">
                  {grant.expiresAt === '' ? 'no date recorded' : grant.expiresAt}
                </dd>
              </dl>

              <div
                data-testid="grant-standing"
                data-standing-status={grant.standing?.status ?? 'none'}
                data-standing-token={grant.standing?.expiry.token ?? 'none'}
                className="mt-2 border-t border-line pt-2"
              >
                <p className="text-[12px] font-semibold text-text-1">Standing authorization</p>
                {grant.standing === null ? (
                  <p className="mt-1 text-[12px] text-text-2">
                    None. Every write through this binding needs a per-call human approval.
                  </p>
                ) : (
                  <>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] text-text-1">
                        {grant.standing.ref}
                      </span>
                      <StatusChip entry={expiryEntry(grant.standing.expiry)} />
                    </div>
                    <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12px]">
                      <dt className="text-text-2">Approver</dt>
                      <dd data-testid="standing-approver" className="text-text-1">
                        {grant.standing.approver === '' ? 'not named' : grant.standing.approver}
                      </dd>
                      <dt className="text-text-2">Record expires</dt>
                      <dd data-testid="standing-expires-at" className="font-mono text-text-1">
                        {grant.standing.expiresAt === ''
                          ? 'no date recorded'
                          : grant.standing.expiresAt}
                      </dd>
                      <dt className="text-text-2">State</dt>
                      <dd data-testid="standing-status" className="text-text-1">
                        {grant.standing.status}
                      </dd>
                    </dl>
                    <p className="mt-1 max-w-[80ch] text-[12px] text-text-2">
                      {STANDING_STATUS_COPY[grant.standing.status] ??
                        'Not in force. Every write reverts to a per-call human approval.'}
                    </p>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
