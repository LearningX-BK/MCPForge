// MCPForge — W0-N2 proofs at the transport boundary, over a real
// `node:http` server: the front door, closed.
//
// Wave 0 exit criterion 14(a), and the ingress half of criterion 5 (TASKS.md:
// "criterion 5 evidences the egress door; criterion 14 evidences the ingress
// door. Both are required").

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  createGatewayHttpTransport,
  type ConsumerAuthGate,
  type GatewayHttpTransport,
} from '../http.js';
import { STUB_TOOL_ID } from '../server.js';
import {
  ConsumerAuthenticator,
  assertNoRegistrationEndpoint,
  readConsumerPresentation,
  DYNAMIC_CLIENT_REGISTRATION_PATHS,
  MCPFORGE_CONSUMER_ASSERTION_HEADER,
  REGISTRATION_ENDPOINT_KEY,
} from './index.js';
import {
  generateTestConsumerKeypair,
  signTestAssertion,
  testConsumerRecord,
  testRegistry,
  type TestKeypair,
} from './testkit.js';
import { protectedResourceMetadata } from '../../identity/oidc/protected-resource.js';
import type { ConsumerRecord } from '../../consumer/index.js';

const AUDIENCE = 'https://mcpforge.local/mcp';

interface Harness {
  gateway: GatewayHttpTransport;
  baseUrl: URL;
  origin: string;
  identityResolutions: string[];
}

async function startGateway(
  records: readonly ConsumerRecord[],
  identityResolutions: string[],
): Promise<Harness> {
  const authenticator = new ConsumerAuthenticator({
    registry: testRegistry(records),
    audience: AUDIENCE,
  });
  const gate: ConsumerAuthGate = {
    authenticate: (headers, correlationId) =>
      authenticator.authenticate(readConsumerPresentation(headers), correlationId),
    resolveIdentity: (consumer) => {
      // Step [3]. Recording that it ran is the ordering proof.
      identityResolutions.push(consumer.record.id);
    },
  };
  const gateway = createGatewayHttpTransport({ consumerAuth: gate });
  const { port } = await gateway.listen(0);
  return {
    gateway,
    baseUrl: new URL(`http://127.0.0.1:${port}/mcp`),
    origin: `http://127.0.0.1:${port}`,
    identityResolutions,
  };
}

async function initialize(
  h: Harness,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const response = await fetch(h.baseUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'w0-n2-probe', version: '0.0.0' },
      },
    }),
  });
  return { status: response.status, body: await response.text() };
}

/**
 * "Served no `tools/list`", asserted as *zero catalogue bytes*: the response
 * may not carry a tool id, a `tools` array, a result envelope, or a session
 * id the caller could use to ask again.
 */
function expectZeroCatalogueBytes(body: string, h: Harness): void {
  expect(body).not.toContain(STUB_TOOL_ID);
  expect(body).not.toContain('"tools"');
  expect(body).not.toContain('"result"');
  expect(body).not.toContain('"capabilities"');
  const parsed = JSON.parse(body) as { result?: unknown; error?: { data?: { code?: string } } };
  expect(parsed.result).toBeUndefined();
  // No session was minted, so there is nothing to re-present and ask again with.
  expect(h.gateway.sessionStore.size).toBe(0);
}

