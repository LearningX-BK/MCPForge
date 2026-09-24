// MCPForge — W0-J16: `/activity/calls/[callId]` — call detail (03 §5.3
// "Activity"). "the full record rendered legibly: the plan text as it was
// shown, the args (redacted per sensitivity, with redacted values shown as
// their sha256[:12]), the confirm-token binding, the approval record if
// any, the identity-honesty block, the result keys, the reversal state, and
// the hash-chain position. **The reversal action lives here.**"
import { notFound } from 'next/navigation';

import { StatusChip } from '../../../../components/chips';
import { IdentityBlock, ResultKeyChip, ReversalAction } from '../../../../components/write-path';
import type { ProbeIdentityView, ReversalPlanView } from '../../../../components/write-path';
import { CALL_OUTCOME, CALL_PHASE } from '@mcpforge/shared';

import { getActivityCall } from '../../fixtures';
import { RedactedArg } from '../../redacted-arg';
import type { ActivityCallDetail } from '../../types';

function shortHash(hash: string | undefined): string {
  if (!hash) return '—';
  return hash.length > 20 ? `${hash.slice(0, 20)}…` : hash;
}

function buildIdentity(detail: ActivityCallDetail): ProbeIdentityView | undefined {
  if (!detail.identityProbeRef) return undefined;
  return {
    subject: detail.callerSubject,
    displayName: detail.callerDisplay,
    bindingType: (detail.identityBindingType ?? detail.bindingType ?? 'plsql') as never,
    carries:
      detail.identityCarrying === true ? 'verified' : detail.identityCarrying === false ? 'no' : 'unverified',
    probeRef: detail.identityProbeRef,
    probedAt: detail.identityProbedAt,
    compensatingControl: detail.compensatingControl ?? undefined,
  };
}

/** Builds the reversal's own plan → confirm inputs. `ReversalAction` will not
 * fire without one — see `reversal-action.tsx`'s security notes. */
function buildReversalPlan(detail: ActivityCallDetail): ReversalPlanView | undefined {
  if (!detail.reversalToolId || detail.phase !== 'execute') return undefined;
  const identity = buildIdentity(detail);
  if (!identity) return undefined;
  return {
    plan: {
      plan: `This ${detail.reversalToolId} reverses ${detail.id}.`,
      effects: [
        {
          system: detail.targetSystem ?? detail.serverId ?? 'target',
          object: detail.targetObject ?? 'record',
          action: 'reverse',
          reversible: false,
        },
      ],
      warnings: [],
      reversal: { class: 'irreversible', tool: undefined },
    },
    identity,
    locked: { args: {}, argsCanonicalHash: detail.argsHash ?? '' },
    consequence: {
      reversalClass: 'compensating-tool',
      sensitivity: (detail.sensitivityClass ?? 'internal') as never,
      envClass: (detail.targetEnv ?? 'local') as never,
      entityName: detail.targetObject,
    },
  };
}

