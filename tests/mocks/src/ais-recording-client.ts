// MCPForge — W0-H6: the RECORDING half of the harness.
//
// Wraps a real `AisClient` (something that actually dials a live AIS server)
// and captures every request/response pair as fixture cases. This is what
// `scripts/refresh-fixtures.ts` uses to re-capture a fixture set against a
// live target — it is machinery, exercised in this package only against a
// fake "live" client (see `ais-recording-client.test.ts`), because no real
// JDE/AIS instance exists in this environment. Whoever runs `refresh:fixtures`
// with `MCPFORGE_LIVE_TARGET_URL` set against a real probe/staging AIS server
// is the one who produces the first genuinely "recorded" (non-synthetic)
// fixture set — that is a human/ops step, not something this task can
// fabricate.

import type { AisClient, AisRequest, AisResponse } from '@mcpforge/adapter-function';
import { buildAisRequestKey } from './ais-fixture-client.js';
import type { FixtureCase, FixtureResponse, FixtureSet } from './fixture-store.js';

export interface RecordingAisClient extends AisClient {
  /** Drain the cases captured so far into a fixture set ready to save. */
  toFixtureSet(name: string, targetDescription: string): FixtureSet;
}

/** Wraps `real` so every call it serves is captured as a fixture case, appended in `sequence` order per key. */
export function createRecordingAisClient(real: AisClient): RecordingAisClient {
  const casesByKey = new Map<string, FixtureResponse[]>();

  return {
    async call(req: AisRequest): Promise<AisResponse> {
      const response = await real.call(req);
      const requestKey = buildAisRequestKey(req);
      const recorded: FixtureResponse = {
        status: response.status,
        body: response.body,
        ...(response.targetError !== undefined ? { targetError: response.targetError } : {}),
      };
      const existing = casesByKey.get(requestKey);
      if (existing) existing.push(recorded);
      else casesByKey.set(requestKey, [recorded]);
      return response;
    },

    toFixtureSet(name: string, targetDescription: string): FixtureSet {
      const cases: FixtureCase[] = [...casesByKey.entries()].map(([requestKey, sequence]) => ({
        requestKey,
        sequence,
      }));
      return {
        name,
        source: 'recorded',
        capturedAt: new Date().toISOString(),
        targetDescription,
        cases,
      };
    },
  };
}
