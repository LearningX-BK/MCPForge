// MCPForge — the `function` binding executor. 02 §3.5, "Sandboxing":
//
//   * Orchestration/service-method name comes from `binding.ref` only — never
//     from a parameter. There is no "call arbitrary orchestration" tool, and
//     none may be authored.
//   * Inputs are validated against the generated JSON Schema before dispatch,
//     then mapped to the orchestration's typed inputs by a generated mapping.
//     Unmapped extra fields are dropped, not forwarded.
//   * Response size cap, timeout, and a per-orchestration concurrency limit
//     (`maxConcurrency`, default 4).
//
// The order below is the order of that list, deliberately: admission (a slot),
// validation, mapping, dispatch, cap. Nothing dispatches before all four.
//
// NOT PROVEN AGAINST A LIVE TARGET. There is no JDE AIS instance in this
// environment. `AisClient` is the documented seam and every test in this
// package runs against the in-process fake in `src/testing/`.

import type { ForgeError } from '@mcpforge/shared/errors';
import { AcquireTimeout, ConcurrencyRegistry } from './concurrency.js';
import * as adapterErrors from './errors.js';
import {
  assertIdentityEcho,
  createDeterministicSampler,
  decideEchoCheck,
  skippedEcho,
} from './identity.js';
import { applyInputMapping } from './mapping.js';
import type {
  AisClient,
  EchoSampler,
  ExecutionGrantCheck,
  FunctionBindingDescriptor,
  FunctionCallInput,
  FunctionCallResult,
} from './types.js';

export interface FunctionExecutorOptions {
  readonly client: AisClient;
  /**
   * W0-P9 — required, no default. Every `execute()` is refused unless this
   * confirms the call carries a grant minted by the gateway's policy chain.
   */
  readonly grants: ExecutionGrantCheck;
  /** Shared across every descriptor so the limit is per orchestration, not per executor. */
  readonly concurrency?: ConcurrencyRegistry;
  /**
   * 02 §3.5's read sampling for the runtime identity echo. Injectable so the
   * 1-in-N rate is an assertable property rather than a statistical one;
   * defaults to the deterministic 1-in-20 sampler. Shared across descriptors so
   * the counters are per orchestration, like the concurrency registry.
   */
  readonly echoSampler?: EchoSampler;
}

export interface FunctionExecutor {
  execute(
    descriptor: FunctionBindingDescriptor,
    input: FunctionCallInput,
  ): Promise<FunctionCallResult>;
}

function byteLength(body: string): number {
  return Buffer.byteLength(body, 'utf8');
}

function describeValidationErrors(validate: FunctionCallInput['validate']): string {
  const errs = validate.errors ?? [];
  if (errs.length === 0) return 'the arguments did not match the generated schema';
  return errs
    .slice(0, 5)
    .map(
      (e) =>
        `${e.instancePath && e.instancePath.length > 0 ? e.instancePath : '(root)'} ${e.message ?? 'is invalid'}`,
    )
    .join('; ');
}

