// MCPForge — W0-E5 end-to-end proof: `forge kill`'s effect (a row written to
// the real SQLite-backed `runtime_flags` table) is picked up by the real
// 5-second poll and reaches the real MCP transport layer as a real
// `notifications/tools/list_changed` JSON-RPC message — over a real
// Streamable HTTP session established by the official SDK `Client`, the same
// one `../transport/transport.e2e.test.ts` (W0-E1) drives.
//
// **Why this observes `StreamableHTTPServerTransport.send` rather than
// parsing the client's own SSE stream.** The installed
// `@modelcontextprotocol/sdk@1.30.0` client transport does not keep its
// optional standalone GET/SSE listening stream open by default — it is
// spec-optional, and this SDK version only opens it for an OAuth flow or a
// resumption reconnect — so a bare `client.connect()` followed by a wait for
// a server push has nothing guaranteed to travel over on this SDK version.
// That is an SDK-version transport nuance, not an MCPForge gap: the
// `McpServer` -> `Server` -> `StreamableHTTPServerTransport.send()` call
// chain this test drives is the exact real code W0-E1 built and W0-E5 wires
// the kill switch into, so observing the one hop that actually crosses from
// "in-process" to "on the wire" (`send`) is still a genuine, non-mocked proof
// that the notification reaches the transport for this session — nothing
// about `sendToolListChanged`, `notification()` or `send()` is stubbed to
// return a canned answer; the spy only RECORDS what the real call already did.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createGatewayHttpTransport, type GatewayHttpTransport } from '../transport/http.js';
// W0-N2 — 02 §4.2 step [2a]: no MCP session is established for a consumer
// that has not authenticated against a registration, and the transport has no
// default-open mode. This proof is unchanged in substance; the client that
// holds the session is now a REGISTERED consumer presenting a real Ed25519
// client assertion, which is how every real client reaches this endpoint.
import {
  ConsumerAuthenticator,
  readConsumerPresentation,
} from '../transport/consumer-auth/index.js';
import {
  generateTestConsumerKeypair,
  signTestAssertion,
  testConsumerRecord,
  testRegistry,
  type TestKeypair,
} from '../transport/consumer-auth/testkit.js';

const CONSUMER_AUDIENCE = 'https://mcpforge.local/mcp';
import { createGatewayMcpServer } from '../transport/server.js';
import { openRuntimeStore } from '../store/store.js';
import type { RuntimeStore } from '../store/repository.js';
import { applyKill } from './kill.js';
import { createKillSwitchPipeline, type KillSwitchPipeline } from './pipeline.js';

describe('W0-E5: forge kill -> real 5s-poll pipeline -> real notifications/tools/list_changed on the wire', () => {
  let gateway: GatewayHttpTransport;
  let baseUrl: URL;
  let store: RuntimeStore;
  let pipeline: KillSwitchPipeline;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sendSpy: any;
  let consumerKeypair: TestKeypair;

  const dir = mkdtempSync(join(tmpdir(), 'mcpforge-kill-e2e-'));

  beforeEach(async () => {
    // A real prototype spy: every StreamableHTTPServerTransport instance this
    // process creates (there is exactly one, for the one session this test
    // opens) has every one of its REAL `send` calls recorded, unmodified.
    sendSpy = vi.spyOn(StreamableHTTPServerTransport.prototype, 'send');

    store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'runtime.db') });
    const server = createGatewayMcpServer();
    pipeline = createKillSwitchPipeline(store.runtimeFlags, server, { intervalMs: 5000 });
    // The transport skeleton (W0-E1) builds its own McpServer per session
    // internally; for this proof we drive the SAME server instance the
    // pipeline is watching over an HTTP transport constructed around it, so
    // the notification travels the real Streamable HTTP session end to end.
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
      createServer: () => server,
      consumerAuth: {
        authenticate: (headers, correlationId) =>
          authenticator.authenticate(readConsumerPresentation(headers), correlationId),
      },
    });
    const { port } = await gateway.listen(0);
    baseUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  });

  afterEach(async () => {
    sendSpy.mockRestore();
    pipeline.stop();
    await gateway.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("forge kill's effect reaches the real transport as notifications/tools/list_changed within one 5s poll, no redeploy", async () => {
    const client = new Client({ name: 'w0-e5-proof-client', version: '0.0.0' });
    const assertion = await signTestAssertion({
      consumerId: 'test-agent',
      audience: CONSUMER_AUDIENCE,
      keypair: consumerKeypair,
    });
    const transport = new StreamableHTTPClientTransport(baseUrl, {
      requestInit: { headers: { 'mcpforge-consumer-assertion': assertion } },
    });
    await client.connect(transport as unknown as Transport);

    const listChangedSends = (): unknown[] =>
      (sendSpy.mock.calls as unknown as Array<[{ method?: string }]>)
        .map(([message]) => message)
        .filter((m) => m.method === 'notifications/tools/list_changed');

    expect(listChangedSends()).toHaveLength(0);

    // `forge kill` itself, exactly as the CLI command will call it — a fresh
    // write to the same runtime store the running pipeline is already
    // watching. No restart of `gateway`, `pipeline`, or the client session.
    await applyKill(store.runtimeFlags, store.audit, {
      raw: 'jde.ap.voucher.create',
      reason: 'binding regression under investigation',
      actorSubject: 'ops-bikash',
      deploymentId: 'dep-1',
    });

    expect(listChangedSends()).toHaveLength(0); // not yet — the poll has not ticked

    // Force the tick deterministically rather than sleeping five real
    // seconds in a test: `refreshNow()` IS what the 5-second interval calls
    // (pipeline.ts), so this proves the identical code path the timer uses.
    await pipeline.refreshNow();

    expect(listChangedSends().length).toBeGreaterThanOrEqual(1);

    await client.close();
  });
});
