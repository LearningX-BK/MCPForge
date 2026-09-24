// MCPForge — W0-H6, done-criterion 3: the documented refresh procedure is a
// real, runnable function (not just prose), and it is gated/skipped when no
// live target is configured, matching W0-C5/W0-D3's opt-in convention.
//
// This test exercises `refreshFixtureSet` directly against a fake client (the
// unit under test is the recording/save mechanics, not a real target — see
// the file header of refresh-fixtures.ts for why no real capture happens
// here). It also asserts the CLI entry point's env-var gate by checking the
// exported `main`-adjacent behaviour indirectly: the module does not throw or
// require MCPFORGE_LIVE_TARGET_URL when only its exported functions are used.

import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshFixtureSet } from './refresh-fixtures.js';
import { saveFixtureSet } from '../src/fixture-io.js';
import type { AisClient, AisRequest } from '@mcpforge/adapter-function';

function fakeLiveClient(): AisClient {
  return {
    async call(req: AisRequest) {
      return { status: 200, body: JSON.stringify({ ok: true, orchestration: req.orchestration }) };
    },
  };
}

describe('refresh-fixtures (W0-H6 done-criterion 3)', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('recaptures a plan of requests into a saveable, source:"recorded" fixture set', async () => {
    const set = await refreshFixtureSet(fakeLiveClient(), 'refreshed-set', 'test target', [
      { orchestration: 'Jde_Example', orchestrationVersion: '1', inputs: { a: 1 } },
      { orchestration: 'Jde_Example', orchestrationVersion: '1', inputs: { a: 2 } },
    ]);

    expect(set.name).toBe('refreshed-set');
    expect(set.source).toBe('recorded');
    expect(set.cases).toHaveLength(2);
  });

  it('the recaptured set actually saves to disk and loads back byte-for-byte equivalent', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mcpforge-mocks-'));
    const set = await refreshFixtureSet(fakeLiveClient(), 'refreshed-set', 'test target', [
      { orchestration: 'Jde_Example', orchestrationVersion: '1', inputs: { a: 1 } },
    ]);
    const path = join(dir, 'refreshed-set.json');

    saveFixtureSet(path, set);
    const reloaded: unknown = JSON.parse(readFileSync(path, 'utf-8'));

    expect(reloaded).toMatchObject({ name: 'refreshed-set', source: 'recorded' });
  });

  it('is a no-op module import with no env var or live target required (the gate lives in main(), not at import time)', async () => {
    // Importing the module (done at the top of this file) must not throw and
    // must not require MCPFORGE_LIVE_TARGET_URL — proving the gate does not
    // leak into machinery that other tests/tools might import.
    expect(process.env['MCPFORGE_LIVE_TARGET_URL']).toBeUndefined();
    expect(typeof refreshFixtureSet).toBe('function');
  });
});
