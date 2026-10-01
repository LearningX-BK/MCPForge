// W0-P33c — the gateway catalogue reload, against the REAL launched gateway.
//
// Decision C of the approved W0-P33 design note (owner, 30 Sep 2026): a reload
// endpoint, callable only by a super admin through the portal's consumer, that
// re-runs `loadRuntimeCatalogue` on the definitions root and swaps the served
// catalogue in only if it loads cleanly. Every attempt below that is not the
// one authorized, clean reload must FAIL CLOSED:
//
//   * a human who is not a super admin is refused, audited, nothing changes;
//   * a super admin through a consumer with no human in its loop is refused;
//   * no consumer, or no human, never reaches the reload at all;
//   * definitions that do not validate are refused, the OLD catalogue keeps
//     serving (a live session still lists and reads), and the refusal says why;
//   * a tool changed WITHOUT a version bump is refused, because the version is
//     what a minted plan binds;
//   * and when a clean reload does swap a changed tool in, a plan minted BEFORE
//     it cannot be confirmed AFTER it: PLAN_ARGUMENT_MISMATCH, nothing reaches
//     the target, while the live session was told `tools/list_changed`.
//
// The world is the W0-P11 one: the local mock JDE over real HTTP and a probe
// report written by the REAL probe against it, so visibility and validate-pair
// evidence come from a probe, not a hand-written file. Codegen is the REAL
// `runCodegen`, run on the gateway's own definitions root, as Merge runs it.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { runCodegen } from '@mcpforge/codegen/emit';
import {
  apiErrorSchema,
  CATALOGUE_RELOAD_PATH,
  catalogueReloadRefusalSchema,
  catalogueReloadResponseSchema,
  deploymentResponseSchema,
} from '../../core/shared/src/api/v1/index.js';
import {
  createFunctionProbeExecutor,
  probeInputsFromCatalogue,
  runProbe,
  writeProbeReport,
  type ProbeToolDetail,
} from '../../core/probe/src/index.js';
import {
  createHttpAisClient,
  createHttpAisTokenProvider,
  loadAisTargetsOverlay,
} from '../../adapters/function/src/index.js';
import { loadCatalogueIndex } from '../../core/registry/src/index/server.js';
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
const SECRETS_ENV = { MCPFORGE_SECRETS_KEY: 'w0-p33c-test-only-sealing-passphrase' };
const CLERK_SUBJECT = 'local:p33c-clerk';
const SUPER_SUBJECT = 'local:p33c-super';
const PROBE_SUBJECT = 'local:p33c-probe';
const SUPER_GROUP = 'mcpforge-superadmins';
const BOT_CONSUMER = 'bot-agent';
const PASSWORD = 'a-long-enough-test-password-1';
const CLIENTS = {
  'mcpforge-local-jde-fin-ap': 'p33c-secret-ap',
  'mcpforge-local-jde-fin-gl': 'p33c-secret-gl',
  'mcpforge-local-jde-scm-po': 'p33c-secret-po',
};
const JOURNAL = 'jde.fin.journal.create';
const JOURNAL_MANIFEST = join('manifests', 'jde', 'fin', 'gl', 'journal.create.tool.yaml');
const VOUCHER_GET = 'jde.ap.voucher.get';
const JOURNAL_ARGS = {
  company: '00001',
  document_type: 'JE',
  gl_date: '2026-10-01',
  account_number: '1.1110',
  amount: 900,
  currency: 'GBP',
};

interface MockJde {
  readonly baseUrl: string;
  readonly tokenUrl: string;
  ran(): readonly { readonly orchestration?: string; readonly executedAs?: string }[];
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
    users: [CLERK_SUBJECT, PROBE_SUBJECT],
    clients: { ...CLIENTS },
    versions,
  });
}

function parse(result: unknown): { isError: boolean; body: Record<string, unknown> } {
  const r = result as { isError?: boolean; content: { text: string }[] };
  return {
    isError: r.isError === true,
    body: JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>,
  };
}

