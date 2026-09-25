// MCPForge — W0-P17. Execute, shape and audit: what happens after the chain.
// 02 §4.2 steps [7] binding executor, [8] result shaping, [9] audit.
//
// `createCallExecution` fills the served surface's two seams (./surface.ts):
//
//   execute(proceed)   a WRITE goes through `writeDispatcher`: claim, then
//                      { nonce consume · invoke · settle · audit } in one
//                      transaction (W0-F3/F5). A READ goes through
//                      `readDispatcher`: invoke, shape (row cap, byte cap),
//                      audit. Both invoke the `function` executor with the
//                      chain's `executionGrant`; the executor refuses without
//                      one (W0-P9).
//   record(decision)   a refusal, a plan (or approval hand-off) or a 6h replay
//                      appends its row through `decisionRecorder`.
//
// Every row goes through the store's one audit repository, with the one row
// builder (`policy/idempotency/audit-row.ts`), so `forge audit verify` walks a
// single chain over all of them.
//
// THE EXECUTOR IS INJECTED. `createFunctionExecutor` may be constructed only in
// the launch assembly (W0-P11, tests/policy/escalation.trust-boundary.test.ts),
// so this module takes one rather than building one.
//
// RESULT SHAPING, as the owner decided for Wave 0 (25 Sep 2026):
//   * row count = the length of the LARGEST top-level array in the parsed
//     result (`{ vouchers: [...] }` -> vouchers.length); a result with none
//     has no row count and is not row-capped;
//   * the row cap and the byte cap are the deployment's effective caps (the
//     overlay, never above the hard ceilings); the byte cap is tightened by the
//     manifest's `binding.execution.responseBytesMax`;
//   * the narrowing parameters a refusal names are the tool's OPTIONAL inputs
//     (all inputs when it has none), until manifests declare them;
//   * results are NOT redacted for the agent (the caller is entitled to what
//     scope admitted); the audit row's arguments are redacted by sensitivity.
// Writes are not row-capped: a write's result is the record it created, and
// refusing it AFTER commit would hide a created business key from the caller.
// The executor's own response cap still applies to writes, before commit.

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { forgeError, type ErrorCode, type ForgeError } from '@mcpforge/shared/errors';
import type { FunctionExecutor } from '@mcpforge/adapter-function';
import {
  businessArgs,
  decisionRecorder,
  readDispatcher,
  writeDispatcher,
  type PolicyCall,
  type PolicyCatalogueEntry,
  type PolicyContext,
  type PolicyDecision,
  type WritePathStore,
} from '../policy/index.js';
import { enforceResponseByteCap, enforceRowCap, type CapValues } from '../caps/index.js';
import type { AuditRepository } from '../store/audit/types.js';
import type { RuntimeCatalogue } from './catalogue.js';
import type { ProceedHandler } from './surface.js';

export interface CallExecutionOptions {
  /** The write path's store view; `audit` is also where every other row goes. */
  readonly store: WritePathStore & { readonly audit: AuditRepository };
  readonly catalogue: RuntimeCatalogue;
  readonly executor: FunctionExecutor;
  /** The deployment's effective caps (`loadEffectiveCaps`). */
  readonly caps: CapValues;
  readonly gatewayVersion?: string;
  now?(): Date;
}

/** A chain decision that ended the call, and the context it was made in. */
export type DecisionRecord = (input: {
  readonly call: PolicyCall;
  readonly ctx: PolicyContext;
  readonly decision: Exclude<PolicyDecision, { readonly outcome: 'proceed' }>;
}) => Promise<string>;

export interface CallExecution {
  readonly execute: ProceedHandler;
  readonly record: DecisionRecord;
}

function toolResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function toolError(error: ForgeError): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(error.toJSON()) }] };
}

/** The largest top-level array's length; null when the result carries none. */
export function rowCountOf(result: unknown): number | null {
  if (Array.isArray(result)) return result.length;
  if (result === null || typeof result !== 'object') return null;
  let max: number | null = null;
  for (const value of Object.values(result as Record<string, unknown>)) {
    if (Array.isArray(value)) max = Math.max(max ?? 0, value.length);
  }
  return max;
}

