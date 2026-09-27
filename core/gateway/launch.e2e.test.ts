// MCPForge — W0-P11. The LAUNCHED gateway, end to end over HTTP.
//
// Nothing about the gateway is assembled by this test: it calls the real
// `launchGateway`, which builds the whole of 02 §4.2 itself. What the test
// owns is the world around it:
//
//   * the local mock JDE from W0-P14, a real HTTP server with a token provider
//     and orchestrations that execute as the token's user;
//   * a probe report produced by the REAL probe (`runProbe` with the real
//     `function` probe executor) run against that mock, so visibility and the
//     validate-pair evidence come from a probe, not from a hand-written file;
//   * a registered consumer whose private key the test holds, and a local user
//     created in the gateway's own store, whose token the gateway's own issuer
//     signs;
//   * an encrypted secret store keyed by `MCPFORGE_SECRETS_KEY` (never the OS
//     keychain), seeded with the mock's three token-provider client secrets.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  createHttpAisClient,
  createHttpAisTokenProvider,
  loadAisTargetsOverlay,
} from '@mcpforge/adapter-function';
import {
  createFunctionProbeExecutor,
  probeInputsFromCatalogue,
  runProbe,
  writeProbeReport,
  type ProbeToolDetail,
} from '@mcpforge/probe';
import { loadCatalogueIndex } from '@mcpforge/registry/index/server';
import { EncryptedFileStore } from './secrets/server.js';
import { parseSecretRef } from './secrets/index.js';
import { localUserStore } from './identity/index.js';
import {
  generateTestConsumerKeypair,
  signTestAssertion,
  type TestKeypair,
} from './transport/consumer-auth/testkit.js';
import { MCPFORGE_CONSUMER_ASSERTION_HEADER } from './transport/index.js';
import { loadRuntimeCatalogue } from './assembly/index.js';
import { launchGateway, type LaunchedGateway } from './launch.js';
import {
  launchRepo,
  REPO_ROOT,
  removeLaunchRepo,
  TEST_CONSUMER,
  TEST_GROUP,
} from './launch.test-support.js';

const CLERK_SUBJECT = 'local:p11-clerk';
const PROBE_SUBJECT = 'local:p11-probe';
const AUDIENCE = 'https://mcpforge.local/mcp';
const SECRETS_ENV = { MCPFORGE_SECRETS_KEY: 'w0-p11-test-only-sealing-passphrase' };
const CLIENTS = {
  'mcpforge-local-jde-fin-ap': 'p11-secret-ap',
  'mcpforge-local-jde-fin-gl': 'p11-secret-gl',
  'mcpforge-local-jde-scm-po': 'p11-secret-po',
};

interface MockJde {
  readonly baseUrl: string;
  readonly tokenUrl: string;
  ran(): readonly { readonly orchestration?: string; readonly executedAs?: string }[];
  close(): Promise<void>;
}

/** The mock lives in tests/mocks; loaded by URL so the gateway build does not include it. */
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