async function eventually(check: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('W0-P33c — the catalogue reload is super-admin only, audited, and all or nothing', () => {
  let jde: MockJde;
  let repo: string;
  let launched: LaunchedGateway;
  let keypair: TestKeypair;
  let botKeypair: TestKeypair;
  let refs: string[];
  let base: string;
  /** The compiled authorizations each test consumer must have after any codegen. */
  const compiled = new Map<string, { authorizations: unknown; humanInTheLoop: boolean }>();
  const clients: Client[] = [];

  /** What launchRepo hand-patched into generated/, re-applied after every real codegen. */
  function repatchGenerated(): void {
    const roleFile = join(repo, 'generated', 'roles', 'p2p.scope.json');
    const role = JSON.parse(readFileSync(roleFile, 'utf8')) as {
      bindingGrants: { names: string[] }[];
    };
    role.bindingGrants[0]!.names = [...refs];
    writeFileSync(roleFile, JSON.stringify(role));
    for (const [id, c] of compiled) {
      writeFileSync(
        join(repo, 'generated', 'consumers', `${id}.authorization.json`),
        JSON.stringify({
          consumerId: id,
          effectiveStatus: 'active',
          authorizations: c.authorizations,
          attestation: { humanInTheLoop: c.humanInTheLoop },
          bindingGrants: [],
        }),
      );
    }
  }

  async function codegen(): Promise<void> {
    await runCodegen(repo);
    repatchGenerated();
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
    refs = [...catalogue.tools.values()]
      .map((t) => t.functionDescriptor?.ref)
      .filter((r): r is string => r !== undefined);
    repo = launchRepo({
      keypair,
      aisBaseUrl: jde.baseUrl,
      aisTokenUrl: jde.tokenUrl,
      grantRefs: refs,
    });

    // A super-admin group, in git, like W0-P31's.
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

    // The test consumer exactly as launchRepo compiled it.
    const test = testConsumerRecord({
      id: TEST_CONSUMER,
      writeAllowed: true,
      maxSensitivity: 'financial',
    });
    compiled.set(TEST_CONSUMER, {
      authorizations: { ...test.authorizations, bindingTypes: ['function'] },
      humanInTheLoop: true,
    });
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
    // JSON is YAML: the registry reads it as any other record.
    writeFileSync(
      join(repo, 'consumers', `${BOT_CONSUMER}.consumer.yaml`),
      JSON.stringify(botRecord, null, 2),
    );
    compiled.set(BOT_CONSUMER, { authorizations: botRecord.authorizations, humanInTheLoop: false });
    repatchGenerated();

    // Seed the binding credentials and run the REAL probe against the mock.
    const secrets = new EncryptedFileStore({ repoRoot: repo, env: SECRETS_ENV });
    const overlay = loadAisTargetsOverlay(join(repo, 'overlays', 'local', 'ais-targets.yaml'));
    for (const target of overlay.servers.values()) {
      await secrets.put(
        parseSecretRef(target.clientCredentialRef),
        CLIENTS[target.clientId as keyof typeof CLIENTS],
      );
    }
    const gl = overlay.servers.get('jde-fin-gl')!;
    const tokens = createHttpAisTokenProvider({
      tokenUrl: gl.tokenUrl,
      clientId: gl.clientId,
      clientCredential: { ref: parseSecretRef(gl.clientCredentialRef), secretStore: secrets },
    });
    const details = new Map<string, ProbeToolDetail>(
      [...catalogue.tools.values()].map((t) => [
        t.toolId,
        {
          ref: t.functionDescriptor?.ref ?? t.entry.bindingRef,
          refVersion: t.functionDescriptor?.refVersion ?? null,
          owningTeam: 'JDE Finance CoE',
          testIdentity: PROBE_SUBJECT,
        },
      ]),
    );
    const report = await runProbe({
      target: { id: 'mock-jde', environmentClass: 'local', deploymentId: 'local' },
      tools: probeInputsFromCatalogue(loadCatalogueIndex(repo), details),
      executors: new Map([
        [
          'function',
          createFunctionProbeExecutor({
            client: createHttpAisClient({ baseUrl: gl.baseUrl, tokens }),
            testIdentity: PROBE_SUBJECT,
            acquireToken: () => tokens.tokenFor(PROBE_SUBJECT, AbortSignal.timeout(5000)),
          }),
        ],
      ]),
    });
    writeProbeReport(repo, report);

    launched = await launchGateway({
      repoRoot: repo,
      mode: 'headless',
      secretStore: new EncryptedFileStore({ repoRoot: repo, env: SECRETS_ENV }),
      flagPollMs: 50,
    });
    base = `http://127.0.0.1:${launched.gatewayPort}`;
    const users = localUserStore({ store: launched.store });
    await users.createUser({
      username: 'p33c-clerk',
      displayName: 'Clerk',
      password: PASSWORD,
      groups: [TEST_GROUP],
      subject: CLERK_SUBJECT,
    });
    await users.createUser({
      username: 'p33c-super',
      displayName: 'Super',
      password: PASSWORD,
      groups: [SUPER_GROUP],
      subject: SUPER_SUBJECT,
    });
  }, 240_000);

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await launched?.close();
    await jde?.close();
    if (repo) removeLaunchRepo(repo);
  });

  async function bearer(subject: string): Promise<string> {
    return (await launched.identity.issueToken(subject, ['pwd'], 'p33c')).token;
  }

  async function assertion(consumer: 'test' | 'bot'): Promise<string> {
    return signTestAssertion(
      consumer === 'test'
        ? { consumerId: TEST_CONSUMER, audience: AUDIENCE, keypair }
        : { consumerId: BOT_CONSUMER, audience: AUDIENCE, keypair: botKeypair },
    );
  }

  async function reload(
    who: { subject?: string; consumer?: 'test' | 'bot' },
    method = 'POST',
  ): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = {};
    if (who.consumer !== undefined) {
      headers[MCPFORGE_CONSUMER_ASSERTION_HEADER] = await assertion(who.consumer);
    }
    if (who.subject !== undefined) headers['authorization'] = `Bearer ${await bearer(who.subject)}`;
    const res = await fetch(`${base}${CATALOGUE_RELOAD_PATH}`, { method, headers });
    return { status: res.status, body: (await res.json()) as unknown };
  }

  async function deployment(): Promise<{ catalogueDigest: string; toolCount: number }> {
    const res = await fetch(`${base}/api/v1/deployment`, {
      headers: {
        authorization: `Bearer ${await bearer(SUPER_SUBJECT)}`,
        [MCPFORGE_CONSUMER_ASSERTION_HEADER]: await assertion('test'),
      },
    });
    const { catalogueDigest, toolCount } = deploymentResponseSchema.parse(await res.json());
    return { catalogueDigest, toolCount };
  }

  async function catalogueRows(): Promise<AuditCallRecord[]> {
    return (await launched.store.audit.listChain('local')).filter((r) => r.phase === 'catalogue');
  }

  async function connectClerk(): Promise<{ client: Client; listChanged: () => number }> {
    const client = new Client({ name: 'w0-p33c', version: '0.0.0' });
    let changes = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      changes += 1;
    });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: {
          headers: {
            [MCPFORGE_CONSUMER_ASSERTION_HEADER]: await assertion('test'),
            authorization: `Bearer ${await bearer(CLERK_SUBJECT)}`,
          },
        },
      }) as unknown as Transport,
    );
    clients.push(client);
    return { client, listChanged: () => changes };
  }

  it('a human who is not a super admin is refused with a next, audited, and nothing changes', async () => {
    const before = await deployment();
    const r = await reload({ subject: CLERK_SUBJECT, consumer: 'test' });
    expect(r.status).toBe(403);
    const e = apiErrorSchema.parse(r.body).error;
    expect(e.code).toBe('TOOL_NOT_IN_SCOPE');
    expect(e.next).toContain('super admin');
    expect(await deployment()).toEqual(before);
    const rows = await catalogueRows();
    expect(rows.at(-1)).toMatchObject({
      callerSubject: CLERK_SUBJECT,
      outcome: 'policy_denied',
      deniedByRule: 'catalogue.not_super_admin',
      toolId: 'forge.catalogue.reload',
    });
  });

  it('a super admin through a consumer with no human in its loop is refused, audited', async () => {
    const r = await reload({ subject: SUPER_SUBJECT, consumer: 'bot' });
    expect(r.status).toBe(403);
    const e = apiErrorSchema.parse(r.body).error;
    expect(e.code).toBe('CONSUMER_NOT_AUTHORIZED');
    expect(e.next.length).toBeGreaterThan(0);
    expect((await catalogueRows()).at(-1)).toMatchObject({
      callerSubject: SUPER_SUBJECT,
      consumerId: BOT_CONSUMER,
      outcome: 'policy_denied',
      deniedByRule: 'catalogue.consumer_not_authorized',
    });
  });

  it('no consumer, or no human, never reaches the reload: refused at the front door, nothing audited', async () => {
    const rowsBefore = (await catalogueRows()).length;
    const noConsumer = await reload({ subject: SUPER_SUBJECT });
    expect(noConsumer.status).toBe(401);
    expect(apiErrorSchema.parse(noConsumer.body).error.code).toBe('CONSUMER_UNREGISTERED');
    const noHuman = await reload({ consumer: 'test' });
    expect(noHuman.status).toBeGreaterThanOrEqual(401);
    expect(noHuman.status).toBeLessThan(404);
    expect(apiErrorSchema.parse(noHuman.body).error.next.length).toBeGreaterThan(0);
    const get = await reload({ subject: SUPER_SUBJECT, consumer: 'test' }, 'GET');
    expect(get.status).toBe(405);
    expect((await catalogueRows()).length).toBe(rowsBefore);
  });

  it('definitions that do not validate are refused, and the OLD catalogue keeps serving', async () => {
    const { client } = await connectClerk();
    const before = await deployment();
    const voucherGet = join(repo, 'manifests', 'jde', 'fin', 'ap', 'voucher.get.tool.yaml');
    const original = readFileSync(voucherGet, 'utf8');
    // `calls` is the concept console's demo field, which forge validate rejects.
    writeFileSync(voucherGet, `${original}\ncalls: 12\n`);
    try {
      const r = await reload({ subject: SUPER_SUBJECT, consumer: 'test' });
      expect(r.status).toBe(409);
      const refused = catalogueReloadRefusalSchema.parse(r.body);
      expect(refused.error.code).toBe('CATALOGUE_LOAD_REFUSED');
      expect(refused.error.next).toMatch(
        /^Nothing changed: catalogue generation 1 is still serving\./,
      );
      expect(refused.reload.generation).toBe(1);
      expect(refused.reload.failures.some((f) => f.file.includes('voucher.get'))).toBe(true);
      expect(refused.reload.failures.every((f) => f.fix.length > 0)).toBe(true);

      // Still generation 1, still serving, still answering.
      expect(await deployment()).toEqual(before);
      expect((await client.listTools()).tools.map((t) => t.name)).toContain(JOURNAL);
      const read = parse(
        await client.callTool({
          name: VOUCHER_GET,
          arguments: { document_number: '70001', document_type: 'PV', document_company: '00100' },
        }),
      );
      expect(read.isError).toBe(false);

      expect((await catalogueRows()).at(-1)).toMatchObject({
        callerSubject: SUPER_SUBJECT,
        outcome: 'business_error',
        errorCode: 'CATALOGUE_LOAD_REFUSED',
        deniedByRule: 'catalogue.load_refused',
      });
      expect((await catalogueRows()).at(-1)!.id).toBe(refused.reload.auditCallId);
    } finally {
      writeFileSync(voucherGet, original);
    }
  }, 60_000);

  it('a tool changed WITHOUT a version bump is refused: a minted plan binds the version', async () => {
    const manifest = join(repo, JOURNAL_MANIFEST);
    const original = readFileSync(manifest, 'utf8');
    writeFileSync(
      manifest,
      original.replace('This creates an UNPOSTED', 'This creates a NEW UNPOSTED'),
    );
    try {
      await codegen();
      const r = await reload({ subject: SUPER_SUBJECT, consumer: 'test' });
      expect(r.status).toBe(409);
      const refused = catalogueReloadRefusalSchema.parse(r.body);
      expect(refused.reload.failures).toEqual([
        expect.objectContaining({
          ruleId: 'reload.version-unchanged',
          file: JOURNAL_MANIFEST.replace(/\\/g, '/'),
        }),
      ]);
      expect(refused.error.next).toContain('Bump version');
    } finally {
      writeFileSync(manifest, original);
      await codegen();
    }
  }, 120_000);

  it('after a clean reload of a changed tool, a plan minted BEFORE it cannot be confirmed; the live session was told list_changed', async () => {
    const { client, listChanged } = await connectClerk();
    const plan = parse(await client.callTool({ name: JOURNAL, arguments: JOURNAL_ARGS }));
    expect(plan.isError).toBe(false);
    expect(plan.body['status']).toBe('confirm_required');
    const staleToken = String(plan.body['confirmToken']);

    // The merged change: new copy in the plan, version bumped (patch = copy).
    const manifest = join(repo, JOURNAL_MANIFEST);
    writeFileSync(
      manifest,
      readFileSync(manifest, 'utf8')
        .replace(/^version: 1\.0\.0$/m, 'version: 1.0.1')
        .replace('This creates an UNPOSTED', 'This creates a NEW UNPOSTED'),
    );
    await codegen();

    const r = await reload({ subject: SUPER_SUBJECT, consumer: 'test' });
    expect(r.status).toBe(200);
    const reloaded = catalogueReloadResponseSchema.parse(r.body);
    expect(reloaded).toMatchObject({ generation: 2, previousGeneration: 1, changed: [JOURNAL] });
    expect(reloaded.next).toContain('forge probe');
    expect((await deployment()).catalogueDigest).toBe(reloaded.catalogueDigest);
    await eventually(() => listChanged() >= 1);

    const row = (await catalogueRows()).at(-1)!;
    expect(row).toMatchObject({
      id: reloaded.auditCallId,
      outcome: 'ok',
      callerSubject: SUPER_SUBJECT,
    });
    expect(row.resultKeys).toContainEqual({ keyName: 'catalogueGeneration', keyValue: '2' });

    // The stale plan: bound to 1.0.0, refused, never executed.
    const ranBefore = jde.ran().length;
    const stale = parse(
      await client.callTool({ name: JOURNAL, arguments: { ...JOURNAL_ARGS, confirm: staleToken } }),
    );
    expect(stale.isError).toBe(true);
    expect(stale.body['code']).toBe('PLAN_ARGUMENT_MISMATCH');
    expect(String(stale.body['message'])).toContain('different version');
    expect(String(stale.body['next']).length).toBeGreaterThan(0);
    expect(
      jde
        .ran()
        .slice(ranBefore)
        .filter((x) => x.orchestration === 'GL_JE_CREATE'),
    ).toEqual([]);

    // The new generation serves: a fresh plan shows the new copy and confirms.
    const fresh = parse(await client.callTool({ name: JOURNAL, arguments: JOURNAL_ARGS }));
    expect(fresh.body['status']).toBe('confirm_required');
    expect(JSON.stringify(fresh.body)).toContain('NEW UNPOSTED');
    const executed = parse(
      await client.callTool({
        name: JOURNAL,
        arguments: { ...JOURNAL_ARGS, confirm: String(fresh.body['confirmToken']) },
      }),
    );
    expect(executed.isError).toBe(false);

    expect((await launched.store.audit.verifyChain('local')).status).toBe('intact');
  }, 120_000);
});
