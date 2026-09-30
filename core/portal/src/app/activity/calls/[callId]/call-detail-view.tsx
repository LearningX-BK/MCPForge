// MCPForge — W0-J16: the call detail VIEW for `/activity/calls/[callId]` (03 §5.3
// "Activity"). "the full record rendered legibly: the plan text as it was
// shown, the args (redacted per sensitivity, with redacted values shown as
// their sha256[:12]), the confirm-token binding, the approval record if
// any, the identity-honesty block, the result keys, the reversal state, and
// the hash-chain position. **The reversal action lives here.**"
//
// W0-P3d mounts four more of the write-path family here, each fed only by
// what `/api/v1` and the committed manifest actually hold: `PlanSentence`
// (the plan text as shown, from the approval), `LockedArgs` (a write's
// arguments with the hash its confirm token was bound to), `ReversalContract`
// (class and tool from the audit row, window from the manifest at the call's
// own version) and `ReplayNotice` (a replay names the execution it returned).
import { StatusChip } from '../../../../components/chips';
import {
  IdentityBlock,
  LockedArgs,
  PlanSentence,
  ReplayNotice,
  ResultKeyChip,
  ReversalAction,
  ReversalContract,
} from '../../../../components/write-path';
import type { ProbeIdentityView, ReversalPlanView } from '../../../../components/write-path';
import { CALL_OUTCOME, CALL_PHASE } from '@mcpforge/shared';

import { RedactedArg, redactedAnnouncement } from '../../redacted-arg';
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
      detail.identityCarrying === true
        ? 'verified'
        : detail.identityCarrying === false
          ? 'no'
          : 'unverified',
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

/** Renders one call. Server-safe; fed by the fixtures in tests and by `/api/v1` live. */
export function CallDetailView({ detail }: { readonly detail: ActivityCallDetail }) {
  const d = detail;
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

      {/* A replay returned an earlier execution's result; it made no second change. */}
      {d.replayed === true && d.replayOf !== undefined ? (
        <ReplayNotice
          replay={{
            originalExecutedAt: d.replayOf.ts,
            originalCallId: d.replayOf.callId,
            originalCallHref: `/activity/calls/${encodeURIComponent(d.replayOf.callId)}`,
          }}
        />
      ) : null}

      {/* Plan as shown — never re-derived. */}
      {d.planAsShown ? (
        <section data-testid="plan-as-shown" aria-label="Plan, as shown">
          <h2 className="mb-1 text-[11px]/[1.4] font-semibold tracking-[0.5px] text-text-2 uppercase">
            Plan — as shown
          </h2>
          <PlanSentence plan={d.planAsShown} className="rounded-md bg-inset px-3 py-2" />
        </section>
      ) : null}

      {/* A write's arguments are the ones its confirm token was bound to:
          locked, beside their hash. A redacted value is shown as the same
          announcement the plain list uses, never as a bare hash. Anything
          without a bound hash (a read) keeps the plain list. */}
      {d.isWrite && d.argsHash ? (
        <LockedArgs
          locked={{
            argsCanonicalHash: d.argsHash,
            args: Object.fromEntries(
              d.args.map((arg) => [
                arg.field,
                arg.redacted ? redactedAnnouncement(arg.hash ?? '') : (arg.value ?? null),
              ]),
            ),
          }}
        />
      ) : (
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
      )}

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
          <dd className="font-mono text-[11.5px]/[1.45] text-text-1">
            {shortHash(d.confirmTokenHash)}
          </dd>
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
            {d.approval.selfApproved === true ? (
              <strong data-testid="call-approval-self-approved">
                {' '}
                (self-approved, super admin)
              </strong>
            ) : null}
          </p>
        </section>
      ) : null}

      {/* Identity-honesty block, reused from write-path. */}
      {identity ? (
        <IdentityBlock identity={identity} />
      ) : (
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

      {/* The reversal contract and action, on the call they apply to. Only
          when the page could state the contract (reversal-facts.ts): an
          assumed class or window would be a claim about what can be undone. */}
      {d.reversal !== undefined ? <ReversalContract reversal={d.reversal} /> : null}
      {d.phase === 'execute' && d.isWrite && d.reversal === undefined ? (
        <p data-testid="reversal-unknown" className="text-[12.5px]/[1.5] text-text-2">
          This call records no reversal class, so what can undo it is not stated here. Check the
          tool&apos;s manifest (writeSafety.reversal) before acting on it.
        </p>
      ) : null}
      {d.reversal !== undefined ? (
        <ReversalAction
          originalCallId={d.id}
          reversal={d.reversal}
          reversalPlan={reversalPlan}
          links={{
            reversesCallId: d.reversesCallId,
            reversedByCallId: d.reversedByCallId,
            reversedByCallHref: d.reversedByCallId
              ? `/activity/calls/${d.reversedByCallId}`
              : undefined,
            reversesCallHref: d.reversesCallId ? `/activity/calls/${d.reversesCallId}` : undefined,
          }}
        />
      ) : null}
    </main>
  );
}
