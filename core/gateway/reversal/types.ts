// MCPForge — the reversal registry's types. W0-F5, 02 §3.1.4, 03 §7.5.
//
// 02 §3.1.4: "**The registry is live, not documentation.**" That sentence is
// this module's whole brief. `writeSafety.reversal` is not a paragraph in a
// runbook — it is read at execute time, frozen into the audit row, and read
// back by `forge audit reverse` to construct a real call that runs the real
// plan -> confirm sequence.

import type { ReversalClass } from '@mcpforge/shared';

/**
 * One tool's declared reversal, exactly as its manifest's
 * `writeSafety.reversal` block declares it. No field here is invented by the
 * gateway: a reversal the runtime believes in but a reviewer cannot see in the
 * manifest would be the drift this type exists to prevent.
 */
export interface ReversalContract {
  readonly class: ReversalClass;
  /** The reversing tool id. Required by `forge validate` for `compensating-tool`. */
  readonly tool?: string;
  /** Reversing-tool argument name -> `"$.result.<original result key>"`. */
  readonly argMap?: Readonly<Record<string, string>>;
  readonly windowHours?: number;
  readonly preconditions?: string;
}

/**
 * toolId -> its reversal contract. The gateway's composition root builds this
 * from the compiled catalogue; `forge audit reverse` builds it from the same
 * artefact. There is deliberately no second, gateway-side place a reversal can
 * be declared.
 */
export interface ReversalRegistry {
  contractFor(toolId: string): ReversalContract | undefined;
}

/** One declared `output.resultKeys` entry — a business key and its JSONPath. */
export interface ResultKeySpec {
  readonly name: string;
  /** `"$.a.b.c"` into the raw target response. */
  readonly path: string;
}

/**
 * The reversing call, constructed but NOT yet made. It is deliberately a plain
 * `{toolId, args}`: whatever executes it must put it through the ordinary
 * chain, because 03 §7.5 is explicit that "a reversal is itself a write, so it
 * runs the full plan -> confirm sequence. It is not a shortcut, and the UI does
 * not pretend it is."
 */
export interface ReversingCall {
  readonly toolId: string;
  readonly args: Readonly<Record<string, unknown>>;
  /** The audit call id this reversal is for. Becomes its `reverses_call_id`. */
  readonly reversesCallId: string;
  readonly contract: ReversalContract;
}

/**
 * Why a reversal could not even be CONSTRUCTED. Every one of these carries a
 * `next` (non-negotiable 5): "this cannot be reversed" is exactly the moment an
 * agent most needs to be told what a human must do instead.
 */
export type ReversalRefusalReason =
  | 'call_not_found'
  | 'not_a_write'
  | 'not_executed'
  | 'irreversible'
  | 'no_reversing_tool'
  | 'no_arg_map'
  | 'missing_result_key'
  | 'window_expired'
  | 'already_reversed';

export interface ReversalRefusal {
  readonly ok: false;
  readonly reason: ReversalRefusalReason;
  readonly message: string;
  readonly next: string;
}

export type ConstructedReversal = { readonly ok: true; readonly call: ReversingCall };

export type ReversalConstruction = ConstructedReversal | ReversalRefusal;

/**
 * The seam that actually runs the reversing call. It is a SEAM and not an
 * implementation because running a tool call means the whole ten-stage chain
 * plus the write dispatcher plus a binding executor, and the gateway's
 * composition root — not this module — owns all three.
 *
 * The contract on an implementor is exactly one sentence, and it is the one
 * 03 §7.5 states: **run the full plan -> confirm sequence.** An implementation
 * that mints its own token, or that dispatches without one, has broken the
 * property this task exists to prove.
 */
export interface ReversalExecutor {
  /**
   * Plan the call (no `confirm`), then confirm it with the token the plan
   * returned and identical business arguments, then execute.
   *
   * `reversesCallId` must reach the audit row the execute writes.
   */
  planAndConfirm(input: {
    readonly toolId: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly reversesCallId: string;
  }): Promise<ReversalExecution>;
}

export type ReversalExecution =
  | {
      readonly ok: true;
      /** The audit call id of the reversing call. */
      readonly callId: string;
      readonly plan: Readonly<Record<string, unknown>>;
      readonly result: Readonly<Record<string, unknown>>;
    }
  | {
      readonly ok: false;
      readonly phase: 'plan' | 'confirm' | 'execute';
      readonly code: string;
      readonly message: string;
      readonly next: string;
    };

/** What `forge audit reverse <callId>` (and the portal's equivalent) reports. */
export interface ReversalReport {
  readonly originalCallId: string;
  readonly originalToolId: string;
  readonly reversalClass: ReversalClass | null;
  readonly reversingToolId: string | null;
  /** The result keys the original call recorded — the reversal handle (02 §2.2). */
  readonly resultKeys: Readonly<Record<string, string>>;
  /** The constructed reversing call, whether or not it was executed. */
  readonly reversingCall: { readonly toolId: string; readonly args: Readonly<Record<string, unknown>> } | null;
  readonly executed: ReversalExecution | null;
  readonly refusal: ReversalRefusal | null;
  /** Both ends of the edge, after the reversal (03 §7.5). */
  readonly links: {
    readonly reversesCallId: string | null;
    readonly reversedByCallId: string | null;
  } | null;
}
