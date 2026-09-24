// MCPForge — W0-E8 case 1. Wave 0 exit criterion 5: "the gateway is the only
// door — a direct module-server call from outside the trust boundary is
// refused" (02 §4.8, 01 §7 row 5).
//
// WHAT EXISTS TODAY, STATED HONESTLY (CLAUDE.md §8). 02 §4.8 describes the
// EGRESS door: a Mode B module bundle, or an Oracle target, that accepts
// connections only from the gateway's egress identity (mTLS / service
// principal / IP allowlist), tested by "a CI job that attempts exactly that
// against the deployed environment". At this point in the Wave 0 build there is
// no such thing to attempt it against:
//
//   * `adapters/**` holds no binding executor — every directory under it is a
//     `.gitkeep`, so there is no second code path from anywhere to a target;
//   * every module server is Mode A (in-process, 02 §4.6) — there is no second
//     process listening on a socket that could be called around the gateway;
//   * `manifests/` holds no tool yet, so nothing governed sits behind the door.
//
// So this file tests the door that DOES exist and is real code: the INGRESS
// door, `core/gateway/transport/**` (W0-E1) — the gateway's one `/mcp`
// Streamable HTTP endpoint. 01 §11.5, quoted in TASKS.md's exit-criteria table,
// splits criterion 5 exactly this way: "criterion 5 evidences the egress door;
// criterion 14 evidences the ingress door. Both are required." The egress half
// belongs to the deployed-environment job that W0-N2 and the adapter tasks make
// possible, and it is NOT faked here — a passing test against a mock module
// server would assert nothing about a network control that does not exist.
//
// What is genuinely proved below: no request reaches an MCP server instance
// except through a session the gateway itself established at `/mcp`, and a
// forged or absent session id is refused at the transport before anything
// downstream (auth, scope, policy) is reached.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  createGatewayHttpTransport,
  type GatewayHttpTransport,
} from '../../core/gateway/transport/http.js';
import { STUB_TOOL_ID } from '../../core/gateway/transport/server.js';
// W0-N2 — 02 §4.2 step [2a]. The door now also requires a REGISTERED consumer:
// no session is established without one, and the transport has no default-open
// mode. The "same call through the door succeeds" control below therefore
// presents a real Ed25519 client assertion, exactly as a real client would.
import {
  ConsumerAuthenticator,
  readConsumerPresentation,
} from '../../core/gateway/transport/consumer-auth/index.js';
import {
  generateTestConsumerKeypair,
  signTestAssertion,
  testConsumerRecord,
  testRegistry,
  type TestKeypair,
} from '../../core/gateway/transport/consumer-auth/testkit.js';

const CONSUMER_AUDIENCE = 'https://mcpforge.local/mcp';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('W0-E8 case 1 — the gateway is the only door (Wave 0 exit criterion 5, ingress half)', () => {
  let gateway: GatewayHttpTransport;
  let baseUrl: URL;
  let consumerKeypair: TestKeypair;

  beforeEach(async () => {
    // The real W0-E1 transport, with the real `McpServer` factory. Nothing is
    // stubbed: `createGatewayHttpTransport` creates an `McpServer` ONLY when a
    // real `initialize` arrives, which is itself the property under test — a
    // request that never gets past the door never reaches a server instance at
    // all, and `sessionStore.size` is the observable proof of that.
    consumerKeypair = await generateTestConsumerKeypair();
    const authenticator = new ConsumerAuthenticator({
      registry: testRegistry([
        testConsumerRecord({
          publicKeys: [
            {
              kid: consumerKeypair.kid,
              kty: 'OKP',
              crv: 'Ed25519',
              x: consumerKeypair.publicJwk.x,
              addedAt: '2026-08-27',
            },
          ],
        }),
      ]),
      audience: CONSUMER_AUDIENCE,
    });
    gateway = createGatewayHttpTransport({
      consumerAuth: {
        authenticate: (headers, correlationId) =>
          authenticator.authenticate(readConsumerPresentation(headers), correlationId),
      },
    });
    const { port } = await gateway.listen(0);
    baseUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  });

  afterEach(async () => {
    await gateway.close();
  });

  it('a direct tools/call from outside the boundary — no session established — is REFUSED and executes nothing', async () => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: STUB_TOOL_ID, arguments: { echo: 'bypass' } },
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { message?: string }; result?: unknown };
    expect(body.result).toBeUndefined();
    expect(body.error?.message).toMatch(/Mcp-Session-Id/);

    // The door held: no MCP server instance was ever created for this caller,
    // so no tool handler could have run.
    expect(gateway.sessionStore.size).toBe(0);
  });

  it('a FORGED session id is refused — a caller cannot mint its own way in', async () => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        // A well-formed UUID that this gateway never issued.
        'mcp-session-id': '00000000-0000-4000-8000-000000000000',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: STUB_TOOL_ID, arguments: { echo: 'forged' } },
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { result?: unknown };
    expect(body.result).toBeUndefined();
    expect(gateway.sessionStore.size).toBe(0);
  });

  it('the module server behind the door is reachable at NO path other than /mcp', async () => {
    for (const path of ['/', '/tools', '/mcp/tools/call', '/rpc', '/internal']) {
      const response = await fetch(new URL(path, baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: STUB_TOOL_ID, arguments: { echo: 'sideways' } },
        }),
      });
      expect(response.status, `${path} answered something other than 404`).toBe(404);
    }
    expect(gateway.sessionStore.size).toBe(0);
  });

  it('the SAME call through the door succeeds — so the refusals above are the boundary, not a broken fixture', async () => {
    const client = new Client({ name: 'w0-e8-boundary-client', version: '0.0.0' });
    const assertion = await signTestAssertion({
      consumerId: 'test-agent',
      audience: CONSUMER_AUDIENCE,
      keypair: consumerKeypair,
    });
    const transport = new StreamableHTTPClientTransport(baseUrl, {
      requestInit: { headers: { 'mcpforge-consumer-assertion': assertion } },
    });
    await client.connect(transport as unknown as Transport);

    const result = await client.callTool({ name: STUB_TOOL_ID, arguments: { echo: 'w0-e8' } });
    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{ text?: string }>;
    expect(content[0]?.text).toBe('ok:w0-e8');
    expect(gateway.sessionStore.size).toBe(1);

    await client.close();
  });

  it('EGRESS half, recorded not faked: no binding executor exists outside the gateway to be called around it', () => {
    // 02 §4.8's egress controls are network-level and belong to a deployed
    // environment. What is checkable in this repository today is the weaker but
    // true statement that there is no second code path to a target at all: if
    // an executor appears under adapters/** while criterion 5 still has no
    // live egress-refusal job, this assertion fails and forces the question.
    const adapters = join(repoRoot, 'adapters');
    const executables: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          // The Python worker is out of scope: 02 §1.4 — it never speaks MCP,
          // never decides policy, and is driven BY the gateway, not around it.
          if (name === 'oracle-worker' || name === 'node_modules' || name === 'dist') continue;
          walk(full);
          continue;
        }
        if (name.endsWith('.ts') && !name.endsWith('.test.ts')) executables.push(full);
      }
    };
    walk(adapters);

    expect(
      executables,
      'A TypeScript binding executor now exists under adapters/. Wave 0 exit criterion 5 needs a LIVE egress-refusal job against it (02 §4.8) — this suite currently evidences the ingress door only.',
    ).toEqual([]);
  });
});
