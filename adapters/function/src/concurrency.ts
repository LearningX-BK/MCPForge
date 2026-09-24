// MCPForge — the per-orchestration concurrency limit. 02 §3.5:
// "Response size cap, timeout, and a per-orchestration concurrency limit
//  (maxConcurrency, default 4). AIS servers are easy to overwhelm; this is a
//  real operational control, not a formality."
//
// Semantics chosen (and tested): calls over the limit QUEUE in FIFO order and
// are admitted as slots free. A call that waits longer than the acquisition
// timeout is REFUSED without ever reaching the target. What never happens is
// silent over-admission: `inFlight` can never exceed `limit`.

export interface Semaphore {
  readonly limit: number;
  /** Live count of holders. Test-visible on purpose. */
  inFlight(): number;
  queueDepth(): number;
  /** Resolves with a release function, or rejects with `AcquireTimeout`. */
  acquire(timeoutMs: number): Promise<() => void>;
}

export class AcquireTimeout extends Error {
  constructor(limit: number, timeoutMs: number) {
    super(`no concurrency slot within ${timeoutMs} ms (limit ${limit})`);
    this.name = 'AcquireTimeout';
  }
}

interface Waiter {
  readonly grant: () => void;
  readonly fail: (err: Error) => void;
  settled: boolean;
}

class FifoSemaphore implements Semaphore {
  readonly limit: number;
  #held = 0;
  readonly #queue: Waiter[] = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`maxConcurrency must be a positive integer; got ${String(limit)}`);
    }
    this.limit = limit;
  }

  inFlight(): number {
    return this.#held;
  }

  queueDepth(): number {
    return this.#queue.filter((w) => !w.settled).length;
  }

  acquire(timeoutMs: number): Promise<() => void> {
    if (this.#held < this.limit) {
      this.#held += 1;
      return Promise.resolve(this.#releaser());
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        settled: false,
        grant: () => {
          clearTimeout(timer);
          this.#held += 1;
          resolve(this.#releaser());
        },
        fail: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      const timer = setTimeout(() => {
        if (waiter.settled) return;
        waiter.settled = true;
        waiter.fail(new AcquireTimeout(this.limit, timeoutMs));
      }, timeoutMs);
      // Do not hold the process open for a queued waiter.
      (timer as unknown as { unref?: () => void }).unref?.();
      this.#queue.push(waiter);
    });
  }

  #releaser(): () => void {
    let released = false;
    return () => {
      if (released) return; // release is idempotent — a double release must not free a slot twice.
      released = true;
      this.#held -= 1;
      this.#pump();
    };
  }

  #pump(): void {
    while (this.#held < this.limit) {
      const waiter = this.#queue.shift();
      if (waiter === undefined) return;
      if (waiter.settled) continue;
      waiter.settled = true;
      waiter.grant();
    }
  }
}

/**
 * One semaphore per orchestration `ref`, per registry instance. The key is the
 * orchestration name, not the tool id, because the limit 02 §3.5 describes
 * protects the AIS orchestration and two tools may legitimately point at one.
 */
export class ConcurrencyRegistry {
  readonly #byRef = new Map<string, FifoSemaphore>();

  for(ref: string, limit: number): Semaphore {
    const existing = this.#byRef.get(ref);
    if (existing !== undefined) {
      if (existing.limit !== limit) {
        throw new Error(
          `orchestration ${ref} is already registered with maxConcurrency ${existing.limit}; refusing to re-register it with ${limit}`,
        );
      }
      return existing;
    }
    const created = new FifoSemaphore(limit);
    this.#byRef.set(ref, created);
    return created;
  }
}
