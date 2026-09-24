// MCPForge — W0-H6: proves the recording→fixture-set round trip. Exercises
// `createRecordingAisClient` against a fake "live" client (no real JDE/AIS
// instance exists in this environment — this proves the MACHINERY, not a
// real recording).

import { describe, expect, it } from 'vitest';
import { createRecordingAisClient } from './ais-recording-client.js';
import { createFixtureAisClient } from './ais-fixture-client.js';
import type { AisClient, AisRequest } from '@mcpforge/adapter-function';

function fakeLiveClient(): AisClient {
  return {
    async call(req: AisRequest) {
      return {
        status: 200,
        body: JSON.stringify({ ok: true, echo: req.inputs }),
      };
    },
  };
}

describe('recording client → fixture set round trip', () => {
  it('captures every call as a fixture case, replayable afterward with no further calls to the live client', async () => {
    const recorder = createRecordingAisClient(fakeLiveClient());
    const request: AisRequest = {
      orchestration: 'Jde_SomeOrchestration',
      orchestrationVersion: '2',
      inputs: { amount: 100 },
      correlationId: 'rec-1',
      signal: new AbortController().signal,
    };

    const liveResponse = await recorder.call(request);
    const set = recorder.toFixtureSet('example-set', 'fake live client for machinery test');

    expect(set.source).toBe('recorded');
    expect(set.capturedAt).toBeDefined();
    expect(set.cases).toHaveLength(1);

    const replayClient = createFixtureAisClient(set);
    const replayed = await replayClient.call(request);

    expect(replayed).toEqual(liveResponse);
  });

  it('appends multiple recordings of the same key into sequence order', async () => {
    const recorder = createRecordingAisClient(fakeLiveClient());
    const request: AisRequest = {
      orchestration: 'Jde_SomeOrchestration',
      orchestrationVersion: '2',
      inputs: { amount: 100 },
      correlationId: 'rec-1',
      signal: new AbortController().signal,
    };

    await recorder.call(request);
    await recorder.call(request);
    const set = recorder.toFixtureSet('example-set', 'fake live client');

    expect(set.cases[0]?.sequence).toHaveLength(2);
  });
});
