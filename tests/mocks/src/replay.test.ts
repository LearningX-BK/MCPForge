// MCPForge — W0-H6, done-criterion 1 & 4: a recorded fixture replays
// deterministically (same request in, same response out) with NO network
// call made, proven via `withNetworkGuard`. Uses the checked-in SYNTHETIC
// fixture set `fixtures/synthetic/ais/gl-journal-get-status.json` as its
// concrete example (done-criterion 4).

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadFixtureSet } from './fixture-io.js';
import { createFixtureAisClient } from './ais-fixture-client.js';
import { withNetworkGuard, NetworkCallAttemptedError } from './network-guard.js';
import type { AisRequest } from '@mcpforge/adapter-function';

const FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/synthetic/ais/gl-journal-get-status.json', import.meta.url),
);

function req(documentNumber: string, correlationId: string): AisRequest {
  return {
    orchestration: 'Jde_GetGLJournalStatus',
    orchestrationVersion: '1',
    inputs: { documentNumber },
    correlationId,
    signal: new AbortController().signal,
  };
}

describe('recorded-fixture replay (W0-H6)', () => {
  it('is loaded from a versioned JSON file on disk and marked synthetic', () => {
    const set = loadFixtureSet(FIXTURE_PATH);
    expect(set.source).toBe('synthetic');
    expect(set.cases.length).toBeGreaterThan(0);
  });

  it('replays the same request twice to the identical recorded response, with no network call', async () => {
    const set = loadFixtureSet(FIXTURE_PATH);
    const client = createFixtureAisClient(set);

    const [first, second] = await withNetworkGuard(async () => {
      const a = await client.call(req('J0001234', 'c1'));
      const b = await client.call(req('J0001234', 'c2'));
      return [a, b];
    });

    expect(first).toEqual(second);
    expect(JSON.parse(first!.body)).toMatchObject({ status: 'POSTED', documentNumber: 'J0001234' });
  });

  it('replays a precondition/target-error response exactly as recorded', async () => {
    const set = loadFixtureSet(FIXTURE_PATH);
    const client = createFixtureAisClient(set);

    const response = await withNetworkGuard(() => client.call(req('J9999999', 'c1')));

    expect(response.targetError).toBeDefined();
    expect(response.targetError?.precondition).toBe(true);
  });

  it('advances through a recorded sequence on repeated calls to the same key', async () => {
    const set = loadFixtureSet(FIXTURE_PATH);
    const client = createFixtureAisClient(set);

    const first = await client.call(req('J0005555', 'c1'));
    const second = await client.call(req('J0005555', 'c2'));
    const third = await client.call(req('J0005555', 'c3')); // beyond recorded length -> repeats last

    expect(JSON.parse(first.body)).toMatchObject({ status: 'PENDING' });
    expect(JSON.parse(second.body)).toMatchObject({ status: 'POSTED' });
    expect(JSON.parse(third.body)).toMatchObject({ status: 'POSTED' });
  });

  it('throws FixtureMissError, never a silent fallback, for an unrecorded request', async () => {
    const set = loadFixtureSet(FIXTURE_PATH);
    const client = createFixtureAisClient(set);

    await expect(client.call(req('J-NEVER-RECORDED', 'c1'))).rejects.toThrow(/No fixture case/);
  });

  it('the network guard itself actually fails a call that reaches fetch', async () => {
    await expect(
      withNetworkGuard(async () => {
        await fetch('https://example.invalid/should-never-be-called');
      }),
    ).rejects.toBeInstanceOf(NetworkCallAttemptedError);
  });
});
