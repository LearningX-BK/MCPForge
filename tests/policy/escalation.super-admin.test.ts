// W0-P31 — the super admin holds every tool, and is still inside the rules.
//
// Owner decision, 30 Sep 2026: "Everything, inside the rules". The super-admin
// role (roles/super-admin.yaml, compiled to every tool id) is a grant like any
// other, so what a super admin may see is still the INTERSECTION with the
// consumer holding the session (non-negotiable 6). Proven here against the
// real launched gateway through `/api/v1/enablement`, which lists exactly the
// viewer's read authority (Deployed ∩ Granted ∩ ConsumerAuthorized).

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enablementResponseSchema } from '../../core/shared/src/api/v1/index.js';
import { launchGateway, type LaunchedGateway } from '../../core/gateway/launch.js';
import {
  launchRepo,
  removeLaunchRepo,
  TEST_CONSUMER,
  TEST_GROUP,
} from '../../core/gateway/launch.test-support.js';
import { EncryptedFileStore } from '../../core/gateway/secrets/server.js';
import { localUserStore } from '../../core/gateway/identity/index.js';
import {
  generateTestConsumerKeypair,
  signTestAssertion,
  testConsumerRecord,
  type TestKeypair,
} from '../../core/gateway/transport/consumer-auth/testkit.js';
import { MCPFORGE_CONSUMER_ASSERTION_HEADER } from '../../core/gateway/transport/index.js';

const AUDIENCE = 'https://mcpforge.local/mcp';
const SECRETS_ENV = { MCPFORGE_SECRETS_KEY: 'w0-p31-test-only-sealing-passphrase' };
const NARROW_CONSUMER = 'narrow-agent';
const SUPER_GROUP = 'mcpforge-superadmins';
const PASSWORD = 'a-long-enough-test-password-1';