describe('W0-P11 — the launched gateway serves the governed surface', () => {
  let jde: MockJde;
  let repo: string;
  let launched: LaunchedGateway;
  let keypair: TestKeypair;
  const clients: Client[] = [];

  beforeAll(async () => {
    const catalogue = await loadRuntimeCatalogue({ repoRoot: REPO_ROOT });
    // The mock reports each orchestration at the version its manifest pins.
    const versions: Record<string, string> = {};
    for (const t of catalogue.tools.values()) {
      const d = t.functionDescriptor;
      if (d !== undefined && d.refVersion !== null) versions[d.ref] = d.refVersion;
    }
    jde = await startMockJde(versions);
    keypair = await generateTestConsumerKeypair();
    const refs = [...catalogue.tools.values()]
      .map((t) => t.functionDescriptor?.ref)
      .filter((r): r is string => r !== undefined);
    repo = launchRepo({
      keypair,
      aisBaseUrl: jde.baseUrl,
      aisTokenUrl: jde.tokenUrl,
      grantRefs: refs,
    });

    // The binding credentials, seeded as an operator would.
    const secrets = new EncryptedFileStore({ repoRoot: repo, env: SECRETS_ENV });
    const overlay = loadAisTargetsOverlay(join(repo, 'overlays', 'local', 'ais-targets.yaml'));
    for (const target of overlay.servers.values()) {
      await secrets.put(
        parseSecretRef(target.clientCredentialRef),
        CLIENTS[target.clientId as keyof typeof CLIENTS],
      );
    }

    // The REAL probe, against the mock, as the designated probe user.
    const ap = overlay.servers.get('jde-fin-ap')!;
    const tokens = createHttpAisTokenProvider({
      tokenUrl: ap.tokenUrl,
      clientId: ap.clientId,
      clientCredential: { ref: parseSecretRef(ap.clientCredentialRef), secretStore: secrets },
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
            client: createHttpAisClient({ baseUrl: ap.baseUrl, tokens }),
            testIdentity: PROBE_SUBJECT,
            acquireToken: () => tokens.tokenFor(PROBE_SUBJECT, AbortSignal.timeout(5000)),
          }),
        ],
      ]),
    });
    // Every tool resolved by the real probe against the mock: nothing forced.
    expect(report.tools.map((t) => [t.toolId, t.status])).toEqual(
      report.tools.map((t) => [t.toolId, 'resolved']),
    );
    writeProbeReport(repo, report);

    launched = await launchGateway({
      repoRoot: repo,
      mode: 'headless',
      secretStore: new EncryptedFileStore({ repoRoot: repo, env: SECRETS_ENV }),
      flagPollMs: 50,
    });

    await localUserStore({ store: launched.store }).createUser({
      username: 'p11-clerk',
      displayName: 'P11 Clerk',
      password: 'a-long-enough-test-password-1',
      groups: [TEST_GROUP],
      subject: CLERK_SUBJECT,
    });
  }, 180_000);

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await launched?.close();
    await jde?.close();
    removeLaunchRepo(repo);
  });

  async function connect(bearer?: string): Promise<Client> {
    const headers: Record<string, string> = {
      [MCPFORGE_CONSUMER_ASSERTION_HEADER]: await signTestAssertion({
        consumerId: TEST_CONSUMER,
        audience: AUDIENCE,
        keypair,
      }),
    };
    if (bearer !== undefined) headers['authorization'] = `Bearer ${bearer}`;
    const client = new Client({ name: 'w0-p11', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${launched.gatewayPort}/mcp`), {
        requestInit: { headers },
      }) as unknown as Transport,
    );
    clients.push(client);
    return client;
  }

  it('the gateway minted its own three signing keys on first start (refs only)', () => {
    expect([...launched.mintedKeys].sort()).toEqual([
      'secretRef://gateway/confirm-token/hmac',
      'secretRef://gateway/execution-grant/hmac',
      'secretRef://gateway/local-issuer/jwt-signing',
    ]);
  });

  it('find -> describe -> read -> write plan -> confirm -> execute, as a registered consumer AND a resolved human', async () => {
    const token = (await launched.identity.issueToken(CLERK_SUBJECT, ['pwd'], 'p11')).token;
    const client = await connect(token);

    const listed = (await client.listTools()).tools.map((t) => t.name);
    expect(listed.slice(0, 4)).toEqual([
      'forge.find',
      'forge.describe',
      'forge.activate',
      'forge.invoke',
    ]);
    expect(listed).toContain('jde.fin.journal.create');

    const found = parse(
      await client.callTool({ name: 'forge.find', arguments: { query: 'create a journal entry' } }),
    );
    expect(JSON.stringify(found.body)).toContain('jde.fin.journal.create');

    const described = parse(
      await client.callTool({
        name: 'forge.describe',
        arguments: { toolIds: ['jde.fin.journal.create'] },
      }),
    );
    expect(described.isError).toBe(false);

    const read = parse(
      await client.callTool({
        name: 'jde.ap.voucher.get',
        arguments: { document_number: '70001', document_type: 'PV', document_company: '00100' },
      }),
    );
    expect(read.isError).toBe(false);

    const args = {
      company: '00001',
      document_type: 'JE',
      gl_date: '2026-09-25',
      account_number: '1.1110',
      amount: 1_200,
      currency: 'GBP',
    };
    const plan = parse(await client.callTool({ name: 'jde.fin.journal.create', arguments: args }));
    expect(plan.isError).toBe(false);
    expect(plan.body['status']).toBe('confirm_required');

    const executed = parse(
      await client.callTool({
        name: 'jde.fin.journal.create',
        arguments: { ...args, confirm: String(plan.body['confirmToken']) },
      }),
    );
    expect(executed.isError).toBe(false);

    // The orchestrations ran AS THE HUMAN at the target: the dry-run sibling
    // under its dry-run grant, then the execute. (The probe's own earlier
    // sibling call ran as the probe user and is not the clerk's.)
    const asClerk = jde.ran().filter((r) => r.executedAs === CLERK_SUBJECT.toUpperCase());
    expect(asClerk.map((r) => r.orchestration)).toEqual([
      'AP_VOUCHER_GET',
      'GL_JE_CREATE_VALIDATE',
      'GL_JE_CREATE',
    ]);

    // Every call left a row; the execute row carries consumer, human and business key.
    const rows = await launched.store.audit.listChain('local');
    const exec = rows.find((r) => r.toolId === 'jde.fin.journal.create' && r.phase === 'execute');
    expect(exec).toMatchObject({ consumerId: TEST_CONSUMER, callerSubject: CLERK_SUBJECT });
    expect(exec!.resultKeys.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.phase)).toEqual(['execute', 'plan', 'execute']);
    expect((await launched.store.audit.verifyChain('local')).status).toBe('intact');
  });

  it('a registered consumer with NO human is refused at initialize (IDENTITY / AUTH), no session', async () => {
    await expect(connect()).rejects.toThrow();
    expect(launched.gateway.sessionStore.size).toBe(1);
  });

  it('an unregistered consumer is refused CONSUMER_UNREGISTERED', async () => {
    const response = await fetch(`http://127.0.0.1:${launched.gatewayPort}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'x', version: '1' },
        },
      }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { data: { code: string } } };
    expect(body.error.data.code).toBe('CONSUMER_UNREGISTERED');
  });

  // ---- W0-P5a — the gateway as the local provider's token endpoint ---------

  interface WireGrant {
    tokenType: string;
    accessToken: string;
    refreshToken: string;
    principal: { subject: string; groups: string[] };
  }

  function post(path: string, body: unknown, contentType = 'application/json') {
    return fetch(`http://127.0.0.1:${launched.gatewayPort}${path}`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: JSON.stringify(body),
    });
  }

  it('a human signs in over POST /auth/local/token, and that token is the human on /mcp', async () => {
    const response = await post('/auth/local/token', {
      username: 'p11-clerk',
      password: 'a-long-enough-test-password-1',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const grant = (await response.json()) as WireGrant;
    expect(grant.tokenType).toBe('Bearer');
    expect(grant.principal).toMatchObject({ subject: CLERK_SUBJECT, groups: [TEST_GROUP] });
    expect(grant).not.toHaveProperty('sessionId');

    const client = await connect(grant.accessToken);
    const listed = await client.listTools();
    expect(listed.tools.some((t) => t.name === 'forge.find')).toBe(true);
  });

  it('the signed-in token alone opens nothing: no consumer is CONSUMER_UNREGISTERED', async () => {
    const grant = (await (
      await post('/auth/local/token', {
        username: 'p11-clerk',
        password: 'a-long-enough-test-password-1',
      })
    ).json()) as WireGrant;
    const response = await fetch(`http://127.0.0.1:${launched.gatewayPort}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${grant.accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'x', version: '1' },
        },
      }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { data: { code: string } } };
    expect(body.error.data.code).toBe('CONSUMER_UNREGISTERED');
  });

  it('refresh rotates over HTTP; the spent token is refused; sign-out ends the session', async () => {
    const first = (await (
      await post('/auth/local/token', {
        username: 'p11-clerk',
        password: 'a-long-enough-test-password-1',
      })
    ).json()) as WireGrant;
    const renewedResponse = await post('/auth/local/refresh', { refreshToken: first.refreshToken });
    expect(renewedResponse.status).toBe(200);
    const renewed = (await renewedResponse.json()) as WireGrant;
    expect(renewed.refreshToken).not.toBe(first.refreshToken);

    const signOut = await post('/auth/local/signout', { refreshToken: renewed.refreshToken });
    expect(signOut.status).toBe(204);
    const afterSignOut = await post('/auth/local/refresh', { refreshToken: renewed.refreshToken });
    expect(afterSignOut.status).toBe(401);
    const refused = (await afterSignOut.json()) as { error: { code: string; next: string } };
    expect(refused.error.code).toBe('AUTH_REQUIRED');
    expect(refused.error.next).toMatch(/Sign in again/);
    expect(JSON.stringify(refused)).not.toContain(renewed.refreshToken);
  });

  it('refuses a wrong password (401, with a next), a non-JSON body (400) and a GET (405)', async () => {
    const wrong = await post('/auth/local/token', {
      username: 'p11-clerk',
      password: 'not-the-password-at-all',
    });
    expect(wrong.status).toBe(401);
    const body = (await wrong.json()) as { error: { code: string; next: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
    expect(body.error.next.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain('not-the-password-at-all');

    const form = await post('/auth/local/token', { username: 'p11-clerk' }, 'text/plain');
    expect(form.status).toBe(400);
    expect(((await form.json()) as { error: { code: string } }).error.code).toBe('INPUT_INVALID');

    const get = await fetch(`http://127.0.0.1:${launched.gatewayPort}/auth/local/token`);
    expect(get.status).toBe(405);
    const unknown = await post('/auth/local/authorize', {});
    expect(unknown.status).toBe(404);
  });
});
