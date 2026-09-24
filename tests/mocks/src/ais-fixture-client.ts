// MCPForge — W0-H6: a recorded-fixture `AisClient` for the `function` binding
// executor's seam (`adapters/function/src/types.ts`).
//
// This is intentionally NOT a duplicate of `mock-ais-server.ts` (W0-H1). That
// file is an in-process behavioural fake — you hand it a `MockAisBehaviour`
// (delay, hang, status, body) and it improvises a response. This file instead
// REPLAYS a versioned fixture from disk: same request in, same recorded
// response out, every time, with no behavioural knobs. The two are
// complementary: W0-H1's fake is for exercising timeout/concurrency/abort
// mechanics; this one is for contract tests that want the exact shape of a
// real (or realistic synthetic) target response, replayed deterministically.
//
// `buildAisRequestKey` is deliberately simple and total: orchestration name +
// version + a stable (sorted-key) JSON encoding of the mapped inputs. Fixture
// authors read the key straight off a `.json` file, and a request whose
// inputs differ even by key order still matches, because the encoding sorts
// keys before hashing.

import { createHash } from 'node:crypto';
import type { AisClient, AisRequest, AisResponse } from '@mcpforge/adapter-function';
import { FixtureIndex, type FixtureSet } from './fixture-store.js';

export interface RecordedAisCall {
  readonly orchestration: string;
  readonly orchestrationVersion: string | null;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
  readonly requestKey: string;
}

export interface FixtureAisClient extends AisClient {
  /** Every call this client received, in order — the recording capability §done-criterion 2 needs. */
  readonly calls: readonly RecordedAisCall[];
  reset(): void;
}

/** Stable key: sorted-key JSON keeps the key independent of caller-side property insertion order. */
export function buildAisRequestKey(req: Pick<AisRequest, 'orchestration' | 'orchestrationVersion' | 'inputs'>): string {
  const sortedInputs = sortKeysDeep(req.inputs);
  const payload = JSON.stringify({
    orchestration: req.orchestration,
    orchestrationVersion: req.orchestrationVersion,
    inputs: sortedInputs,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Builds an `AisClient` that replays `set` deterministically and records every
 * call it received. Throws `FixtureMissError` (from `fixture-store.ts`) for a
 * request key with no case — a loud failure, never a silent fallback, matching
 * this repo's non-negotiable-#1 posture on "no fallback path" even here in
 * test infrastructure.
 */
export function createFixtureAisClient(set: FixtureSet): FixtureAisClient {
  const index = new FixtureIndex(set);
  const calls: RecordedAisCall[] = [];

  return {
    calls,
    reset() {
      calls.length = 0;
      index.reset();
    },
    async call(req: AisRequest): Promise<AisResponse> {
      const requestKey = buildAisRequestKey(req);
      calls.push({
        orchestration: req.orchestration,
        orchestrationVersion: req.orchestrationVersion,
        inputs: { ...req.inputs },
        correlationId: req.correlationId,
        requestKey,
      });
      const response = index.next(requestKey);
      return {
        status: response.status,
        body: response.body,
        ...(response.targetError !== undefined ? { targetError: response.targetError } : {}),
      };
    },
  };
}
