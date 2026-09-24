'use client';

// MCPForge — W0-N12: 03 §16.2's registered-consumer table.
//
// "id, label, class, owner, steward, status, expiry, credential age, next
// rotation due." Nine columns, all nine present, none folded into a details
// expander: this is the one place a governance owner can see who is connected.
//
// `status` is the EFFECTIVE status (`effectiveStatus`, the gateway's own
// fail-closed reduction), with the authored `status:` shown beside it when the
// two differ — an `active` record past its `expiresAt` is `expired`, and a
// table that showed only the authored word would tell an owner a dead
// registration is live.
//
// Rotation urgency reuses the SAME 30-day threshold and the SAME semantic
// tokens as the grant panel, through `_lib/authorization-view.ts` — one rule
// for "close to expiry" across this tab rather than two.
import * as React from 'react';
import { cn } from 'cn';

import type { StatusEntry } from '@mcpforge/shared';
import { StatusChip } from '@/components/chips';

import { EXPIRY_WARNING_DAYS } from '../_lib/authorization-view';
import type { ConsumerRowView } from '../types';

/**
 * `ConsumerStatusChip`, per 03 §16.5 — active / suspended / expired / retired,
 * a visible label plus an accessible name that expands it, and NO new colour
 * token (`--status-ok` / `--status-write` / `--status-danger` /
 * `--status-neutral` only).
 *
 * DISCLOSED IMPLEMENTATION NOTE (CLAUDE.md §8, "the spec is silent on a small
 * implementation detail"): 03 §16.5 says this chip is "driven by `status.ts`",
 * and the canonical home for these four entries is
 * `core/shared/src/status.ts` beside `PROBE_STATUS` and `CHANGE_STATE`.
 * `W0-N12`'s declared `touches:` is `core/portal/src/app/governance/consumers/**`,
 * which excludes that shared file — so the entries live here, typed as
 * `status.ts`'s own `StatusEntry` and using only its six semantic tokens, and
 * moving them into `status.ts` (so `forge`'s human mode renders the same words)
 * is a named follow-up, not a second vocabulary.
 */
export const CONSUMER_STATUS_ENTRIES: Readonly<Record<string, StatusEntry>> = {
  active: {
    token: 'status-ok',
    label: 'Active',
    srLabel: 'Consumer status: active. This registration is in force.',
    icon: 'CircleCheck',
  },
  suspended: {
    token: 'status-danger',
    label: 'Suspended',
    srLabel:
      'Consumer status: suspended. Sessions are refused at establishment and no tools list is served.',
    icon: 'ShieldOff',
  },
  expired: {
    token: 'status-danger',
    label: 'Expired',
    srLabel:
      'Consumer status: expired. The registration passed its expiry date; renewal is a re-approval, not a no-op.',
    icon: 'CalendarX',
  },
  retired: {
    token: 'status-neutral',
    label: 'Retired',
    srLabel: 'Consumer status: retired. The id is permanently withdrawn and is never reused.',
    icon: 'Archive',
  },
};

function statusEntry(effectiveStatus: string): StatusEntry {
  return (
    CONSUMER_STATUS_ENTRIES[effectiveStatus] ?? {
      token: 'status-neutral',
      label: effectiveStatus === '' ? 'Unknown' : effectiveStatus,
      srLabel: `Consumer status: ${effectiveStatus === '' ? 'unknown' : effectiveStatus}. It is not one of the four recorded states, so it authorizes nothing.`,
      icon: 'CircleHelp',
    }
  );
}

/** Rotation urgency, on the same ladder as grant expiry. */
function rotationClass(dueInDays: number | null): string {
  if (dueInDays === null) return 'text-text-2';
  if (dueInDays < 0) return 'text-status-danger-strong';
  if (dueInDays <= EXPIRY_WARNING_DAYS) return 'text-status-write-strong';
  return 'text-text-1';
}

export interface RegistryTableProps {
  rows: readonly ConsumerRowView[];
  failures?: readonly ConsumerRowView[];
  selectedId?: string | undefined;
  onSelect?: ((consumerId: string) => void) | undefined;
}

