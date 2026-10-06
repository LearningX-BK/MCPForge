// W0-P33d — the portal-triggered capability probe, against the REAL launched
// gateway.
//
// Decision D of the approved W0-P33 design note (owner, 30 Sep 2026: "Local
// and dev only (Recommended)"): a super admin may start the probe from the
// portal when the deployment's environment class is `local`; elsewhere it stays
// a CLI act. Every attempt below that is not the one authorized local run must
// FAIL CLOSED:
//
//   * a human who is not a super admin is refused, audited, no report written;
//   * a super admin through a consumer with no human in its loop is refused;
//   * no consumer, or no human, never reaches the probe at all;
//   * in a `probe`, `staging` or `prod` deployment even a super admin through
//     the portal's kind of consumer is refused, with a next naming
//     `forge probe`, audited, and no report written;
//   * and the authorized run probes the DEFINITIONS root, writes its report
//     under the INSTALL root only (W0-P33a's split), records the hash-chained
//     `probe` row carrying the report's sha256 BEFORE the report exists, then
//     reloads so the gateway serves the new statuses: a session that saw no
//     tools (no report: nothing visible) is told list_changed and now lists
//     and reads them.
//
// The world is the W0-P11 one: the local mock JDE over real HTTP, and the
// REAL probe (`probeDeployment`, the one `forge probe` runs) against it.

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  apiErrorSchema,
  PROBE_RUN_PATH,
  probeRunResponseSchema,
} from '../../core/shared/src/api/v1/index.js';
import { probeReportPath } from '../../core/probe/src/index.js';
import { loadAisTargetsOverlay } from '../../adapters/function/src/index.js';
import { loadRuntimeCatalogue } from '../../core/gateway/assembly/index.js';
import { launchGateway, type LaunchedGateway } from '../../core/gateway/launch.js';
import {
  launchRepo,
  REPO_ROOT,
  removeLaunchRepo,
  TEST_CONSUMER,
  TEST_GROUP,
} from '../../core/gateway/launch.test-support.js';
import { EncryptedFileStore } from '../../core/gateway/secrets/server.js';
import { parseSecretRef } from '../../core/gateway/secrets/index.js';
import { localUserStore } from '../../core/gateway/identity/index.js';
import {
  generateTestConsumerKeypair,
  signTestAssertion,
  testConsumerRecord,
  type TestKeypair,
} from '../../core/gateway/transport/consumer-auth/testkit.js';
import { MCPFORGE_CONSUMER_ASSERTION_HEADER } from '../../core/gateway/transport/index.js';
import type { AuditCallRecord } from '../../core/gateway/store/audit/types.js';

const AUDIENCE = 'https://mcpforge.local/mcp';
const SECRETS_ENV = { MCPFORGE_SECRETS_KEY: 'w0-p33d-test-only-sealing-passphrase' };
const CLERK_SUBJECT = 'local:p33d-clerk';
const SUPER_SUBJECT = 'local:p33d-super';
/** The committed overlay's designated probe identity (W0-P21). */
const PROBE_IDENTITY = 'mcpforge-probe@ltm.example';
const SUPER_GROUP = 'mcpforge-superadmins';
const BOT_CONSUMER = 'bot-agent';
const PASSWORD = 'a-long-enough-test-password-1';
const CLIENTS = {
  'mcpforge-local-jde-fin-ap': 'p33d-secret-ap',
  'mcpforge-local-jde-fin-gl': 'p33d-secret-gl',
  'mcpforge-local-jde-scm-po': 'p33d-secret-po',
};
const VOUCHER_GET = 'jde.ap.voucher.get';
/** In the p2p role's resident core set, so `tools/list` shows it once probed. */
const VOUCHER_SEARCH = 'jde.ap.voucher.search';

interface MockJde {
  readonly baseUrl: string;
  readonly tokenUrl: string;
  close(): Promise<void>;
}

async function startMockJde(versions: Record<string, string>): Promise<MockJde> {
  const url = pathToFileURL(join(REPO_ROOT, 'tests', 'mocks', 'src', 'mock-jde', 'server.ts'));
  const mod = (await import(url.href)) as {
    startMockJde(config: {
      users: string[];
      clients: Record<string, string>;
      versions: Record<string, string>;
    }): Promise<MockJde>;
  };
  return mod.startMockJde({
    users: [CLERK_SUBJECT, PROBE_IDENTITY],
    clients: { ...CLIENTS },
    versions,
  });
}