export default async function ActivityCallDetailPage({
  params,
}: {
  params: Promise<{ callId: string }>;
}) {
  const { callId } = await params;
  const detail = getActivityCall(callId);

  if (!detail) {
    notFound();
  }

  const d = detail as ActivityCallDetail;
  const identity = buildIdentity(d);
  const reversalPlan = buildReversalPlan(d);

  return (
    <main className="flex flex-col gap-6 px-6 py-6">
      <div>
        <p className="text-[11px] tracking-[0.5px] text-text-2 uppercase">Call</p>
        <h1 className="mb-1 flex items-center gap-2 font-mono text-lg text-text-1">
          {d.id}
          <StatusChip entry={CALL_PHASE[d.phase]} />
          <StatusChip entry={CALL_OUTCOME[d.outcome]} />
        </h1>
        <p className="text-[13px] text-text-2">
          {d.toolId} {d.toolVersion} — {new Date(d.ts).toLocaleString()} — by{' '}
          {d.callerDisplay ?? d.callerSubject}
        </p>
      </div>

      {/* Plan as shown — never re-derived. */}
      {d.planAsShown ? (
        <section data-testid="plan-as-shown" aria-label="Plan, as shown">
          <h2 className="mb-1 text-[11px]/[1.4] font-semibold tracking-[0.5px] text-text-2 uppercase">
            Plan — as shown
          </h2>
          <p className="rounded-md bg-inset px-3 py-2 text-[13.5px]/[1.55] text-text-1">
            {d.planAsShown}
          </p>
        </section>
      ) : null}

      {/* Args, with redaction. */}
      <section data-testid="call-args" aria-label="Arguments">
        <h2 className="mb-1 text-[11px]/[1.4] font-semibold tracking-[0.5px] text-text-2 uppercase">
          Arguments
        </h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 rounded-md bg-inset px-3 py-2 text-[12.5px]/[1.5]">
          {d.args.map((arg) => (
            <div key={arg.field} className="contents">
              <dt className="font-mono text-[11.5px]/[1.45] text-text-2">{arg.field}</dt>
              <dd>
                <RedactedArg entry={arg} />
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Confirm-token binding. */}
      <section data-testid="confirm-token-binding" aria-label="Confirm-token binding">
        <h2 className="mb-1 text-[11px]/[1.4] font-semibold tracking-[0.5px] text-text-2 uppercase">
          Confirm-token binding
        </h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12.5px]/[1.5]">
          <dt className="text-text-2">Plan hash</dt>
          <dd className="font-mono text-[11.5px]/[1.45] text-text-1">{shortHash(d.planHash)}</dd>
          <dt className="text-text-2">Args hash</dt>
          <dd className="font-mono text-[11.5px]/[1.45] text-text-1">{shortHash(d.argsHash)}</dd>
          <dt className="text-text-2">Confirm-token hash</dt>
          <dd className="font-mono text-[11.5px]/[1.45] text-text-1">{shortHash(d.confirmTokenHash)}</dd>
          {d.idempotencyKey ? (
            <>
              <dt className="text-text-2">Idempotency key</dt>
              <dd className="font-mono text-[11.5px]/[1.45] text-text-1">{d.idempotencyKey}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {/* Approval record. */}
      {d.approval ? (
        <section data-testid="approval-record" aria-label="Approval record">
          <h2 className="mb-1 text-[11px]/[1.4] font-semibold tracking-[0.5px] text-text-2 uppercase">
            Approval
          </h2>
          <p className="text-[13.5px]/[1.55] text-text-1">
            {d.approval.href ? (
              <a href={d.approval.href} className="font-mono underline underline-offset-2">
                {d.approval.approvalId}
              </a>
            ) : (
              d.approval.approvalId
            )}
            {' — '}
            {d.approval.state}
            {d.approval.decidedBy ? ` by ${d.approval.decidedBy}` : ''}
          </p>
        </section>
      ) : null}

      {/* Identity-honesty block, reused from write-path. */}
      {identity ? <IdentityBlock identity={identity} /> : (
        <p className="text-[12.5px]/[1.5] text-text-2">
          No probe report is attached to this call — identity carriage is not asserted.
        </p>
      )}

      {/* Result keys, first-class. */}
      {d.resultKeys.length > 0 ? (
        <section data-testid="call-result-keys" aria-label="Result keys">
          <h2 className="mb-1 text-[11px]/[1.4] font-semibold tracking-[0.5px] text-text-2 uppercase">
            Result keys
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {d.resultKeys.map((key) => (
              <ResultKeyChip
                key={key.keyName}
                resultKey={{
                  name: key.keyName,
                  value: key.keyValue,
                  searchHref: `/activity?q=${encodeURIComponent(key.keyValue)}`,
                }}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Hash-chain position. */}
      <section data-testid="call-chain-position" aria-label="Hash-chain position">
        <h2 className="mb-1 text-[11px]/[1.4] font-semibold tracking-[0.5px] text-text-2 uppercase">
          Hash-chain position
        </h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12.5px]/[1.5]">
          {d.chainPosition !== undefined ? (
            <>
              <dt className="text-text-2">Position</dt>
              <dd className="text-text-1">{d.chainPosition}</dd>
            </>
          ) : null}
          <dt className="text-text-2">prev_hash</dt>
          <dd className="font-mono text-[11.5px]/[1.45] text-text-1">{shortHash(d.prevHash)}</dd>
          <dt className="text-text-2">row_hash</dt>
          <dd className="font-mono text-[11.5px]/[1.45] text-text-1">{shortHash(d.rowHash)}</dd>
        </dl>
      </section>

      {/* The reversal action, on the call it applies to. */}
      {d.phase === 'execute' ? (
        <ReversalAction
          originalCallId={d.id}
          reversal={{
            class: (d.reversalClass ?? 'irreversible') as never,
            tool: d.reversalToolId,
            windowHours: 720,
            windowEndsAt: new Date(new Date(d.ts).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          }}
          reversalPlan={reversalPlan}
          links={{
            reversesCallId: d.reversesCallId,
            reversedByCallId: d.reversedByCallId,
            reversedByCallHref: d.reversedByCallId ? `/activity/calls/${d.reversedByCallId}` : undefined,
            reversesCallHref: d.reversesCallId ? `/activity/calls/${d.reversesCallId}` : undefined,
          }}
        />
      ) : null}
    </main>
  );
}