export function RegistryTable({ rows, failures = [], selectedId, onSelect }: RegistryTableProps) {
  return (
    <section aria-labelledby="consumer-registry-heading" className="flex flex-col gap-2">
      <h2 id="consumer-registry-heading" className="font-display text-base text-text-1">
        Registered consumers
      </h2>

      {rows.length === 0 && failures.length === 0 ? (
        <p data-testid="registry-empty" className="max-w-[80ch] text-[12.5px] text-text-2">
          No consumer is registered in <code>consumers/</code>. Until one is, every session is
          refused with <code>CONSUMER_UNREGISTERED</code> — there is no unregistered path and
          Dynamic Client Registration does not exist here. Register one below; it reaches git as a
          change proposal with an approval record, like every other grant.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table data-testid="registry-table" className="w-full text-left text-[12.5px]">
            <thead className="border-b border-line text-text-2">
              <tr>
                <th scope="col" className="px-3 py-2">Id</th>
                <th scope="col" className="px-3 py-2">Label</th>
                <th scope="col" className="px-3 py-2">Class</th>
                <th scope="col" className="px-3 py-2">Owner</th>
                <th scope="col" className="px-3 py-2">Steward</th>
                <th scope="col" className="px-3 py-2">Status</th>
                <th scope="col" className="px-3 py-2">Registration expires</th>
                <th scope="col" className="px-3 py-2">Credential age</th>
                <th scope="col" className="px-3 py-2">Next rotation due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.consumerId}
                  data-testid="registry-row"
                  data-consumer-id={row.consumerId}
                  aria-current={selectedId === row.consumerId ? 'true' : undefined}
                  className={cn(
                    'border-b border-line last:border-b-0',
                    selectedId === row.consumerId ? 'bg-accent-tint' : undefined,
                  )}
                >
                  <td className="px-3 py-2 font-mono text-text-1">
                    {onSelect === undefined ? (
                      row.consumerId
                    ) : (
                      <button
                        type="button"
                        data-testid={`registry-select-${row.consumerId}`}
                        className="text-accent underline"
                        onClick={() => onSelect(row.consumerId)}
                      >
                        {row.consumerId}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-1">{row.label}</td>
                  <td className="px-3 py-2 font-mono text-text-2">{row.consumerClass}</td>
                  <td className="px-3 py-2 text-text-2">{row.owner}</td>
                  <td className="px-3 py-2 text-text-2">{row.steward}</td>
                  <td className="px-3 py-2">
                    <StatusChip entry={statusEntry(row.effectiveStatus)} />
                    {row.status !== row.effectiveStatus ? (
                      <span
                        data-testid={`registry-authored-status-${row.consumerId}`}
                        className="mt-1 block text-[11.5px] text-text-2"
                      >
                        record says <span className="font-mono">{row.status}</span>
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-text-1">{row.expiresAt}</td>
                  <td className="px-3 py-2 font-mono text-text-2">
                    {row.credentialAgeDays === null ? 'unknown' : `${row.credentialAgeDays} days`}
                  </td>
                  <td
                    data-testid={`registry-rotation-${row.consumerId}`}
                    className={cn('px-3 py-2 font-mono', rotationClass(row.rotationDueInDays))}
                  >
                    {row.nextRotationDue === null ? 'unknown' : row.nextRotationDue}
                    {row.rotationDueInDays !== null && row.rotationDueInDays < 0
                      ? ` (overdue by ${-row.rotationDueInDays} days)`
                      : ''}
                  </td>
                </tr>
              ))}
              {failures.map((row) => (
                <tr
                  key={`failure:${row.consumerId}`}
                  data-testid="registry-load-failure"
                  className="border-b border-line last:border-b-0"
                >
                  <td className="px-3 py-2 font-mono text-status-danger-strong">
                    {row.consumerId}
                  </td>
                  <td colSpan={8} className="px-3 py-2 text-status-danger-strong">
                    Unreadable registration — the gateway authenticates no session against it.{' '}
                    {row.loadError}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
