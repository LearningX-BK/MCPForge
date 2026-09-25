// MCPForge — step [7]–[9] for a READ: dispatch, shape, audit. W0-P17.
//
// `writeDispatcher` (./dispatch.ts) is write-only by construction: it refuses a
// call with no confirmed token, and a read has none. Until this task nothing
// wrote an audit row for a read at all. This is that writer, NAMED so it is
// findable: `readDispatcher`. It appends through the same store audit
// repository and the same row builder (./audit-row.ts) as the write path.
//
// THE ORDER: invoke → shape → append → return. The row is appended AFTER
// shaping so it records what the agent actually received (row_count,
// bytes_out) or the refusal it received instead. A read has no side effect to
// be atomic with, so there is no transaction here; a failed append fails the
// call (the agent gets an INTERNAL refusal and no data), because a read
// MCPForge cannot show you happened is a read the audit trail cannot account
// for.

import type { ForgeError } from '@mcpforge/shared/errors';
import { extractResultKeys } from '../../reversal/result-keys.js';
import type { AuditOutcome, AuditRepository } from '../../store/audit/types.js';
import { businessArgs } from '../confirm/hash.js';
import type { PolicyCall, PolicyCatalogueEntry, PolicyContext } from '../types.js';
import { auditRowBase } from './audit-row.js';

/** What the read path's binding executor is handed. */
export interface ReadTargetInvoker {
  invoke(input: {
    readonly call: PolicyCall;
    readonly entry: PolicyCatalogueEntry;
    readonly ctx: PolicyContext;
    readonly executionGrant: string | null;
  }): Promise<unknown>;
}

/**
 * Result shaping (02 §4.2 step [8]) for a read: the row cap and the
 * response-byte cap. Returns the counts to record, or throws the closed-
 * taxonomy refusal (`ROW_CAP_EXCEEDED`, or the byte cap's `INTERNAL`).
 */
export type ReadShaper = (input: {
  readonly call: PolicyCall;
  readonly entry: PolicyCatalogueEntry;
  readonly result: unknown;
}) => { readonly rowCount: number | null; readonly bytesOut: number };

export interface ReadDispatcherDeps {
  readonly audit: Pick<AuditRepository, 'append'>;
  readonly invoker: ReadTargetInvoker;
  readonly shape: ReadShaper;
  now?(): Date;
  readonly gatewayVersion?: string;
}

export type ReadDispatchOutcome =
  | {
      readonly kind: 'executed';
      readonly response: unknown;
      readonly auditCallId: string;
    }
  | { readonly kind: 'refused'; readonly error: ForgeError; readonly auditCallId: string };

export interface ReadDispatcher {
  dispatch(input: {
    readonly call: PolicyCall;
    readonly entry: PolicyCatalogueEntry;
    readonly ctx: PolicyContext;
    readonly executionGrant: string | null;
  }): Promise<ReadDispatchOutcome>;
}

/** 02 §4.6's closed outcome for a binding-side failure. Shared with the write path's recorder. */
export function bindingOutcomeFor(code: string): AuditOutcome {
  if (code === 'TARGET_TIMEOUT') return 'timeout';
  if (code === 'TARGET_PRECONDITION_FAILED') return 'business_error';
  return 'binding_error';
}

function isForgeError(error: unknown): error is ForgeError {
  return error instanceof Error && error.name === 'ForgeError';
}

export function readDispatcher(deps: ReadDispatcherDeps): ReadDispatcher {
  const nowIso = (ctx: PolicyContext): string => (deps.now?.() ?? ctx.scope.now).toISOString();

  return {
    async dispatch({ call, entry, ctx, executionGrant }) {
      if (entry.write) {
        // A write must never reach a path with no plan, no token and no
        // idempotency. Structurally unreachable from the assembly; refused
        // if a caller wires it by hand.
        throw new Error(`${call.toolId} is a write tool and cannot be dispatched as a read.`);
      }
      const base = {
        call,
        entry,
        ctx,
        phase: 'execute' as const,
        businessArgs: businessArgs(call.args),
        ...(deps.gatewayVersion === undefined ? {} : { gatewayVersion: deps.gatewayVersion }),
      };

      let result: unknown;
      try {
        result = await deps.invoker.invoke({ call, entry, ctx, executionGrant });
      } catch (error) {
        if (!isForgeError(error)) throw error;
        const row = await deps.audit.append({
          ...auditRowBase({
            ...base,
            outcome: bindingOutcomeFor(error.code),
            ts: nowIso(ctx),
          }),
          errorCode: error.code,
          errorMessageAgent: error.message,
        });
        return { kind: 'refused', error, auditCallId: row.id };
      }

      let counts: { readonly rowCount: number | null; readonly bytesOut: number };
      try {
        counts = deps.shape({ call, entry, result });
      } catch (error) {
        if (!isForgeError(error)) throw error;
        const row = await deps.audit.append({
          ...auditRowBase({ ...base, outcome: 'policy_denied', ts: nowIso(ctx) }),
          errorCode: error.code,
          errorMessageAgent: error.message,
          deniedByRule: error.code === 'ROW_CAP_EXCEEDED' ? 'row-cap' : 'response-byte-cap',
        });
        return { kind: 'refused', error, auditCallId: row.id };
      }

      const row = await deps.audit.append({
        ...auditRowBase({
          ...base,
          outcome: 'ok',
          ts: nowIso(ctx),
          resultKeys: extractResultKeys(result, entry.resultKeys ?? []),
        }),
        ...(counts.rowCount === null ? {} : { rowCount: counts.rowCount }),
        bytesOut: counts.bytesOut,
      });
      return { kind: 'executed', response: result, auditCallId: row.id };
    },
  };
}
