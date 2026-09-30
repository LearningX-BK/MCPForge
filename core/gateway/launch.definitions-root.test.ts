// W0-P33a — the definitions root and the install root may live apart.
//
// On the VM the definitions are a git clone mounted beside the code
// (docs/build-plan/w0-p33-portal-merge.md §2.1), while `.mcpforge/` (the
// runtime store, sealed secrets, the probe report) stays with the install.
// Proven here: a gateway whose install root holds NO definitions at all
// launches from a separate definitions root, and writes its runtime state
// under the install root, never into the definitions.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchGateway, type LaunchedGateway } from './launch.js';
import { launchRepo, removeLaunchRepo } from './launch.test-support.js';
import { EncryptedFileStore } from './secrets/server.js';
import { generateTestConsumerKeypair } from './transport/consumer-auth/testkit.js';

const SECRETS_ENV = { MCPFORGE_SECRETS_KEY: 'w0-p33a-test-only-sealing-passphrase' };

describe('W0-P33a — definitions root apart from the install root', () => {
  let defs: string;
  let install: string;
  let launched: LaunchedGateway;

  beforeAll(async () => {
    defs = launchRepo({
      keypair: await generateTestConsumerKeypair(),
      aisBaseUrl: 'http://127.0.0.1:9/unused',
      aisTokenUrl: 'http://127.0.0.1:9/unused',
      grantRefs: [],
    });
    install = mkdtempSync(join(tmpdir(), 'mcpforge-p33a-install-'));
    launched = await launchGateway({
      repoRoot: install,
      definitionsRoot: defs,
      mode: 'headless',
      secretStore: new EncryptedFileStore({ repoRoot: install, env: SECRETS_ENV }),
      flagPollMs: 50,
    });
  }, 180_000);

  afterAll(async () => {
    await launched?.close();
    if (defs) removeLaunchRepo(defs);
    if (install) rmSync(install, { recursive: true, force: true });
  });

  it('launches from the definitions root although the install root has none', async () => {
    const res = await fetch(`http://127.0.0.1:${launched.gatewayPort}/api/v1/deployment`);
    // The front door answers (and refuses an unauthenticated caller): the
    // gateway is up, serving a catalogue it could only have read from `defs`.
    expect(res.status).toBe(401);
    expect(existsSync(join(install, 'manifests'))).toBe(false);
  });

  it('writes runtime state under the install root, never into the definitions', () => {
    expect(existsSync(join(install, '.mcpforge', 'runtime.db'))).toBe(true);
    expect(existsSync(join(defs, '.mcpforge', 'runtime.db'))).toBe(false);
  });

  it('refuses to start when the definitions are missing, rather than serving an empty catalogue', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'mcpforge-p33a-empty-'));
    try {
      await expect(
        launchGateway({
          repoRoot: install,
          definitionsRoot: empty,
          mode: 'headless',
          secretStore: new EncryptedFileStore({ repoRoot: install, env: SECRETS_ENV }),
          storeConfig: { kind: 'sqlite', file: join(empty, 'runtime.db') },
        }),
      ).rejects.toThrow();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
