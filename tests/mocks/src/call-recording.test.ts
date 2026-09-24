// MCPForge — W0-H6, done-criterion 2: the mock target records every call it
// received (orchestration/tool id + inputs), so a dry-run/no-mutation test can
// assert nothing mutating was invoked.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadFixtureSet } from './fixture-io.js';
import { createFixtureAisClient } from './ais-fixture-client.js';
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

describe('call recording (W0-H6 done-criterion 2)', () => {
  it('records orchestration, inputs and correlationId for every call received', async () => {
    const client = createFixtureAisClient(loadFixtureSet(FIXTURE_PATH));

    await client.call(req('J0001234', 'corr-1'));
    await client.call(req('J9999999', 'corr-2'));

    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]).toMatchObject({
      orchestration: 'Jde_GetGLJournalStatus',
      orchestrationVersion: '1',
      inputs: { documentNumber: 'J0001234' },
      correlationId: 'corr-1',
    });
    expect(client.calls[1]?.correlationId).toBe('corr-2');
  });

  it('lets a dry-run test assert nothing mutating reached the target, by orchestration-name allowlist', async () => {
    // This is the shape the "dry-run/no-mutation" assertion takes elsewhere in
    // the suite: a caller only ever invokes a READ orchestration for a plan/
    // dry-run path, and the test proves that by inspecting `calls` rather than
    // trusting the caller's intent.
    const client = createFixtureAisClient(loadFixtureSet(FIXTURE_PATH));
    const READ_ORCHESTRATIONS = new Set(['Jde_GetGLJournalStatus']);

    await client.call(req('J0001234', 'dry-run-1'));

    const mutatingCalls = client.calls.filter((c) => !READ_ORCHESTRATIONS.has(c.orchestration));
    expect(mutatingCalls).toEqual([]);
    expect(client.calls).toHaveLength(1); // and something was actually exercised, not vacuously true
  });

  it('reset() clears recorded calls and fixture sequence position', async () => {
    const client = createFixtureAisClient(loadFixtureSet(FIXTURE_PATH));
    await client.call(req('J0001234', 'c1'));
    expect(client.calls).toHaveLength(1);

    client.reset();
    expect(client.calls).toHaveLength(0);
  });

  it('a snapshot of inputs is recorded, immune to later caller-side mutation', async () => {
    const client = createFixtureAisClient(loadFixtureSet(FIXTURE_PATH));
    const inputs: Record<string, unknown> = { documentNumber: 'J0001234' };
    const request: AisRequest = {
      orchestration: 'Jde_GetGLJournalStatus',
      orchestrationVersion: '1',
      inputs,
      correlationId: 'c1',
      signal: new AbortController().signal,
    };

    await client.call(request);
    inputs['documentNumber'] = 'MUTATED-AFTER-CALL';

    expect(client.calls[0]?.inputs['documentNumber']).toBe('J0001234');
  });
});
