// MCPForge — the compiled-in hard ceilings. W0-E6, 02 §4.7 "Caps.".
//
// These six numbers are the absolute maximum MCPForge will ever honour for
// each cap category, no matter what an overlay declares. They are constants,
// not configuration: changing one is a code change (a new release), not a
// deployment edit. An overlay may only ever TIGHTEN below these — never
// loosen past them — and ./overlay.ts is the module that enforces that
// one-directional rule.
//
// 02 §4.7 names exactly six things as "in the overlay so a customer
// deployment can tighten them without a code change; none can be loosened
// past a compiled-in hard ceiling": row caps, response byte caps, per-tool
// rate limits, per-caller rate limits, per-binding concurrency limits, and
// global gateway concurrency.

/** The six capped quantities, by name, so every other module in this package
 * refers to the same closed set rather than inventing new cap names. */
export const CAP_NAMES = [
  'rowCap',
  'responseByteCap',
  'perToolRateLimitPerMinute',
  'perCallerRateLimitPerMinute',
  'perBindingConcurrency',
  'globalConcurrency',
] as const;

export type CapName = (typeof CAP_NAMES)[number];

export type CapValues = Readonly<Record<CapName, number>>;

/**
 * The hard ceilings. Values are deliberately generous Wave-0 defaults — they
 * exist to bound the worst case (a runaway query, a misbehaving consumer, a
 * single-instance gateway falling over), not to be anyone's working limit. A
 * deployment tightens toward its real operating limits via the overlay
 * (./overlay.ts); nothing tightens these.
 */
export const HARD_CEILINGS: CapValues = Object.freeze({
  /** Rows a single tool call's result may carry, per manifest cap, re-checked after fetch. */
  rowCap: 5_000,
  /** Bytes a single tool call's response body may occupy. */
  responseByteCap: 5_000_000,
  /** Calls a single tool id may accept from any one caller, per rolling minute. */
  perToolRateLimitPerMinute: 600,
  /** Calls a single caller (Principal.subject) may make across all tools, per rolling minute. */
  perCallerRateLimitPerMinute: 300,
  /** Concurrent in-flight calls a single binding (bindingRef) may run at once. */
  perBindingConcurrency: 20,
  /** Concurrent in-flight calls the whole gateway process may run at once (one instance, Wave 0). */
  globalConcurrency: 100,
});

/** `true` when `value` is a finite, non-negative integer — the only shape a cap value may take. */
export function isValidCapValue(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  );
}