describe('W0-P31 — a super admin sees every tool, and only through a consumer that allows it', () => {
  let repo: string;
  let launched: LaunchedGateway;
  let keypair: TestKeypair;
  let narrowKeypair: TestKeypair;
  let base: string;
  let catalogue: string[];

  beforeAll(async () => {
    keypair = await generateTestConsumerKeypair();
    narrowKeypair = await generateTestConsumerKeypair('narrow-a');
    repo = launchRepo({
      keypair,
      aisBaseUrl: 'http://127.0.0.1:9/unused',
      aisTokenUrl: 'http://127.0.0.1:9/unused',
      grantRefs: [],
    });
    writeFileSync(
      join(repo, 'overlays', 'local', 'mappings', 'groups-to-roles.yaml'),
      [
        'apiVersion: mcpforge/v1',
        'kind: GroupRoleMapping',
        'deployment: local',
        'groups:',
        `  ${TEST_GROUP}:`,
        '    roles: [p2p]',
        `  ${SUPER_GROUP}:`,
        '    roles: [super-admin]',
        'superAdmins:',
        `  - ${SUPER_GROUP}`,
        '',
      ].join('\n'),
    );
    catalogue = (
      JSON.parse(
        readFileSync(join(repo, 'generated', 'roles', 'super-admin.scope.json'), 'utf8'),
      ) as { toolIds: string[] }
    ).toolIds;

    // The same human through a consumer registered for nothing above `internal`.
    const narrow = testConsumerRecord({
      id: NARROW_CONSUMER,
      maxSensitivity: 'internal',
      publicKeys: [
        {
          kid: narrowKeypair.kid,
          kty: 'OKP',
          crv: 'Ed25519',
          x: narrowKeypair.publicJwk.x,
          addedAt: '2026-08-27',
        },
      ],
    });
    const narrowRecord = {
      ...narrow,
      authorizations: { ...narrow.authorizations, bindingTypes: ['function'] },
    };
    writeFileSync(
      join(repo, 'consumers', `${NARROW_CONSUMER}.consumer.yaml`),
      JSON.stringify(narrowRecord, null, 2),
    );
    writeFileSync(
      join(repo, 'generated', 'consumers', `${NARROW_CONSUMER}.authorization.json`),
      JSON.stringify({
        consumerId: NARROW_CONSUMER,
        effectiveStatus: 'active',
        authorizations: narrowRecord.authorizations,
        attestation: { humanInTheLoop: true },
        bindingGrants: [],
      }),
    );

    launched = await launchGateway({
      repoRoot: repo,
      mode: 'headless',
      secretStore: new EncryptedFileStore({ repoRoot: repo, env: SECRETS_ENV }),
      flagPollMs: 50,
    });
    base = `http://127.0.0.1:${launched.gatewayPort}`;
    const users = localUserStore({ store: launched.store });
    await users.createUser({
      username: 'p31-super',
      displayName: 'Super',
      password: PASSWORD,
      groups: [SUPER_GROUP],
    });
    await users.createUser({
      username: 'p31-clerk',
      displayName: 'Clerk',
      password: PASSWORD,
      groups: [TEST_GROUP],
    });
  }, 180_000);

  afterAll(async () => {
    await launched?.close();
    if (repo) removeLaunchRepo(repo);
  });

  async function visibleTools(username: string, consumer: 'test' | 'narrow'): Promise<string[]> {
    const token = await fetch(`${base}/auth/local/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD }),
    });
    const { accessToken } = (await token.json()) as { accessToken: string };
    const res = await fetch(`${base}/api/v1/enablement`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        [MCPFORGE_CONSUMER_ASSERTION_HEADER]: await signTestAssertion(
          consumer === 'test'
            ? { consumerId: TEST_CONSUMER, audience: AUDIENCE, keypair }
            : { consumerId: NARROW_CONSUMER, audience: AUDIENCE, keypair: narrowKeypair },
        ),
      },
    });
    expect(res.status).toBe(200);
    return enablementResponseSchema
      .parse(await res.json())
      .tools.map((t) => t.toolId)
      .sort();
  }

  it('the compiled super-admin role names every tool in the catalogue', () => {
    expect(catalogue.length).toBeGreaterThanOrEqual(11);
  });

  it('a super admin sees every tool through a consumer that allows them', async () => {
    expect(await visibleTools('p31-super', 'test')).toEqual([...catalogue].sort());
  });

  it('the same super admin sees only the internal-or-lower tools through a consumer capped at internal', async () => {
    const narrow = await visibleTools('p31-super', 'narrow');
    // The consumer's ceiling, not the role, decides: every financial tool drops out.
    const sensitivityOf = new Map<string, string>();
    for (const file of readdirSync(join(repo, 'manifests'), { recursive: true })) {
      const rel = String(file);
      if (!rel.endsWith('.tool.yaml')) continue;
      const text = readFileSync(join(repo, 'manifests', rel), 'utf8');
      const id = /^id:\s*(\S+)/m.exec(text)?.[1];
      const sensitivity = /^sensitivity:\s*(\w+)/m.exec(text)?.[1];
      if (id !== undefined && sensitivity !== undefined) sensitivityOf.set(id, sensitivity);
    }
    const atOrBelowInternal = catalogue
      .filter((id) => ['public', 'internal'].includes(sensitivityOf.get(id) ?? 'personal'))
      .sort();
    expect(narrow).toEqual(atOrBelowInternal);
    expect(narrow.length).toBeLessThan(catalogue.length);
  });

  it('an ordinary role holder is not widened by the super-admin role existing', async () => {
    const clerk = await visibleTools('p31-clerk', 'test');
    expect(clerk.length).toBeLessThanOrEqual(catalogue.length);
    const p2p = (
      JSON.parse(readFileSync(join(repo, 'generated', 'roles', 'p2p.scope.json'), 'utf8')) as {
        toolIds: string[];
      }
    ).toolIds;
    expect(clerk).toEqual([...p2p].sort());
  });
});