export function createCallExecution(options: CallExecutionOptions): CallExecution {
  const { catalogue, executor } = options;
  const version =
    options.gatewayVersion === undefined ? {} : { gatewayVersion: options.gatewayVersion };
  const clock = options.now === undefined ? {} : { now: options.now };

  /** Step [7] for a `function` binding: the executor, with the chain's grant. */
  async function invokeFunction(input: {
    readonly call: PolicyCall;
    readonly entry: PolicyCatalogueEntry;
    readonly ctx: PolicyContext;
    readonly executionGrant: string | null;
  }): Promise<unknown> {
    const { call, ctx, executionGrant } = input;
    const descriptor = catalogue.functionDescriptorFor(call.toolId);
    const validate = catalogue.schemaValidatorFor(call.toolId);
    if (descriptor === undefined || validate === undefined) {
      throw new Error(`${call.toolId} has no function descriptor or compiled schema loaded.`);
    }
    const result = await executor.execute(descriptor, {
      args: businessArgs(call.args),
      correlationId: call.correlationId,
      validate,
      principalSubject: ctx.scope.session.principal.subject,
      ...(executionGrant === null ? {} : { executionGrant }),
    });
    try {
      return JSON.parse(result.body) as unknown;
    } catch {
      // A body that is not JSON is still the target's answer; it is carried,
      // never dropped or reinterpreted.
      return { body: result.body };
    }
  }

  function narrowingParams(toolId: string): readonly string[] {
    const inputs = catalogue.tools.get(toolId)?.view.input ?? [];
    const optional = inputs.filter((i) => !i.required).map((i) => i.name);
    return optional.length > 0 ? optional : inputs.map((i) => i.name);
  }

  const writes = writeDispatcher({
    store: options.store,
    invoker: { invoke: invokeFunction },
    scopeHoursFor: (toolId) =>
      catalogue.tools.get(toolId)?.view.writeSafety?.idempotencyScopeHours ?? undefined,
    ...clock,
    ...version,
  });

  const reads = readDispatcher({
    audit: options.store.audit,
    invoker: { invoke: invokeFunction },
    shape: ({ call, result }) => {
      const params = narrowingParams(call.toolId);
      const bytes = Buffer.byteLength(JSON.stringify(result) ?? '', 'utf8');
      const manifestCap = catalogue.functionDescriptorFor(call.toolId)?.execution.responseBytesMax;
      enforceResponseByteCap({
        toolId: call.toolId,
        correlationId: call.correlationId,
        byteLength: bytes,
        ...(manifestCap === undefined ? {} : { manifestResponseByteCap: manifestCap }),
        effectiveCaps: options.caps,
        narrowingParams: params,
      });
      const rowCount = rowCountOf(result);
      if (rowCount !== null) {
        enforceRowCap({
          toolId: call.toolId,
          correlationId: call.correlationId,
          rowCount,
          effectiveCaps: options.caps,
          narrowingParams: params,
        });
      }
      return { rowCount, bytesOut: bytes };
    },
    ...clock,
    ...version,
  });

  const recorder = decisionRecorder({ audit: options.store.audit, ...clock, ...version });

  const execute: ProceedHandler = async ({ call, decision, policy }) => {
    const policyCall: PolicyCall = { ...call };
    const entry = policy.catalogue.find((e) => e.toolId === call.toolId);
    if (entry === undefined || entry.bindingType !== 'function') {
      // Stage 6a admitted the tool, so an absent entry is a broken context;
      // a non-function binding has no executor wired in Wave 0. Refused
      // before anything is sent, and recorded.
      const error = forgeError(
        'INTERNAL',
        `${call.toolId} has no executor wired for its binding type, so it was not sent to the target.`,
        call.correlationId,
        {
          next: `Report correlationId ${call.correlationId} to the MCPForge operator. Tell the human the request did not reach the target system, so no business record was created or changed.`,
        },
      );
      await recorder.recordDecision({
        call: policyCall,
        ctx: policy,
        decision: { outcome: 'refused', stage: '6h', stagesRun: decision.stagesRun, error },
        deniedByRule: 'no-executor-for-binding-type',
      });
      return toolError(error);
    }

    if (entry.write) {
      const outcome = await writes.dispatch({
        call: policyCall,
        entry,
        ctx: policy,
        confirmed: decision.confirmed,
        executionGrant: decision.executionGrant,
      });
      if (outcome.kind === 'executed') return toolResult(outcome.response);
      await recorder.recordWriteDispatch({ call: policyCall, entry, ctx: policy, outcome });
      if (outcome.kind === 'replayed') return toolResult(outcome.response);
      return toolError(
        forgeError(outcome.code as ErrorCode, outcome.message, call.correlationId, {
          next: outcome.next,
        }),
      );
    }

    const outcome = await reads.dispatch({
      call: policyCall,
      entry,
      ctx: policy,
      executionGrant: decision.executionGrant,
    });
    return outcome.kind === 'executed' ? toolResult(outcome.response) : toolError(outcome.error);
  };

  return {
    execute,
    record: (input) => recorder.recordDecision(input),
  };
}
