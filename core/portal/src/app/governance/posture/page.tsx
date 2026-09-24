// MCPForge — W0-J18: `/governance/posture` (03 §5.3 "Governance" item 3).
//
// Identity carriage on this page comes from the PROBE and from nowhere else
// (CLAUDE.md non-negotiable #2). When no probe has run, every row says so — it
// does not fall back to what the manifests claim, because a manifest cannot
// assert `verified` and the portal must not assert it on a manifest's behalf.
import * as React from 'react';

import { GovNav } from '../_components/gov-nav';
import { BindingChip } from '@/components/chips';
import { POSTURE_CAPTION, loadPostureRows } from '../_lib/posture';

export default function GovernancePosturePage(): React.ReactElement {
  const rows = loadPostureRows();
  const probed = rows.filter((r) => r.probeReference !== null);

  return (
    <main className="flex flex-col gap-6 px-6 py-6">
      <div>
        <h1 className="mb-1 font-display text-xl text-text-1">Governance</h1>
        <p className="max-w-[80ch] text-[13px] text-text-2">
          What actually enforces access in each target — as the capability probe observed it, not
          as a manifest claims it.
        </p>
      </div>

      <GovNav />

      {probed.length === 0 ? (
        <div
          data-testid="posture-unprobed"
          className="rounded-lg border border-status-write-border bg-status-write-bg p-3"
        >
          <p className="text-[12.5px] font-semibold text-status-write-strong">
            No capability probe has reported in this deployment, so no application is marked
            identity-carrying.
          </p>
          <p className="mt-1 text-[12px] text-text-1">
            Run <code>forge probe</code> against a real instance. Until it reports,{' '}
            <code>identity.carries</code> stays unestablished — only the probe may ever write{' '}
            <code>verified</code>.
          </p>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table data-testid="posture-table" className="w-full text-left text-[12.5px]">
          <thead className="border-b border-line text-text-2">
            <tr>
              <th scope="col" className="px-3 py-2">Application</th>
              <th scope="col" className="px-3 py-2">Binding types in play</th>
              <th scope="col" className="px-3 py-2">Identity carried (probe)</th>
              <th scope="col" className="px-3 py-2">What enforces access</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.application}
                data-testid={`posture-row-${row.application}`}
                data-exception={row.exception ? 'true' : 'false'}
                className={
                  row.exception
                    ? 'border-b border-status-danger-border bg-status-danger-bg last:border-b-0'
                    : 'border-b border-line last:border-b-0'
                }
              >
                <th scope="row" className="px-3 py-2 text-left font-mono font-normal text-text-1">
                  {row.application}
                  {row.exception ? (
                    <span
                      data-testid="posture-exception-flag"
                      className="ml-2 rounded-full border border-status-danger-border px-2 py-0.5 text-[11.5px] font-semibold text-status-danger-strong"
                    >
                      service-account exception
                    </span>
                  ) : null}
                </th>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {row.bindingTypes.map((t) => (
                      <BindingChip key={t} type={t} />
                    ))}
                  </span>
                </td>
                <td data-testid={`posture-identity-${row.application}`} className="px-3 py-2">
                  {row.probeReference === null ? (
                    <span className="text-text-2">not established by a probe</span>
                  ) : (
                    <>
                      <span className="font-mono text-text-1">{row.identityCarries}</span>
                      <span className="block text-[11.5px] text-text-2">{row.probeReference}</span>
                      {row.nonCarriageDisposition === null ? null : (
                        <span className="block text-[11.5px] text-text-2">
                          disposition applied: {row.nonCarriageDisposition}
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-3 py-2 text-text-2">
                  {row.enforcedBy}
                  <span className="mt-1 block text-[11.5px]">{row.note}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p data-testid="posture-caption" className="max-w-[90ch] text-[12px] text-text-2">
        {POSTURE_CAPTION}
      </p>
    </main>
  );
}
