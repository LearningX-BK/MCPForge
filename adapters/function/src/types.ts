// MCPForge — the `function` binding executor's type model. 02 §3.5.
//
// The cage of this binding type is at the boundary, and it is entirely
// expressed by the shapes in this file:
//
//   * `FunctionBindingDescriptor.ref` is the ONLY place an orchestration name
//     can come from. There is no field on the call path — none — that carries
//     an orchestration, service-method or script name from a caller. The
//     descriptor is built from the manifest at codegen/boot time and is
//     `readonly` all the way down.
//   * `inputMapping` is a closed table: manifest input name -> orchestration
//     input name. Anything the caller sends that is not a key of this table is
//     DROPPED, never forwarded (`applyInputMapping`).
//   * `execution` carries the three operational caps 02 §3.5 requires —
//     `timeoutMs`, `responseBytesMax` and per-orchestration `maxConcurrency`
//     (default 4).

/**
 * The transport seam. The real implementation speaks HTTP to a JDE AIS server
 * (`/jderest/v3/orchestrator/<name>`); the tests in this package speak to an
 * in-process fake (`src/testing/mock-ais-server.ts`).
 *
 * NOTE the shape of `call`: the orchestration name is a positional argument
 * supplied by the EXECUTOR from the descriptor, and the caller-derived payload
 * is a separate, already-mapped bag. A client implementation therefore has no
 * way to read an orchestration name out of the payload even if one were
 * somehow present in it.
 */
import type { IdentityEchoOn } from '@mcpforge/shared/manifest';

export interface AisClient {
  call(request: AisRequest): Promise<AisResponse>;
}

export interface AisRequest {
  /** From `FunctionBindingDescriptor.ref`. Never from an argument. */
  readonly orchestration: string;
  readonly orchestrationVersion: string | null;
  /** The mapped orchestration inputs. Unmapped caller fields are not here. */
  readonly inputs: Readonly<Record<string, unknown>>;
  /** Abort signal carrying `execution.timeoutMs`. */
  readonly signal: AbortSignal;
  readonly correlationId: string;
  /**
   * W0-P14 — the caller's `Principal.subject`, the identity the orchestration
   * must run AS (02 §3.5 option (a)). A client that authenticates per user
   * (`createHttpAisClient`) exchanges it for a per-user AIS token and refuses
   * the call when it is absent or the token provider does not know it. There is
   * no fallback identity (CLAUDE.md #1). Copied by the executor from
   * `FunctionCallInput.principalSubject`, never from an argument.
   */
  readonly principalSubject?: string;
}

export interface AisResponse {
  /** Target HTTP status (or its transport equivalent). */
  readonly status: number;
  /**
   * The RAW response body, as bytes on the wire, so the size cap is applied to
   * what the target actually sent rather than to a re-serialisation of it.
   */
  readonly body: string;
  /** Set by the client when the target itself reported an application error. */
  readonly targetError?: { readonly message: string; readonly precondition?: boolean };
}

/**
 * The generated, manifest-derived binding descriptor this executor consumes.
 *
 * WAVE 0 NOTE (flagged in the task report, not silently decided): `forge
 * codegen` does not yet emit this artefact — `core/codegen/src/templates/**`
 * emits schema.json, handler.generated.ts and friends, and the tool manifest
 * type model (`@mcpforge/shared`'s `ToolBinding`) carries `ref`, `refVersion`
 * and `execution` but no per-input target-parameter name. Everything in this
 * descriptor except `inputMapping` is therefore already derivable from a
 * manifest today; `inputMapping` needs either a manifest field or an
 * identity-by-name convention. `buildIdentityInputMapping` below implements
 * exactly that convention and is the only mapping this executor synthesises —
 * it never invents a target name that the manifest did not state.
 */
export interface FunctionBindingDescriptor {
  readonly toolId: string;
  readonly toolVersion: string;
  readonly write: boolean;
  /** The allowlisted orchestration name. The ONLY source of it. */
  readonly ref: string;
  readonly refVersion: string | null;
  /** manifest input name -> orchestration input name. Closed. */
  readonly inputMapping: Readonly<Record<string, string>>;
  readonly execution: FunctionExecutionCaps;
  /** 02 §3.5's runtime echo policy, from `binding.identity`. W0-H3. */
  readonly identity: FunctionBindingIdentity;
}