describe('W0-N2 — an unauthorized consumer is refused at initialize and served no catalogue', () => {
  let h: Harness;
  let keypair: TestKeypair;

  beforeEach(async () => {
    keypair = await generateTestConsumerKeypair();
  });

  afterEach(async () => {
    await h.gateway.close();
  });

  const publicKeys = (kp: TestKeypair): ConsumerRecord['credential']['publicKeys'] => [
    { kid: kp.kid, kty: 'OKP', crv: 'Ed25519', x: kp.publicJwk.x, addedAt: '2026-08-27' },
  ];

  it('an UNREGISTERED consumer: 401 CONSUMER_UNREGISTERED, zero catalogue bytes, no identity resolution', async () => {
    h = await startGateway([], []);
    const assertion = await signTestAssertion({
      consumerId: 'ghost-agent',
      audience: AUDIENCE,
      keypair,
    });

    const { status, body } = await initialize(h, {
      [MCPFORGE_CONSUMER_ASSERTION_HEADER]: assertion,
    });

    expect(status).toBe(401);
    const parsed = JSON.parse(body) as { error: { data: { code: string; next: string } } };
    expect(parsed.error.data.code).toBe('CONSUMER_UNREGISTERED');
    expect(parsed.error.data.next.trim().length).toBeGreaterThan(0);
    expectZeroCatalogueBytes(body, h);
    // 02 §4.2: [2a] runs BEFORE [3]. A refused consumer never reaches identity.
    expect(h.identityResolutions).toEqual([]);
  });

  it('no consumer credential at all: refused, even though a user token might be present', async () => {
    h = await startGateway([testConsumerRecord({ publicKeys: publicKeys(keypair) })], []);

    const { status, body } = await initialize(h, {
      authorization: 'Bearer a.perfectly.valid.looking.user.token',
    });

    expect(status).toBe(401);
    expect(body).toContain('CONSUMER_UNREGISTERED');
    expectZeroCatalogueBytes(body, h);
    expect(h.identityResolutions).toEqual([]);
  });

  it.each([
    ['suspended', testConsumerRecord({ status: 'suspended' })],
    ['retired', testConsumerRecord({ status: 'retired' })],
    ['expired', testConsumerRecord({ expiresAt: '2020-01-01' })],
  ])('a %s consumer: 403 CONSUMER_SUSPENDED, zero catalogue bytes', async (_label, base) => {
    const record: ConsumerRecord = {
      ...base,
      credential: { ...base.credential, publicKeys: publicKeys(keypair) },
    };
    h = await startGateway([record], []);
    const assertion = await signTestAssertion({
      consumerId: record.id,
      audience: AUDIENCE,
      keypair,
    });

    const { status, body } = await initialize(h, {
      [MCPFORGE_CONSUMER_ASSERTION_HEADER]: assertion,
    });

    expect(status).toBe(403);
    const parsed = JSON.parse(body) as { error: { data: { code: string; next: string } } };
    expect(parsed.error.data.code).toBe('CONSUMER_SUSPENDED');
    expect(parsed.error.data.next).toContain('test-steward');
    expectZeroCatalogueBytes(body, h);
    expect(h.identityResolutions).toEqual([]);
  });

  it('a refused consumer cannot then call tools/list with any session id it invents', async () => {
    h = await startGateway([], []);
    await initialize(h, { [MCPFORGE_CONSUMER_ASSERTION_HEADER]: 'not.a.valid.assertion' });

    const response = await fetch(h.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': 'invented-session-id',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).not.toContain(STUB_TOOL_ID);
    expect(h.gateway.sessionStore.size).toBe(0);
  });

  it('a REGISTERED, active consumer completes initialize -> tools/list, and identity resolution runs after [2a]', async () => {
    h = await startGateway([testConsumerRecord({ publicKeys: publicKeys(keypair) })], []);
    const assertion = await signTestAssertion({
      consumerId: 'test-agent',
      audience: AUDIENCE,
      keypair,
    });

    const client = new Client({ name: 'w0-n2-client', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(h.baseUrl, {
      requestInit: { headers: { [MCPFORGE_CONSUMER_ASSERTION_HEADER]: assertion } },
    });
    await client.connect(transport as unknown as Transport);

    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toEqual([STUB_TOOL_ID]);
    expect(h.identityResolutions).toEqual(['test-agent']);

    await client.close();
  });
});

describe('W0-N2 — a gateway with no [2a] gate establishes no session', () => {
  it('refuses initialize rather than defaulting open (CLAUDE.md #1, #6)', async () => {
    const gateway = createGatewayHttpTransport();
    const { port } = await gateway.listen(0);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
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
            clientInfo: { name: 'x', version: '0' },
          },
        }),
      });
      const body = await response.text();
      expect(response.status).toBe(503);
      expect(body).not.toContain(STUB_TOOL_ID);
      expect(gateway.sessionStore.size).toBe(0);
    } finally {
      await gateway.close();
    }
  });
});