async function eventually(check: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('W0-P33d — the portal probe is super-admin only, local only, audited, and served', () => {
  let jde: MockJde;
  /** The DEFINITIONS root: what is probed. */
  let defs: string;
  /** The INSTALL root: the store, the vault, and where the report lands. */
  let install: string;
  const extraDirs: string[] = [];
  let launched: LaunchedGateway;
  let keypair: TestKeypair;
  let botKeypair: TestKeypair;
  let base: string;
  const clients: Client[] = [];

  async function seedSecrets(root: string): Promise<EncryptedFileStore> {
    const secrets = new EncryptedFileStore({ repoRoot: root, env: SECRETS_ENV });
    const overlay = loadAisTargetsOverlay(join(defs, 'overlays', 'local', 'ais-targets.yaml'));
    for (const target of overlay.servers.values()) {
      await secrets.put(
        parseSecretRef(target.clientCredentialRef),
        CLIENTS[target.clientId as keyof typeof CLIENTS],
      );
    }
    return secrets;
  }

  async function addUsers(gateway: LaunchedGateway): Promise<void> {
    const users = localUserStore({ store: gateway.store });
    await users.createUser({
      username: 'p33d-clerk',
      displayName: 'Clerk',
      password: PASSWORD,
      groups: [TEST_GROUP],
      subject: CLERK_SUBJECT,
    });
    await users.createUser({
      username: 'p33d-super',
      displayName: 'Super',
      password: PASSWORD,
      groups: [SUPER_GROUP],
      subject: SUPER_SUBJECT,
    });
  }

  beforeAll(async () => {
    const catalogue = await loadRuntimeCatalogue({ repoRoot: REPO_ROOT });
    const versions: Record<string, string> = {};
    for (const t of catalogue.tools.values()) {
      const d = t.functionDescriptor;
      if (d !== undefined && d.refVersion !== null) versions[d.ref] = d.refVersion;
    }
    jde = await startMockJde(versions);
    keypair = await generateTestConsumerKeypair();
    botKeypair = await generateTestConsumerKeypair('bot-a');
    const refs = [...catalogue.tools.values()]
      .map((t) => t.functionDescriptor?.ref)
      .filter((r): r is string => r !== undefined);
    defs = launchRepo({
      keypair,
      aisBaseUrl: jde.baseUrl,
      aisTokenUrl: jde.tokenUrl,
      grantRefs: refs,
    });

    // A super-admin group, in git, like W0-P31's.
    writeFileSync(
      join(defs, 'overlays', 'local', 'mappings', 'groups-to-roles.yaml'),
      [
        'apiVersion: mcpforge/v1',
        'kind: GroupRoleMapping',
        'deployment: local',
        'groups:',
        '  local:',
        `    ${TEST_GROUP}:`,
        '      roles: [p2p]',
        `    ${SUPER_GROUP}:`,
        '      roles: [super-admin]',
        'superAdmins:',
        '  local:',
        `    - ${SUPER_GROUP}`,
        '',
      ].join('\n'),
    );

    // An autonomous agent: allowed to write, but with NO human in its loop.
    const bot = testConsumerRecord({
      id: BOT_CONSUMER,
      writeAllowed: true,
      maxSensitivity: 'financial',
      publicKeys: [
        {
          kid: botKeypair.kid,
          kty: 'OKP',
          crv: 'Ed25519',
          x: botKeypair.publicJwk.x,
          addedAt: '2026-08-27',
        },
      ],
    });
    const botRecord = {
      ...bot,
      authorizations: { ...bot.authorizations, bindingTypes: ['function'] },
      attestation: { humanInTheLoop: false },
    };
    writeFileSync(
      join(defs, 'consumers', `${BOT_CONSUMER}.consumer.yaml`),
      JSON.stringify(botRecord, null, 2),
    );
    writeFileSync(
      join(defs, 'generated', 'consumers', `${BOT_CONSUMER}.authorization.json`),
      JSON.stringify({
        consumerId: BOT_CONSUMER,
        effectiveStatus: 'active',
        authorizations: botRecord.authorizations,
        attestation: { humanInTheLoop: false },
        bindingGrants: [],
      }),
    );

    // The install root is separate, and starts with NO probe report.
    install = mkdtempSync(join(tmpdir(), 'mcpforge-p33d-install-'));
    const secrets = await seedSecrets(install);
    launched = await launchGateway({
      repoRoot: install,
      definitionsRoot: defs,
      mode: 'headless',
      environmentClass: 'local',
      secretStore: secrets,
      flagPollMs: 50,
    });
    base = `http://127.0.0.1:${launched.gatewayPort}`;
    await addUsers(launched);
  }, 240_000);

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await launched?.close();
    await jde?.close();
    if (defs) removeLaunchRepo(defs);
    if (install) rmSync(install, { recursive: true, force: true });
    for (const d of extraDirs) rmSync(d, { recursive: true, force: true });
  });

  async function bearer(gateway: LaunchedGateway, subject: string): Promise<string> {
    return (await gateway.identity.issueToken(subject, ['pwd'], 'p33d')).token;
  }

  async function assertion(consumer: 'test' | 'bot'): Promise<string> {
    return signTestAssertion(
      consumer === 'test'
        ? { consumerId: TEST_CONSUMER, audience: AUDIENCE, keypair }
        : { consumerId: BOT_CONSUMER, audience: AUDIENCE, keypair: botKeypair },
    );
  }

  async function probe(
    who: { subject?: string; consumer?: 'test' | 'bot' },
    options: { method?: string; gateway?: LaunchedGateway } = {},
  ): Promise<{ status: number; body: unknown }> {
    const gateway = options.gateway ?? launched;
    const headers: Record<string, string> = {};
    if (who.consumer !== undefined) {
      headers[MCPFORGE_CONSUMER_ASSERTION_HEADER] = await assertion(who.consumer);
    }
    if (who.subject !== undefined) {
      headers['authorization'] = `Bearer ${await bearer(gateway, who.subject)}`;
    }
    const res = await fetch(`http://127.0.0.1:${gateway.gatewayPort}${PROBE_RUN_PATH}`, {
      method: options.method ?? 'POST',
      headers,
    });
    return { status: res.status, body: (await res.json()) as unknown };
  }

  async function rows(gateway: LaunchedGateway = launched): Promise<AuditCallRecord[]> {
    return gateway.store.audit.listChain('local');
  }
  async function probeRows(gateway: LaunchedGateway = launched): Promise<AuditCallRecord[]> {
    return (await rows(gateway)).filter((r) => r.phase === 'probe');
  }

  async function connectClerk(): Promise<{ client: Client; listChanged: () => number }> {
    const client = new Client({ name: 'w0-p33d', version: '0.0.0' });
    let changes = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      changes += 1;
    });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: {
          headers: {
            [MCPFORGE_CONSUMER_ASSERTION_HEADER]: await assertion('test'),
            authorization: `Bearer ${await bearer(launched, CLERK_SUBJECT)}`,
          },
        },
      }) as unknown as Transport,
    );
    clients.push(client);
    return { client, listChanged: () => changes };
  }

  it('a human who is not a super admin is refused with a next, audited, and no report is written', async () => {
    const r = await probe({ subject: CLERK_SUBJECT, consumer: 'test' });
    expect(r.status).toBe(403);
    const e = apiErrorSchema.parse(r.body).error;
    expect(e.code).toBe('TOOL_NOT_IN_SCOPE');
    expect(e.next).toContain('super admin');
    expect((await probeRows()).at(-1)).toMatchObject({
      callerSubject: CLERK_SUBJECT,
      outcome: 'policy_denied',
      deniedByRule: 'probe.not_super_admin',
      toolId: 'forge.probe.run',
      isWrite: false,
    });
    expect(existsSync(probeReportPath(install))).toBe(false);
  });

  it('a super admin through a consumer with no human in its loop is refused, audited', async () => {
    const r = await probe({ subject: SUPER_SUBJECT, consumer: 'bot' });
    expect(r.status).toBe(403);
    const e = apiErrorSchema.parse(r.body).error;
    expect(e.code).toBe('CONSUMER_NOT_AUTHORIZED');
    expect(e.next).toContain('forge probe');
    expect((await probeRows()).at(-1)).toMatchObject({
      callerSubject: SUPER_SUBJECT,
      consumerId: BOT_CONSUMER,
      outcome: 'policy_denied',
      deniedByRule: 'probe.consumer_not_authorized',
    });
    expect(existsSync(probeReportPath(install))).toBe(false);
  });

  it('no consumer, or no human, never reaches the probe: refused at the front door, nothing audited', async () => {
    const before = (await probeRows()).length;
    const noConsumer = await probe({ subject: SUPER_SUBJECT });
    expect(noConsumer.status).toBe(401);
    expect(apiErrorSchema.parse(noConsumer.body).error.code).toBe('CONSUMER_UNREGISTERED');
    const noHuman = await probe({ consumer: 'test' });
    expect(noHuman.status).toBeGreaterThanOrEqual(401);
    expect(noHuman.status).toBeLessThan(404);
    expect(apiErrorSchema.parse(noHuman.body).error.next.length).toBeGreaterThan(0);
    const get = await probe({ subject: SUPER_SUBJECT, consumer: 'test' }, { method: 'GET' });
    expect(get.status).toBe(405);
    expect((await probeRows()).length).toBe(before);
    expect(existsSync(probeReportPath(install))).toBe(false);
  });

  for (const environmentClass of ['probe', 'staging', 'prod'] as const) {
    it(`in a ${environmentClass} deployment even a super admin through the portal's kind of consumer is refused, with a next naming forge probe`, async () => {
      const otherInstall = mkdtempSync(join(tmpdir(), `mcpforge-p33d-${environmentClass}-`));
      extraDirs.push(otherInstall);
      const other = await launchGateway({
        repoRoot: otherInstall,
        definitionsRoot: defs,
        mode: 'headless',
        environmentClass,
        secretStore: await seedSecrets(otherInstall),
      });
      try {
        await addUsers(other);
        const r = await probe({ subject: SUPER_SUBJECT, consumer: 'test' }, { gateway: other });
        expect(r.status).toBe(403);
        const e = apiErrorSchema.parse(r.body).error;
        expect(e.code).toBe('PROBE_ENVIRONMENT_REFUSED');
        expect(e.message).toContain(environmentClass);
        expect(e.next).toContain(`forge probe --env ${environmentClass} --deployment local`);
        expect((await probeRows(other)).at(-1)).toMatchObject({
          callerSubject: SUPER_SUBJECT,
          outcome: 'policy_denied',
          errorCode: 'PROBE_ENVIRONMENT_REFUSED',
          deniedByRule: 'probe.environment_not_portal',
        });
        // No run, no report, no reload.
        expect(existsSync(probeReportPath(otherInstall))).toBe(false);
        expect((await rows(other)).some((row) => row.phase === 'catalogue')).toBe(false);
        expect((await other.store.audit.verifyChain('local')).status).toBe('intact');
      } finally {
        await other.close();
      }
    }, 120_000);
  }

  it('a super admin in a local deployment runs it: definitions probed, report under the install root, audited first, then served', async () => {
    // Before: no report, so the clerk is served only the meta-tools (02 §4.5).
    const { client, listChanged } = await connectClerk();
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
      'forge.find',
      'forge.describe',
      'forge.activate',
      'forge.invoke',
    ]);

    const r = await probe({ subject: SUPER_SUBJECT, consumer: 'test' });
    expect(r.status).toBe(200);
    const ran = probeRunResponseSchema.parse(r.body);
    expect(ran).toMatchObject({
      deploymentId: 'local',
      environmentClass: 'local',
      targetId: 'local',
      toolCount: 11,
      byStatus: { resolved: 11 },
      enablement: { served: true, generation: 2 },
    });
    expect(ran.next).toContain('generation 2 serves it');

    // The report is under the INSTALL root, and the definitions clone is untouched.
    expect(existsSync(probeReportPath(install))).toBe(true);
    expect(existsSync(probeReportPath(defs))).toBe(false);
    const written = readFileSync(probeReportPath(install), 'utf8');

    // Evidence before effect: the probe row, then the reload's catalogue row.
    const all = await rows();
    const probeRow = all.find((row) => row.id === ran.auditCallId)!;
    expect(probeRow).toMatchObject({
      phase: 'probe',
      outcome: 'ok',
      callerSubject: SUPER_SUBJECT,
      consumerId: TEST_CONSUMER,
      toolId: 'forge.probe.run',
      isWrite: false,
    });
    expect(probeRow.resultKeys).toContainEqual({
      keyName: 'probeReportSha256',
      keyValue: createHash('sha256').update(written).digest('hex'),
    });
    const reloadRow = all.find((row) => row.id === ran.enablement.reloadAuditCallId)!;
    expect(reloadRow).toMatchObject({ phase: 'catalogue', outcome: 'ok' });
    expect(all.indexOf(probeRow)).toBeLessThan(all.indexOf(reloadRow));
    // `verified` is the probe's word, in its report, and nowhere in git.
    expect(
      readFileSync(join(defs, 'manifests', 'jde', 'fin', 'ap', 'voucher.get.tool.yaml'), 'utf8'),
    ).not.toMatch(/carries:\s*verified/);

    // Served: the live session is told, lists the tools, and reads.
    await eventually(() => listChanged() >= 1);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain(VOUCHER_SEARCH);
    const read = (await client.callTool({
      name: VOUCHER_GET,
      arguments: { document_number: '70001', document_type: 'PV', document_company: '00100' },
    })) as { isError?: boolean };
    expect(read.isError).not.toBe(true);

    // The enablement read now reports the run.
    const enablement = await fetch(`${base}/api/v1/enablement`, {
      headers: {
        authorization: `Bearer ${await bearer(launched, SUPER_SUBJECT)}`,
        [MCPFORGE_CONSUMER_ASSERTION_HEADER]: await assertion('test'),
      },
    });
    const body = (await enablement.json()) as { probe: { finishedAt: string } | null };
    expect(body.probe?.finishedAt).toBe(ran.finishedAt);

    expect((await launched.store.audit.verifyChain('local')).status).toBe('intact');
  }, 120_000);
});
