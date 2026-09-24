// MCPForge — the guardrail engine's inputs and its two runtime seams. W0-F4,
// 02 §3.1.3.
//
// WHERE THE DECLARATIONS COME FROM. From the catalogue entry, and from nowhere
// else. `PolicyCatalogueEntry.guardrails` is the manifest's own
// `writeSafety.guardrails` array (`Guardrail` in `@mcpforge/shared`, the type
// W0-B1's schema and W0-B6's codegen already share). There is deliberately no
// `guardrailsFor(toolId)` lookup beside it: a second source of declarations is
// a second thing that can disagree with the manifest, and the manifest is the
// sole source of truth (CLAUDE.md §3).
//
// WHY TWO SEAMS AND NOT FIVE. Three of the five kinds — `maxNumeric` /
// `minNumeric`, `allowedValues` and (with the resolved scope the chain already
// carries) `sodConflict` — are pure functions of the call and its context, so
// they need nothing injected. The other two read state that lives outside the
// call:
//
//   * `rateLimit` needs a count of this caller's EXECUTES of this tool inside a
//     window. That count changes between the plan call and the execute call,
//     which is precisely why 02 §3.1.3 says "never only at plan".
//   * `timeWindow` is "evaluated from a precondition read" (02 §3.1.3) — a read
//     against the target system.
//
// Both seams are FAIL-CLOSED WHEN ABSENT. A tool that declares a `rateLimit`
// guardrail on a gateway with no execute counter, or a `timeWindow` guardrail
// with no window source, BREACHES. It does not pass. An unenforceable control
// is not a satisfied control, and the alternative — treating "I cannot check"
// as "it is fine" — is the shape of every quiet write-safety failure this track
// exists to prevent.

import type { Guardrail } from '@mcpforge/shared';

/**
 * What the engine returns for one guardrail. `message` is the guardrail's OWN
 * `message` when the manifest declares one (02 §3.1.3: "the guardrail's own
 * `message`"), and a generated one naming the limit and the actual value when
 * it does not. `next` is always non-empty and always names a tool id or a human
 * action (CLAUDE.md non-negotiable #5).
 */
export interface GuardrailBreach {
  readonly breached: true;
  readonly kind: Guardrail['kind'];
  readonly message: string;
  readonly next: string;
}

export const NOT_BREACHED = Object.freeze({ breached: false as const });
export type GuardrailPass = typeof NOT_BREACHED;
export type GuardrailVerdict = GuardrailPass | GuardrailBreach;

/** One `rateLimit` question. */
export interface ExecuteCountQuery {
  readonly toolId: string;
  /** `Principal.subject` — the only identity value the audit trail keys on (02 §4.4). */
  readonly subject: string;
  /** Inclusive lower bound of the window. */
  readonly since: Date;
  readonly now: Date;
}

/**
 * How many times this caller has EXECUTED this tool inside the window.
 *
 * SEAM: the audit trail (`audit_call`, W0-C2) is the eventual source — an
 * execute is exactly an audit row with a completed outcome, and counting
 * anything else (plans, refusals) would let a caller exhaust their own limit by
 * asking for plans they never confirm. A composition root supplies an
 * implementation; the engine never opens a store itself.
 *
 * The count must NOT include the call being evaluated.
 */
export interface ExecuteCountSource {
  countExecutes(query: ExecuteCountQuery): number | Promise<number>;
}

/** One `timeWindow` question. */
export interface TimeWindowQuery {
  readonly toolId: string;
  /** The guardrail's `ref` — the named precondition read (e.g. the GL open-period check). */
  readonly ref: string;
  /** The guardrail's `field`, when the window is about a dated argument. */
  readonly field?: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly now: Date;
}

export type TimeWindowVerdict =
  | { readonly open: true }
  /** `detail` is rendered into the breach when the guardrail declares no `message`. */
  | { readonly open: false; readonly detail: string };

/**
 * Whether the target's window is open for this call.
 *
 * SEAM: the precondition read belongs to the binding adapters (`adapters/**`,
 * W0-H*) — only they know how to ask JD Edwards whether a GL period is open.
 * This is the read side, and it is the whole of the engine's dependency on the
 * target: nothing in `core/gateway/policy/**` speaks to an Oracle system.
 */
export interface TimeWindowSource {
  isOpen(query: TimeWindowQuery): TimeWindowVerdict | Promise<TimeWindowVerdict>;
}

/** What a composition root passes to `guardrailEvaluator`. */
export interface GuardrailDeps {
  readonly executes?: ExecuteCountSource;
  readonly timeWindows?: TimeWindowSource;
  /** Injected so tests pin window boundaries. Defaults to `ctx.scope.now`. */
  now?(): Date;
}