/**
 * The manifest's `binding.identity`, narrowed to the two fields the RUNTIME
 * echo needs. `carries` and `onServiceAccount` are deliberately absent: they
 * are the probe's business (02 §4.5, W0-H5) and no code on this call path may
 * read or write them.
 */
export interface FunctionBindingIdentity {
  readonly echoOn: IdentityEchoOn;
  /**
   * The probe binding's name, e.g. `MCPFORGE_PROBE_WHOAMI`. At runtime it names
   * the orchestration's composed final step, and therefore the response key the
   * step's output is nested under. `null` when the manifest declares none.
   */
  readonly probe: string | null;
}

/** Injectable so the 1-in-N read sampling rate is assertable, not statistical. */
export interface EchoSampler {
  readonly rate: number;
  shouldSample(key: string): boolean;
}

/**
 * What the gateway writes into `audit_call.target_identity_observed` and
 * `audit_call.identity_match` (02 §3.5's "Audit shape", 02 §4.6).
 *
 * `match: null` with `required: false` is the honest record of a call the
 * policy did not check — never the same value as a check that passed.
 */
export interface IdentityEchoObservation {
  /** Whether this call was required to carry the echo check. */
  readonly required: boolean;
  /** Whether the sampler was consulted (a read under `echoOn: sampled`). */
  readonly sampled: boolean;
  /** `target_identity_observed`. */
  readonly observed: string | null;
  /** `identity_match`. */
  readonly match: boolean | null;
}

export interface FunctionExecutionCaps {
  readonly timeoutMs: number;
  /** 02 §3.5 — per-orchestration concurrency limit, default 4. */
  readonly maxConcurrency: number;
  readonly responseBytesMax: number;
}

/** 02 §3.5's default, stated once. */
export const DEFAULT_MAX_CONCURRENCY = 4;

export interface FunctionCallInput {
  /** Arguments as presented by the caller, before schema validation. */
  readonly args: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
  /**
   * The compiled JSON Schema validator for this tool, produced from the SAME
   * `generated/tools/<id>/schema.json` the gateway validates against (W0-B6).
   * This executor never builds a second hand-written validator.
   */
  readonly validate: CompiledSchemaValidator;
  /**
   * `Principal.subject` — the ONE identity value MCPForge compares, audits and
   * keys on (02 §4.4 item 3, CLAUDE.md §3). Optional in the type only because
   * `echoOn: never` reads need no caller identity here; when a check IS
   * required and this is absent the call fails `IDENTITY_UNRESOLVED`. There is
   * no fallback subject and no default (CLAUDE.md #1).
   */
  readonly principalSubject?: string;
  /**
   * W0-P9 — the policy chain's signed permission for THIS call
   * (`PolicyDecision.executionGrant`). Checked by `ExecutionGrantCheck` before
   * anything else happens; absent or invalid means nothing is dispatched.
   */
  readonly executionGrant?: string;
}

/**
 * W0-P9 — how the executor asks "did the gateway's policy chain authorize this
 * exact call?". Declared here because this package depends on
 * `@mcpforge/shared` only; the gateway supplies the implementation
 * (`executionGrantCheck` in `core/gateway/policy/execution-grant/grant.ts`,
 * HMAC over tool, binding ref, business arguments, caller and correlation id).
 * **Required** by `createFunctionExecutor`, with no default and no permissive
 * implementation anywhere in production code, so an executor that skips the
 * check cannot be built by omission.
 */
export interface ExecutionGrantCheck {
  check(
    grant: string | undefined,
    binding: {
      readonly toolId: string;
      readonly bindingRef: string;
      readonly args: Readonly<Record<string, unknown>>;
      readonly callerSubject: string | undefined;
      readonly correlationId: string;
    },
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string };
}

export interface CompiledSchemaValidator {
  (data: unknown): boolean;
  errors?: readonly { instancePath?: string; message?: string }[] | null;
}

export interface FunctionCallResult {
  readonly status: number;
  readonly body: string;
  /** What was actually sent to the target — audit + test evidence. */
  readonly dispatched: AisDispatchRecord;
  /** 02 §3.5's runtime identity echo, for the audit row. W0-H3. */
  readonly identityEcho: IdentityEchoObservation;
}

export interface AisDispatchRecord {
  readonly orchestration: string;
  readonly orchestrationVersion: string | null;
  readonly inputs: Readonly<Record<string, unknown>>;
  /** Caller-supplied argument names that were dropped rather than forwarded. */
  readonly droppedArgs: readonly string[];
}
