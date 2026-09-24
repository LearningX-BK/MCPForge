// MCPForge — single-use `jti` for the consumer client assertion. W0-N2, 05 §A.4.
//
// 05 §A.4 step 4 fixes the assertion's properties: "`jti` single-use, `exp` ≤
// 60s". Single-use is what makes the assertion a PROOF OF POSSESSION rather
// than a bearer token: an assertion captured off the wire is worthless because
// it has already been spent. Without this file, `private-key-jwt` degrades to
// a short-lived bearer credential and 05 §A.2's whole reason for choosing it
// over `client-secret` evaporates.
//
// **The Wave 0 limitation, stated rather than papered over** — the same one
// `core/gateway/store/runtime/` records for the confirm nonce (02 §10.4 item 6,
// CLAUDE.md §3.1): single-use holds on ONE NODE. This store is in-memory,
// because the gateway runs as one instance at Wave 0 and multi-replica is a
// Postgres-era property. A second replica would each hold their own view and a
// replayed assertion could land on the other one. When the gateway becomes
// multi-replica, this interface is satisfied by a `UNIQUE`-constrained insert
// in `core/gateway/store/` exactly as the confirm nonce already is — the seam
// is here so that change is a swap, not a rewrite.

/** Spent-assertion memory. Returns false when this `jti` has been seen before. */
export interface AssertionReplayStore {
  /**
   * Atomically record `jti` as spent. `false` means it was already spent and
   * the caller MUST refuse — this is a check-and-set, not a query followed by
   * a write, because a query/write pair is a race a replay can win.
   */
  consume(jti: string, expiresAt: Date): boolean;
  readonly size: number;
}

/**
 * Wave 0, single-instance. Entries are dropped once their assertion's own
 * `exp` has passed: an expired assertion is refused by signature verification
 * anyway, so remembering it longer buys nothing and leaks memory.
 */
export function inMemoryAssertionReplayStore(): AssertionReplayStore {
  const spent = new Map<string, number>();

  function evict(nowMs: number): void {
    for (const [jti, expiresMs] of spent) {
      if (expiresMs <= nowMs) spent.delete(jti);
    }
  }

  return {
    consume(jti, expiresAt) {
      const nowMs = Date.now();
      evict(nowMs);
      if (spent.has(jti)) return false;
      spent.set(jti, expiresAt.getTime());
      return true;
    },
    get size() {
      evict(Date.now());
      return spent.size;
    },
  };
}