export function createFunctionExecutor(options: FunctionExecutorOptions): FunctionExecutor {
  const registry = options.concurrency ?? new ConcurrencyRegistry();
  const client = options.client;
  const grants = options.grants;
  if (grants === undefined || typeof grants.check !== 'function') {
    // Reachable only from untyped JavaScript; TypeScript already requires it.
    throw new Error('createFunctionExecutor requires `grants` (W0-P9); there is no default.');
  }
  const echoSampler = options.echoSampler ?? createDeterministicSampler();

  return {
    async execute(
      descriptor: FunctionBindingDescriptor,
      input: FunctionCallInput,
    ): Promise<FunctionCallResult> {
      const { correlationId } = input;
      const caps = descriptor.execution;

      // 0. W0-P9 — the gateway is the only door. Before validation, admission
      //    or dispatch: was THIS call (tool, binding ref, business arguments,
      //    caller, correlation id) authorized by the policy chain? A call that
      //    did not come through the chain has no grant, and nothing below runs.
      const grant = grants.check(input.executionGrant, {
        toolId: descriptor.toolId,
        bindingRef: descriptor.ref,
        args: input.args,
        callerSubject: input.principalSubject,
        correlationId,
      });
      if (!grant.ok) {
        throw adapterErrors.executionNotGranted(descriptor, correlationId, grant.reason);
      }

      // 1. Validate against the GENERATED schema. Not a second validator: the
      //    caller passes in the compiled Ajv function built from the same
      //    generated/tools/<id>/schema.json (see `compileGeneratedSchema`).
      if (!input.validate(input.args)) {
        throw adapterErrors.inputInvalid(
          descriptor,
          correlationId,
          describeValidationErrors(input.validate),
        );
      }

      // 2. Map. The mapping is closed; unmapped caller fields are dropped here
      //    and there is no later step that can reintroduce them.
      const { inputs, droppedArgs } = applyInputMapping(descriptor, input.args);

      // 3. Admission — per-orchestration concurrency. A queued call has not
      //    reached the target, so a refusal is safe for writes.
      let release: () => void;
      try {
        release = await registry.for(descriptor.ref, caps.maxConcurrency).acquire(caps.timeoutMs);
      } catch (err) {
        if (err instanceof AcquireTimeout) {
          throw adapterErrors.concurrencyRefused(descriptor, correlationId);
        }
        throw adapterErrors.internal(descriptor, correlationId, String(err));
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), caps.timeoutMs);
      (timer as unknown as { unref?: () => void }).unref?.();

      try {
        // 4. Dispatch. `orchestration` is read from the frozen descriptor. The
        //    mapped payload is a separate argument, so no code path exists by
        //    which a payload field could name the orchestration.
        const response = await client.call({
          orchestration: descriptor.ref,
          orchestrationVersion: descriptor.refVersion,
          inputs,
          signal: controller.signal,
          correlationId,
        });

        if (controller.signal.aborted) {
          throw adapterErrors.targetTimeout(descriptor, correlationId);
        }

        // 5. Response size cap — discarded, never truncated.
        const bytes = byteLength(response.body);
        if (bytes > caps.responseBytesMax) {
          throw adapterErrors.responseTooLarge(descriptor, correlationId, bytes);
        }

        if (response.targetError !== undefined) {
          throw adapterErrors.targetError(
            descriptor,
            correlationId,
            response.targetError.message,
            response.targetError.precondition === true,
          );
        }

        // 6. The RUNTIME identity echo (02 §3.5), W0-H3. It runs HERE — after
        //    the response survived its size cap and the target's own error
        //    check, and BEFORE any result is returned — because "the gateway
        //    asserts it matches the caller before recording success" only
        //    means anything if a mismatch cannot become a success first. On
        //    mismatch this throws, so no `FunctionCallResult` is ever
        //    constructed for a call the target ran as someone else, and there
        //    is no path by which the caller could treat the business record as
        //    successfully completed.
        const decision = decideEchoCheck(descriptor, echoSampler);
        const identityEcho = decision.required
          ? assertIdentityEcho(
              descriptor,
              correlationId,
              input.principalSubject,
              response.body,
              decision.sampled,
            )
          : skippedEcho(decision.sampled);

        return {
          status: response.status,
          body: response.body,
          identityEcho,
          dispatched: {
            orchestration: descriptor.ref,
            orchestrationVersion: descriptor.refVersion,
            inputs,
            droppedArgs,
          },
        };
      } catch (err) {
        throw translateDispatchFailure(descriptor, correlationId, controller.signal.aborted, err);
      } finally {
        clearTimeout(timer);
        release();
      }
    },
  };
}

function isForgeError(err: unknown): err is ForgeError {
  return err instanceof Error && err.name === 'ForgeError';
}

function translateDispatchFailure(
  descriptor: FunctionBindingDescriptor,
  correlationId: string,
  aborted: boolean,
  err: unknown,
): unknown {
  if (isForgeError(err)) return err;
  if (aborted) return adapterErrors.targetTimeout(descriptor, correlationId);
  const message = err instanceof Error ? err.message : String(err);
  if (/abort/i.test(message)) return adapterErrors.targetTimeout(descriptor, correlationId);
  if (/ECONN|ENOTFOUND|EHOSTUNREACH|socket hang up|fetch failed/i.test(message)) {
    return adapterErrors.targetUnavailable(descriptor, correlationId, message);
  }
  return adapterErrors.targetError(descriptor, correlationId, message, false);
}
