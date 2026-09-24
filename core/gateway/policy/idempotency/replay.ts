// MCPForge — the shape of a replayed answer. W0-F3, 02 §3.1.2.
//
// One function, in its own file, because a replay can be served from TWO places
// — stage 6h (a repeat that arrives after the original settled) and the
// dispatcher (a repeat that arrives while the original is still running) — and
// 02 §3.1.2 promises the caller ONE thing: the original result, marked
// `replayed`. Two call sites shaping that answer separately is how the promise
// quietly becomes two different promises.

/**
 * The original result with `"replayed": true` (02 §3.1.2).
 *
 * A non-object original — a number, a string, `null` — is wrapped under
 * `result` rather than spread, because spreading a primitive would silently
 * discard it and hand the agent a body that says only `replayed: true`. That is
 * worse than useless on a write path: it looks like a successful replay of
 * nothing.
 */
export function replayedResponse(previousResult: unknown): Readonly<Record<string, unknown>> {
  const body =
    previousResult !== null && typeof previousResult === 'object' && !Array.isArray(previousResult)
      ? (previousResult as Record<string, unknown>)
      : { result: previousResult };
  return { ...body, replayed: true };
}
