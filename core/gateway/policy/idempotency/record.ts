// MCPForge — the audit row for every call that did NOT execute a binding.
// W0-P17, 02 §4.6.
//
// "Every call (plan, execute, refusal, replay) leaves an audit row." The two
// dispatchers write the rows for calls that reached a binding. This writes the
// rest, through the same repository and the same row builder:
//
//   chain `refused`             -> phase `reject`,  outcome `policy_denied`,
//                                  `denied_by_rule` = the refusing stage
//   chain `responded` at 6g     -> phase `plan`     (a plan, or an approval
//                                  hand-off: 02 §4.6's abandoned-intent query
//                                  reads exactly these)
//   chain `responded` at 6h     -> phase `execute`, `replayed: true`
//   write dispatch `replayed`   -> phase `execute`, `replayed: true`
//   write dispatch `refused`    -> `reject` for a refusal that never reached
//                                  the target; `execute` with a binding
//                                  outcome for one that did (TARGET_ERROR)

import { extractResultKeys } from '../../reversal/result-keys.js';
import type { AuditRepository } from '../../store/audit/types.js';
import type { PolicyDecision } from '../chain.js';
import { argsCanonicalHash, businessArgs } from '../confirm/hash.js';
import type { PolicyCall, PolicyCatalogueEntry, PolicyContext } from '../types.js';
import { auditRowBase, confirmTokenHash } from './audit-row.js';
import { bindingOutcomeFor } from './read.js';
import type { WriteDispatchOutcome } from './types.js';

export interface DecisionRecorderDeps {
  readonly audit: Pick<AuditRepository, 'append'>;
  now?(): Date;
  readonly gatewayVersion?: string;
}

export interface DecisionRecorder {
  /** A chain decision that ended the call: `refused` or `responded`. Returns the row id. */
  recordDecision(input: {
    readonly call: PolicyCall;
    readonly ctx: PolicyContext;
    readonly decision: Exclude<PolicyDecision, { readonly outcome: 'proceed' }>;
    /** Overrides `stage <id>` when the refusal came from after the chain. */
    readonly deniedByRule?: string;
  }): Promise<string>;
  /** A write dispatch that did not execute: `replayed` or `refused`. Returns the row id. */
  recordWriteDispatch(input: {
    readonly call: PolicyCall;
    readonly entry: PolicyCatalogueEntry;
    readonly ctx: PolicyContext;
    readonly outcome: Exclude<WriteDispatchOutcome, { readonly kind: 'executed' }>;
  }): Promise<string>;
}

/** Refusals raised before anything was sent to the target. */
const NEVER_SENT = new Set(['PLAN_EXPIRED', 'RATE_LIMITED']);

export function decisionRecorder(deps: DecisionRecorderDeps): DecisionRecorder {
  const ts = (ctx: PolicyContext): string => (deps.now?.() ?? ctx.scope.now).toISOString();
  const version = deps.gatewayVersion === undefined ? {} : { gatewayVersion: deps.gatewayVersion };

  return {
    async recordDecision({ call, ctx, decision, deniedByRule }) {
      const entry = ctx.catalogue.find((e) => e.toolId === call.toolId);
      const common = { call, entry, ctx, businessArgs: businessArgs(call.args), ...version };

      if (decision.outcome === 'refused') {
        const row = await deps.audit.append({
          ...auditRowBase({ ...common, phase: 'reject', outcome: 'policy_denied', ts: ts(ctx) }),
          argsHash: argsCanonicalHash(call.args),
          errorCode: decision.error.code,
          errorMessageAgent: decision.error.message,
          deniedByRule: deniedByRule ?? `stage ${decision.stage}`,
        });
        return row.id;
      }

      const response = decision.response;
      if (decision.stage === '6h') {
        const row = await deps.audit.append({
          ...auditRowBase({
            ...common,
            phase: 'execute',
            outcome: 'ok',
            ts: ts(ctx),
            resultKeys: extractResultKeys(response, entry?.resultKeys ?? []),
          }),
          argsHash: argsCanonicalHash(call.args),
          replayed: true,
        });
        return row.id;
      }

      const token = response['confirmToken'];
      const row = await deps.audit.append({
        ...auditRowBase({ ...common, phase: 'plan', outcome: 'ok', ts: ts(ctx) }),
        argsHash: argsCanonicalHash(call.args),
        ...(typeof token === 'string' ? { confirmTokenHash: confirmTokenHash(token) } : {}),
      });
      return row.id;
    },

    async recordWriteDispatch({ call, entry, ctx, outcome }) {
      const common = { call, entry, ctx, businessArgs: businessArgs(call.args), ...version };
      const token = call.args['confirm'];
      const tokenHash =
        typeof token === 'string' ? { confirmTokenHash: confirmTokenHash(token) } : {};

      if (outcome.kind === 'replayed') {
        const row = await deps.audit.append({
          ...auditRowBase({
            ...common,
            phase: 'execute',
            outcome: 'ok',
            ts: ts(ctx),
            resultKeys: extractResultKeys(outcome.response, entry.resultKeys ?? []),
          }),
          ...tokenHash,
          argsHash: argsCanonicalHash(call.args),
          replayed: true,
        });
        return row.id;
      }

      const neverSent = NEVER_SENT.has(outcome.code);
      const row = await deps.audit.append({
        ...auditRowBase({
          ...common,
          phase: neverSent ? 'reject' : 'execute',
          outcome: neverSent ? 'policy_denied' : bindingOutcomeFor(outcome.code),
          ts: ts(ctx),
        }),
        ...tokenHash,
        argsHash: argsCanonicalHash(call.args),
        errorCode: outcome.code,
        errorMessageAgent: outcome.message,
        ...(neverSent ? { deniedByRule: 'write-dispatch' } : {}),
      });
      return row.id;
    },
  };
}