describe('W0-N2 — Dynamic Client Registration is structurally absent (02 §11.2, 05 §1.3.3)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await startGateway([], []);
  });

  afterEach(async () => {
    await h.gateway.close();
  });

  it.each(DYNAMIC_CLIENT_REGISTRATION_PATHS)(
    'POST %s returns 403 — NOT 404 — with an agent-actionable next naming the portal flow',
    async (path) => {
      const response = await fetch(`${h.origin}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: 'a self-registering agent', redirect_uris: [] }),
      });
      const body = (await response.json()) as {
        code: string;
        next: string;
        condition: string;
        correlationId: string;
      };

      expect(response.status).toBe(403);
      expect(response.status).not.toBe(404);
      expect(body.code).toBe('CONSUMER_UNREGISTERED');
      expect(body.next.trim().length).toBeGreaterThan(0);
      expect(body.next).toContain('portal');
      expect(body.next).toContain('Consumers');
      expect(body.next.toLowerCase()).not.toMatch(/\btry again\b/);
      expect(body.correlationId.length).toBeGreaterThan(0);
    },
  );

  it('a GET to the registration path is also 403, so no method looks like a way in', async () => {
    const response = await fetch(`${h.origin}/register`);
    expect(response.status).toBe(403);
  });

  it('an unrelated unknown path is still an ordinary 404 — the 403 is about DCR, not about everything', async () => {
    const response = await fetch(`${h.origin}/not-a-real-path`);
    expect(response.status).toBe(404);
  });
});

describe('W0-N2 — no registration_endpoint in published metadata', () => {
  const oidcReadyMetadata = {
    kind: 'oidc' as const,
    issuer: 'https://ad.ltm.example/realms/ltm',
    audience: AUDIENCE,
    authorizationEndpoint: 'https://ad.ltm.example/auth',
    tokenEndpoint: 'https://ad.ltm.example/token',
    jwksUri: 'https://ad.ltm.example/jwks',
    signingAlgorithms: ['RS256'],
    oauthDiscoveryReady: true,
  };

  it('the protected-resource document the gateway publishes carries no registration_endpoint key', () => {
    const result = protectedResourceMetadata(oidcReadyMetadata, { resource: AUDIENCE });
    expect(result.publishable).toBe(true);
    if (!result.publishable) return;
    expect(Object.keys(result.document)).not.toContain(REGISTRATION_ENDPOINT_KEY);
    // Not merely absent from the serialisation — absent from the object.
    expect(REGISTRATION_ENDPOINT_KEY in result.document).toBe(false);
    expect(JSON.stringify(result.document)).not.toContain(REGISTRATION_ENDPOINT_KEY);
    expect(() => assertNoRegistrationEndpoint(result.document)).not.toThrow();
  });

  it('the publish guard throws rather than quietly filtering, if a builder ever emits one', () => {
    expect(() =>
      assertNoRegistrationEndpoint({
        issuer: 'https://x',
        registration_endpoint: 'https://x/register',
      }),
    ).toThrow(/no dynamic client registration endpoint/i);
  });

  it('a served metadata document is guarded on the way out', async () => {
    const result = protectedResourceMetadata(oidcReadyMetadata, { resource: AUDIENCE });
    expect(result.publishable).toBe(true);
    if (!result.publishable) return;

    const gateway = createGatewayHttpTransport({
      publishedMetadata: { path: result.path, document: result.document },
    });
    const { port } = await gateway.listen(0);
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp`,
      );
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).not.toContain(REGISTRATION_ENDPOINT_KEY);
    } finally {
      await gateway.close();
    }
  });
});
