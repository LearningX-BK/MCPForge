'use client';

// MCPForge — W0-N12: 03 §16.2's four actions, and the one that is not a change
// proposal.
//
//   Register / Rotate credential / Retire  -> change proposals, like every
//                                             other grant in this architecture.
//   Suspend                                -> a KILL-SWITCH act: immediate,
//                                             audited, reason required.
//
// WHY SUSPEND IS SPLIT OUT AND WHY IT IS NOT A PROPOSAL. 03 §16.2: "All produce
// change proposals **except Suspend**, which is a kill-switch act — immediate,
// audited, reason required." The gateway's kill switch has a `consumer`
// granularity for exactly this (CLAUDE.md §3's five granularities;
// `consumers/README.md`: "For an immediate cut-off that needs no merge, the
// kill switch has a consumer granularity"). A definitional `status: suspended`
// edit ALSO exists (`proposeSuspension`) and is the durable record — but it
// merges, and an operator cutting off a compromised client cannot wait for a
// merge. So this panel fires the flag now and says, on screen, that the
// definitional record still needs the proposal.
//
// FRICTION, per 03 §7.3's ladder and §16.2's "Type-to-confirm on Suspend at
// deployment scope and on Retire":
//   * consumer-scope Suspend  -> immediate, gated on a non-empty reason. Not
//     type-to-confirm: 03 §7.3's table reserves that for irreversible and
//     deployment-wide acts, and adding it here would train operators to type
//     through the gesture in the one case where speed is the point.
//   * deployment-scope Suspend -> `ConfirmAction` with `deploymentId` set,
//     which 03 §7.3 row 4 makes type-to-confirm on the deployment id.
//   * Retire -> `ConfirmAction` with `reversalClass: 'irreversible'` and the
//     consumer id as the word to type. Retirement really is irreversible: the
//     id is never reused, because audit rows and consumption edges reference it.
// In every case the friction is DERIVED by `ConfirmAction` from the facts;
// `ConfirmActionProps` has no `variant` prop, so nothing on this surface can
// dial it down.
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmAction, type ConsequenceView } from '@/components/write-path';

/** What a consumer kill request carries. Mirrors `../../_components/kill-switch-panel`'s. */
export interface ConsumerKillRequest {
  /** `consumer` for one registration; `deployment` for the whole deployment. */
  readonly scope: 'consumer' | 'deployment';
  readonly target: string;
  readonly reason: string;
}

export type ConsumerProposalKind = 'retire' | 'rotate-credential';

export interface ConsumerActionsProps {
  consumerId: string;
  deploymentId: string;
  envClass: ConsequenceView['envClass'];
  /** The kill-switch seam. Wave 0 has no gateway client; the integration task supplies it. */
  onKill?: ((request: ConsumerKillRequest) => void | Promise<void>) | undefined;
  /** Stages a change proposal for the definitional acts. */
  onProposeLifecycle?: ((kind: ConsumerProposalKind) => void | Promise<void>) | undefined;
}

export function ConsumerActions({
  consumerId,
  deploymentId,
  envClass,
  onKill,
  onProposeLifecycle,
}: ConsumerActionsProps) {
  const [reason, setReason] = React.useState('');
  const [deploymentWide, setDeploymentWide] = React.useState(false);
  const trimmedReason = reason.trim();
  const reasonGiven = trimmedReason !== '';

  const suspendConsequence: ConsequenceView = {
    // A kill is undone by removing the flag, not by a reversing call, so
    // `compensating-tool` rather than `irreversible` — the same reading
    // `../../_components/kill-switch-panel.tsx` documents.
    reversalClass: 'compensating-tool',
    sensitivity: 'internal',
    envClass,
    entityName: consumerId,
    ...(deploymentWide ? { deploymentId } : {}),
  };

  const retireConsequence: ConsequenceView = {
    reversalClass: 'irreversible',
    sensitivity: 'internal',
    envClass,
    entityName: consumerId,
  };

  function fireKill() {
    if (!reasonGiven) return;
    void onKill?.({
      scope: deploymentWide ? 'deployment' : 'consumer',
      target: deploymentWide ? deploymentId : consumerId,
      reason: trimmedReason,
    });
  }

  return (
    <div className="flex flex-col gap-6" data-testid="consumer-actions">
      <section aria-labelledby="consumer-suspend-heading" className="flex flex-col gap-3">
        <h2 id="consumer-suspend-heading" className="font-display text-base text-text-1">
          Suspend — immediate
        </h2>
        <p className="max-w-[80ch] text-[12px] text-text-2">
          This is a kill switch, not a change proposal. It takes effect without a merge and without
          a redeploy: the consumer&rsquo;s next session is refused and it is served no{' '}
          <code>tools/list</code>. The reason is written into the audit record and shown to the
          refused caller, so it must name something they can act on. Propose the definitional{' '}
          <code>status: suspended</code> edit as well — the flag is the cut-off, the record is the
          history.
        </p>

        <div className="flex flex-col gap-1">
          <Label htmlFor="consumer-kill-reason">
            Reason (required — it is shown to every refused caller)
          </Label>
          <Input
            id="consumer-kill-reason"
            data-testid="consumer-kill-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="max-w-[70ch]"
          />
        </div>

        <label className="flex items-center gap-2 text-[12.5px] text-text-1">
          <input
            type="checkbox"
            data-testid="consumer-kill-deployment-scope"
            checked={deploymentWide}
            onChange={(e) => setDeploymentWide(e.target.checked)}
          />
          Suspend at deployment scope instead — every consumer, every tool, this whole deployment
        </label>

        {deploymentWide ? (
          <div data-testid="consumer-kill-deployment-confirm">
            <ConfirmAction
              consequence={suspendConsequence}
              label="Suspend this deployment"
              onConfirm={fireKill}
              disabled={!reasonGiven}
              disabledReason={
                reasonGiven ? undefined : 'Name a reason before suspending the whole deployment.'
              }
            />
          </div>
        ) : (
          <div>
            <Button
              type="button"
              variant="destructive"
              data-testid="consumer-kill-confirm"
              disabled={!reasonGiven}
              onClick={fireKill}
            >
              Suspend {consumerId}
            </Button>
            {reasonGiven ? null : (
              <p className="mt-1 text-[12px] text-text-2">
                Name a reason. It is written to the audit record and returned to the refused caller.
              </p>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="consumer-lifecycle-heading" className="flex flex-col gap-3">
        <h2 id="consumer-lifecycle-heading" className="font-display text-base text-text-1">
          Rotate credential · Retire — change proposals
        </h2>

        <div className="flex flex-col gap-2">
          <p className="max-w-[80ch] text-[12px] text-text-2">
            Recording a rotation changes the record&rsquo;s schedule, never a value — the credential
            itself is minted by <code>forge consumer issue-credential</code>, printed once, and
            never appears in the record, the artefact, this screen or an audit row.
          </p>
          <div>
            <Button
              type="button"
              variant="secondary"
              data-testid="consumer-rotate"
              onClick={() => void onProposeLifecycle?.('rotate-credential')}
            >
              Propose credential rotation
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="max-w-[80ch] text-[12px] text-text-2">
            Retiring is permanent. The id is never reused, because audit rows and consumption edges
            reference it — renaming a consumer is a retire-and-register pair, both recorded.
          </p>
          <div data-testid="consumer-retire-confirm">
            <ConfirmAction
              consequence={retireConsequence}
              label={`Retire ${consumerId}`}
              onConfirm={() => void onProposeLifecycle?.('retire')}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
