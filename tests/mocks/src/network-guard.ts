// MCPForge — W0-H6: a hard proof that replay makes no network call.
//
// `withNetworkGuard` monkey-patches `globalThis.fetch` (and, best-effort,
// `net`/`http`/`https` module-level `connect`/`request` are NOT touched here —
// this repo's targets speak over `fetch`-shaped clients per `AisClient`, so
// guarding `fetch` is the honest boundary for what this harness's clients can
// even attempt) to throw instead of dialing out, runs `fn`, and restores the
// original afterward. A replay test wraps its call in this guard; if the
// replaying client ever fell through to a real network call, the guard turns
// that into a hard test failure rather than a slow/flaky one.

export class NetworkCallAttemptedError extends Error {
  constructor(input: unknown) {
    super(`A network call was attempted during a guarded (offline) test: ${describe(input)}`);
    this.name = 'NetworkCallAttemptedError';
  }
}

function describe(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof input === 'object' && input !== null && 'url' in input) {
    return String((input as { url: unknown }).url);
  }
  return String(input);
}

export async function withNetworkGuard<T>(fn: () => Promise<T> | T): Promise<T> {
  const original = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = (input: unknown): never => {
    throw new NetworkCallAttemptedError(input);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}
