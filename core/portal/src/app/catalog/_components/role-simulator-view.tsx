// MCPForge — W0-J13: the role simulator UI (03 §10.4's last paragraph).
'use client';

import * as React from 'react';
import { cn } from 'cn';

import { simulateRole, META_TOOLS_RESIDENT_TOKENS } from '../role-simulator';
import type { CatalogData, ToolManifest } from '../types';

export interface RoleSimulatorViewProps {
  data: CatalogData;
  manifestsById: ReadonlyMap<string, ToolManifest>;
  className?: string;
}

export function RoleSimulatorView({ data, manifestsById, className }: RoleSimulatorViewProps) {
  const [roleId, setRoleId] = React.useState(data.roles[0]?.id ?? '');
  const sim = roleId ? simulateRole(data, roleId, manifestsById) : null;

  return (
    <div data-testid="role-simulator" className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center gap-2">
        <label htmlFor="role-simulator-select" className="text-xs font-medium text-text-2">
          Role
        </label>
        <select
          id="role-simulator-select"
          data-testid="role-simulator-select"
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          className="rounded-md border border-line bg-surface px-2 py-1 text-[13px] text-text-1"
        >
          {data.roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.label}
            </option>
          ))}
        </select>
      </div>

      {sim ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text-2">
              {sim.tools.length} resident tools + the four always-resident meta-tools (~{META_TOOLS_RESIDENT_TOKENS} tokens)
            </span>
            <span
              data-testid="role-simulator-total"
              className={cn(
                'rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums',
                sim.withinBudget
                  ? 'border-status-ok-border bg-status-ok-bg text-status-ok-strong'
                  : 'border-status-danger-border bg-status-danger-bg text-status-danger-strong',
              )}
            >
              {sim.totalTokens} / {sim.budget} tokens
            </span>
          </div>

          <table className="w-full text-[13px]">
            <caption className="sr-only">The tools/list this role would receive</caption>
            <thead>
              <tr className="border-b border-line text-left text-text-2">
                <th className="py-1 pr-2 font-medium">Tool</th>
                <th className="py-1 font-medium">Resident tokens</th>
              </tr>
            </thead>
            <tbody>
              {sim.tools.map((t) => (
                <tr key={t.toolId} className="border-b border-line last:border-0">
                  <td className="py-1 pr-2 font-mono">{t.toolId}</td>
                  <td className={cn('py-1 tabular-nums', t.overResidentHard && 'text-status-danger-strong')}>{t.tokens}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {sim.needsDemotion.length > 0 ? (
            <div className="rounded-md border border-status-danger-border bg-status-danger-bg p-2 text-[13px] text-status-danger-strong">
              Over the 400-token hard cap and named for demotion from `coreTools`: {sim.needsDemotion.map((t) => t.toolId).join(', ')}.
            </div>
          ) : null}
          {!sim.withinBudget ? (
            <div className="rounded-md border border-status-danger-border bg-status-danger-bg p-2 text-[13px] text-status-danger-strong">
              This role exceeds the 1,300-token role budget by {sim.totalTokens - sim.budget} tokens.
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-[13px] text-text-2">No role selected.</p>
      )}
    </div>
  );
}
