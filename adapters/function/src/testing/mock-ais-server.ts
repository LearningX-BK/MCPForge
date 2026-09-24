// MCPForge — an IN-PROCESS fake AIS server for this package's tests.
//
// Why in-process rather than a container: W0-D3 used Testcontainers for
// Keycloak, but no Docker or cloud access exists in this environment (02 §7.1's
// laptop-first rule is the same reason), so the fake is a plain object
// implementing `AisClient`. It is NOT a recorded-fixture harness — that is
// W0-H6 (`tests/mocks/**`) and this package deliberately does not pre-empt it.
//
// The fake RECORDS every call it received, which is what lets a test assert
// that an unmapped field never reached the target and that no more than
// `maxConcurrency` calls were ever in flight at once.

import type { AisClient, AisRequest, AisResponse } from '../types.js';

export interface RecordedCall {
  readonly orchestration: string;
  readonly orchestrationVersion: string | null;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
}

export interface MockAisBehaviour {
  /** Resolve after this many ms. A value above the timeout proves the timeout. */
  readonly delayMs?: number;
  /** Never resolve at all — the hung target. Settles only on abort. */
  readonly hang?: boolean;
  readonly status?: number;
  /** Literal body, or a function of the request. */
  readonly body?: string | ((req: AisRequest) => string);
  /** Body padded to exactly this many bytes — for the response-cap test. */
  readonly bodyBytes?: number;
  readonly targetError?: AisResponse['targetError'];
  /** Thrown as a transport failure rather than returned. */
  readonly throws?: Error;
  /**
   * W0-H3 / 02 §3.5 — the identity the fake target claims to have EXECUTED
   * under, returned the way a composed final echo step returns it. Nesting is
   * under `echoStep` when given (the AIS shape: each step's output under the
   * step's name), otherwise at the document root. Omit it entirely to model an
   * orchestration that was never composed with the echo step.
   *
   * It is a separate knob from `body` on purpose: a test that wants to prove a
   * mismatch should not also have to hand-write a whole response document.
   */
  readonly executesAs?: string;
  readonly echoStep?: string;
}

export interface MockAisServer extends AisClient {
  readonly calls: readonly RecordedCall[];
  /** Highest number of simultaneously in-flight calls observed. */
  peakConcurrency(): number;
  inFlight(): number;
  /** Release every call currently held by `gate()`. */
  releaseAll(): void;
  /** Hold calls open until `releaseAll()` — for the concurrency test. */
  gate(): void;
  reset(): void;
}

export function createMockAisServer(behaviour: MockAisBehaviour = {}): MockAisServer {
  const calls: RecordedCall[] = [];
  let inFlight = 0;
  let peak = 0;
  let gated = false;
  let releases: (() => void)[] = [];

  function bodyFor(req: AisRequest): string {
    if (behaviour.bodyBytes !== undefined) {
      // With `executesAs`, the padded body is still a parseable document
      // carrying the echo — so a size-cap test and an identity-echo test can
      // be the same call. ASCII throughout, so bytes == characters.
      if (behaviour.executesAs !== undefined) {
        const prefix = `{"MCPFORGE_EXECUTING_USER":${JSON.stringify(behaviour.executesAs)},"pad":"`;
        const suffix = '"}';
        const pad = behaviour.bodyBytes - prefix.length - suffix.length;
        if (pad >= 0) return `${prefix}${'x'.repeat(pad)}${suffix}`;
      }
      return 'x'.repeat(behaviour.bodyBytes);
    }
    if (typeof behaviour.body === 'function') return behaviour.body(req);
    if (typeof behaviour.body === 'string') return behaviour.body;
    const doc: Record<string, unknown> = {
      ok: true,
      orchestration: req.orchestration,
      echo: req.inputs,
    };
    if (behaviour.executesAs !== undefined) {
      const identity = { MCPFORGE_EXECUTING_USER: behaviour.executesAs };
      if (behaviour.echoStep !== undefined) doc[behaviour.echoStep] = identity;
      else Object.assign(doc, identity);
    }
    return JSON.stringify(doc);
  }

  const server: MockAisServer = {
    calls,
    peakConcurrency: () => peak,
    inFlight: () => inFlight,
    gate() {
      gated = true;
    },
    releaseAll() {
      gated = false;
      const pending = releases;
      releases = [];
      for (const r of pending) r();
    },
    reset() {
      calls.length = 0;
      inFlight = 0;
      peak = 0;
      gated = false;
      releases = [];
    },

    async call(req: AisRequest): Promise<AisResponse> {
      calls.push({
        orchestration: req.orchestration,
        orchestrationVersion: req.orchestrationVersion,
        // Snapshot, so a later mutation cannot rewrite the evidence.
        inputs: { ...req.inputs },
        correlationId: req.correlationId,
      });
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        if (behaviour.throws !== undefined) throw behaviour.throws;

        if (gated) {
          await new Promise<void>((resolve) => {
            releases.push(resolve);
          });
        }

        if (behaviour.hang === true) {
          await new Promise<never>((_resolve, reject) => {
            const onAbort = (): void => reject(new Error('The operation was aborted'));
            if (req.signal.aborted) onAbort();
            else req.signal.addEventListener('abort', onAbort, { once: true });
          });
        }

        if (behaviour.delayMs !== undefined && behaviour.delayMs > 0) {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, behaviour.delayMs);
            req.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(t);
                reject(new Error('The operation was aborted'));
              },
              { once: true },
            );
          });
        }

        return {
          status: behaviour.status ?? 200,
          body: bodyFor(req),
          ...(behaviour.targetError !== undefined ? { targetError: behaviour.targetError } : {}),
        };
      } finally {
        inFlight -= 1;
      }
    },
  };

  return server;
}
