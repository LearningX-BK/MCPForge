#!/usr/bin/env -S node --experimental-strip-types
// MCPForge — W0-H6: the documented, runnable fixture refresh procedure.
//
// WHAT THIS IS. A real script (`pnpm --filter @mcpforge/mocks run
// refresh:fixtures`), not prose. It re-captures a fixture set against a LIVE
// target by wrapping a real `AisClient` in `createRecordingAisClient` and
// replaying a scripted list of requests through it, then writing the result
// with `saveFixtureSet`.
//
// WHY IT DOES NOTHING BY DEFAULT. No live JDE/AIS instance exists in this
// build environment (02 §7.1 — dev is mocks-only; a real target is the probe
// tier). Matching W0-C5's Testcontainers-Postgres gate and W0-D3's
// Keycloak-container gate — both opt-in, both no-ops unless explicitly
// configured — this script is a no-op unless `MCPFORGE_LIVE_TARGET_URL` is
// set. Running it with no env var set prints what it WOULD do and exits 0.
//
// HOW A HUMAN/OPS RUN ACTUALLY RECAPTURES A SET:
//   1. Point MCPFORGE_LIVE_TARGET_URL at a real, non-production AIS server
//      (02 §7.1's "probe" or "staging" env — never production).
//   2. Provide a real `AisClient` implementation for that URL — this script's
//      `buildLiveAisClient` is the ONE function to replace; everything else
//      (recording, key derivation, fixture-file writing) is reused unchanged.
//   3. Run `pnpm --filter @mcpforge/mocks run refresh:fixtures -- <setName>`.
//   4. Diff and commit the resulting fixtures/**.json — it is versioned like
//      any other test data, so the diff is the review artefact.
//
// This script itself is exercised by `scripts/refresh-fixtures.test.ts`
// against a fake "live" client, proving the recording→save round trip works;
// that test does not require MCPFORGE_LIVE_TARGET_URL either.

import { createRecordingAisClient } from '../src/ais-recording-client.js';
import { saveFixtureSet } from '../src/fixture-io.js';
import type { AisClient } from '@mcpforge/adapter-function';

export interface RefreshPlanEntry {
  readonly orchestration: string;
  readonly orchestrationVersion: string | null;
  readonly inputs: Readonly<Record<string, unknown>>;
}

/**
 * Runs `plan` through `client`, recording every response, and returns the
 * fixture set ready to save. Exported so the test can exercise it without
 * touching argv/env/process.exit.
 */
export async function refreshFixtureSet(
  client: AisClient,
  setName: string,
  targetDescription: string,
  plan: readonly RefreshPlanEntry[],
): Promise<ReturnType<ReturnType<typeof createRecordingAisClient>['toFixtureSet']>> {
  const recorder = createRecordingAisClient(client);
  let seq = 0;
  for (const entry of plan) {
    seq += 1;
    await recorder.call({
      orchestration: entry.orchestration,
      orchestrationVersion: entry.orchestrationVersion,
      inputs: entry.inputs,
      correlationId: `refresh-${setName}-${seq}`,
      signal: new AbortController().signal,
    });
  }
  return recorder.toFixtureSet(setName, targetDescription);
}

/** Replace this with a real AisClient pointed at MCPFORGE_LIVE_TARGET_URL when one exists. */
function buildLiveAisClient(targetUrl: string): AisClient {
  throw new Error(
    `buildLiveAisClient is a placeholder — no live-AIS-client implementation ships in this ` +
      `repo yet because no real JDE/AIS instance exists in this build environment. Replace ` +
      `this function with a real HTTP-backed AisClient before pointing refresh:fixtures at ` +
      `${targetUrl}.`,
  );
}

async function main(): Promise<void> {
  const targetUrl = process.env['MCPFORGE_LIVE_TARGET_URL'];
  if (targetUrl === undefined || targetUrl.length === 0) {
    console.log(
      '[refresh-fixtures] MCPFORGE_LIVE_TARGET_URL is not set — nothing to do. ' +
        'This is expected in dev/CI (02 §7.1: dev is mocks-only, no live Oracle/JDE instance). ' +
        'Set MCPFORGE_LIVE_TARGET_URL to a real non-production AIS server URL and implement ' +
        'buildLiveAisClient() in this file to actually recapture a fixture set. Exiting 0.',
    );
    return;
  }

  const setName = process.argv[2];
  if (setName === undefined) {
    throw new Error('Usage: refresh-fixtures.ts <setName> (with MCPFORGE_LIVE_TARGET_URL set)');
  }

  const client = buildLiveAisClient(targetUrl);
  // A real run supplies its own request plan per set; left empty here because
  // there is no live client implementation to exercise it against yet.
  const plan: RefreshPlanEntry[] = [];
  const set = await refreshFixtureSet(client, setName, `Recorded from ${targetUrl}`, plan);
  saveFixtureSet(new URL(`../fixtures/recorded/ais/${setName}.json`, import.meta.url).pathname, set);
  console.log(`[refresh-fixtures] wrote fixtures/recorded/ais/${setName}.json`);
}

// Only run when invoked directly (not when imported by the test).
function isDirectInvocation(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === new URL(entry, 'file:').href;
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
