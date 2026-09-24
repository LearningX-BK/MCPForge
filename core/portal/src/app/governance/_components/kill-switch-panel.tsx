'use client';

// MCPForge — W0-J18: the kill-switch tab (03 §5.3 "Governance" item 4, §7.6).
//
// FIVE granularities, not four. 03 §5.3 was written before Phase 5 added
// `consumer` (02 §11.2, CLAUDE.md §3), and `KILL_SCOPES` — the closed set the
// gateway itself enforces and `forge kill` parses — is the authority. This
// component reads that constant rather than listing scopes of its own, so a
// sixth granularity would appear here without anyone editing this file, and a
// scope that is removed cannot linger in the UI.
//
// TYPE-TO-CONFIRM ON DEPLOYMENT-WIDE ACTIONS, reusing W0-J8's `ConfirmAction`
// rather than growing a second high-friction confirmation:
//   - the friction is DERIVED, never passed — `ConfirmActionProps` has no
//     `variant` prop, so this surface cannot dial a deployment-wide kill down
//     to a plain button;
//   - `ConsequenceView.deploymentId` is 03 §7.3's fourth row verbatim
//     ("Deployment-wide actions (kill switch) → type-to-confirm (deployment
//     id)") and is set here for, and only for, `scope: 'deployment'`;
//   - the word typed is the deployment id.
// A reason is required for every kill at every granularity: `forge kill` takes
// `--reason` and writes it into the audit record and into the `TOOL_DISABLED`
// message a caller sees, so a UI that let one through empty would produce a
// refusal nobody can act on.
import * as React from 'react';

import { KILL_SCOPES, type KillScope } from '@mcpforge/gateway/scope';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmAction, type ConsequenceView } from '@/components/write-path';

import type { KillFlagRowView } from '../types';

/** What a kill request carries. Mirrors `ApplyKillInput`'s caller-supplied half. */
export interface KillRequest {
  readonly scope: KillScope;
  readonly target: string;
  readonly reason: string;
}

export interface KillSwitchPanelProps {
  flags: readonly KillFlagRowView[];
  deploymentId: string;
  envClass: ConsequenceView['envClass'];
  onKill?: ((request: KillRequest) => void | Promise<void>) | undefined;
}

const SCOPE_LABEL: Readonly<Record<KillScope, string>> = {
  tool: 'Tool',
  moduleServer: 'Module server',
  bindingType: 'Binding type',
  consumer: 'Consumer',
  deployment: 'Whole deployment',
};

const SCOPE_HINT: Readonly<Record<KillScope, string>> = {
  tool: 'One tool id, e.g. jde.ap.voucher.create.',
  moduleServer: 'One module server id — every tool it serves stops.',
  bindingType: 'One binding type — every tool executing through it stops.',
  consumer: 'One registered consumer — its sessions are refused CONSUMER_UNREGISTERED.',
  deployment: 'Everything. Every tool, every consumer, this whole deployment.',
};

export function KillSwitchPanel({ flags, deploymentId, envClass, onKill }: KillSwitchPanelProps) {
  const [scope, setScope] = React.useState<KillScope>('tool');
  const [target, setTarget] = React.useState('');
  const [reason, setReason] = React.useState('');

  const deploymentWide = scope === 'deployment';
  const effectiveTarget = deploymentWide ? deploymentId : target.trim();
  const ready = effectiveTarget !== '' && reason.trim() !== '';

  // 03 §7.3's facts, not a friction level. A kill is not reversible by a
  // reversing call — it is undone by removing the flag — so `compensating-tool`
  // would overstate it; the deployment row is what forces type-to-confirm here.
  const consequence: ConsequenceView = {
    reversalClass: 'compensating-tool',
    sensitivity: 'internal',
    envClass,
    entityName: effectiveTarget === '' ? undefined : effectiveTarget,
    ...(deploymentWide ? { deploymentId } : {}),
  };

  function fire() {
    if (!ready) return;
    void onKill?.({ scope, target: effectiveTarget, reason: reason.trim() });
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="kill-active-heading" className="flex flex-col gap-2">
        <h2 id="kill-active-heading" className="font-display text-lg text-text-1">
          Flags in force
        </h2>
        {flags.length === 0 ? (
          <p data-testid="kill-empty" className="text-[12.5px] text-text-2">
            Nothing is killed in this deployment.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table data-testid="kill-flag-table" className="w-full text-left text-[12.5px]">
              <thead className="border-b border-line text-text-2">
                <tr>
                  <th scope="col" className="px-3 py-2">Granularity</th>
                  <th scope="col" className="px-3 py-2">Target</th>
                  <th scope="col" className="px-3 py-2">Reason</th>
                  <th scope="col" className="px-3 py-2">Expires</th>
                  <th scope="col" className="px-3 py-2">Set by</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((f) => (
                  <tr key={f.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 text-text-1">{SCOPE_LABEL[f.scope]}</td>
                    <td className="px-3 py-2 font-mono text-text-1">{f.target}</td>
                    <td className="px-3 py-2 text-text-2">{f.reason}</td>
                    <td className="px-3 py-2 text-text-2">{f.until ?? 'indefinite'}</td>
                    <td className="px-3 py-2 font-mono text-text-2">
                      {f.createdBy}
                      <span className="block text-[11.5px]">{f.createdAt}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="kill-set-heading" className="flex flex-col gap-3">
        <h2 id="kill-set-heading" className="font-display text-lg text-text-1">
          Set a kill flag
        </h2>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[12.5px] font-semibold text-text-1">Granularity</legend>
          <div className="flex flex-wrap gap-3">
            {KILL_SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-2 text-[12.5px] text-text-1">
                <input
                  type="radio"
                  name="kill-scope"
                  value={s}
                  checked={scope === s}
                  onChange={() => setScope(s)}
                  data-testid={`kill-scope-${s}`}
                />
                {SCOPE_LABEL[s]}
              </label>
            ))}
          </div>
          <p data-testid="kill-scope-hint" className="text-[12px] text-text-2">
            {SCOPE_HINT[scope]}
          </p>
        </fieldset>

        {deploymentWide ? (
          <p data-testid="kill-deployment-target" className="text-[12.5px] text-text-1">
            Target: <span className="font-mono">{deploymentId}</span>
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <Label htmlFor="kill-target">Target</Label>
            <Input
              id="kill-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="id"
              className="max-w-[42ch] font-mono"
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <Label htmlFor="kill-reason">Reason (required — it is shown to every refused caller)</Label>
          <Input
            id="kill-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="max-w-[70ch]"
          />
        </div>

        {deploymentWide ? (
          <div data-testid="kill-deployment-confirm">
            <ConfirmAction
              consequence={consequence}
              label="Kill this deployment"
              onConfirm={fire}
              disabled={!ready}
              disabledReason={
                ready ? undefined : 'Name a reason before killing the whole deployment.'
              }
            />
          </div>
        ) : (
          <div>
            <Button
              type="button"
              variant="destructive"
              disabled={!ready}
              onClick={fire}
              data-testid="kill-scoped-confirm"
            >
              Kill {SCOPE_LABEL[scope].toLowerCase()}
            </Button>
            {ready ? null : (
              <p className="mt-1 text-[12px] text-text-2">
                Name a target and a reason. Both are written to the audit record.
              </p>
            )}
          </div>
        )}

        <p className="max-w-[80ch] text-[12px] text-text-2">
          Every kill and un-kill writes an immutable audit record naming its author and reason. A
          kill takes effect without a redeploy and is undone by removing the flag, not by a
          reversing call.
        </p>
      </section>
    </div>
  );
}
