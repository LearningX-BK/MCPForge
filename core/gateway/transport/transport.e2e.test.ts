// MCPForge — W0-E1 proof: a spec-baseline MCP client completes
// `initialize` -> `tools/list` -> `tools/call` against the gateway's
// Streamable HTTP transport, with a stub tool.
//
// The client here is the official `@modelcontextprotocol/sdk` `Client` over
// its `StreamableHTTPClientTransport` — a generic implementation of the MCP
// spec, not a Claude-specific one (see ./REVIEW_CHECKLIST.md). This is a
// real network round trip against a real `node:http` server, not a
// handler-level unit test.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createGatewayHttpTransport, type GatewayHttpTransport } from './http.js';
import { STUB_TOOL_ID } from './server.js';
import { ConsumerAuthenticator, readConsumerPresentation } from './consumer-auth/index.js';
import {
  generateTestConsumerKeypair,
  signTestAssertion,
  testConsumerRecord,
  testRegistry,
  type TestKeypair,
} from './consumer-auth/testkit.js';

// W0-N2 TIGHTENED THIS TEST, deliberately. 02 §4.2 gained step `[2a]`:
// no MCP session is established for a consumer that has not authenticated
// against a registration, and the transport has no default-open mode (that
// would be exactly the bypass CLAUDE.md non-negotiable 1 forbids). W0-E1's
// proof is unchanged in substance — a spec-baseline client still completes
// `initialize` -> `tools/list` -> `tools/call` — it now does so as a
// REGISTERED consumer, presenting a real Ed25519 client assertion, which is
// how a real client will always reach this endpoint.
const AUDIENCE = 'https://mcpforge.local/mcp';

describe('W0-E1 MCP transport skeleton (e2e over real Streamable HTTP)', () => {
  let gateway: GatewayHttpTransport;
  let baseUrl: URL;
  let keypair: TestKeypair;

  beforeEach(async () => {
    keypair = await generateTestConsumerKeypair();
    const record = testConsumerRecord({
      publicKeys: [
        {
          kid: keypair.kid,
          kty: 'OKP',
          crv: 'Ed25519',
          x: keypair.publicJwk.x,
          addedAt: '2026-08-27',
        },
      ],
    });
    const authenticator = new ConsumerAuthenticator({
      registry: testRegistry([record]),
      audience: AUDIENCE,
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

  it('completes initialize -> tools/list -> tools/call against the stub tool', async () => {
    const assertion = await signTestAssertion({
      consumerId: 'test-agent',
      audience: AUDIENCE,
      keypair,
    });
    const client = new Client({ name: 'w0-e1-proof-client', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(baseUrl, {
      requestInit: { headers: { 'mcpforge-consumer-assertion': assertion } },
    });

    // See http.ts's cast comment — same SDK typing gap under
    // exactOptionalPropertyTypes, on the client transport this time.
    await client.connect(transport as unknown as Transport);

    // initialize (done by client.connect) negotiated capabilities and got a
    // session id back — the transport tracked it internally.
    expect(transport.sessionId).toBeDefined();
    expect(gateway.sessionStore.size).toBe(1);
    const session = gateway.sessionStore.get(transport.sessionId!);
    expect(session).toBeDefined();

    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toEqual([STUB_TOOL_ID]);

    const result = await client.callTool({
      name: STUB_TOOL_ID,
      arguments: { echo: 'w0-e1' },
    });

    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toBe('ok:w0-e1');

    await client.close();
  });

  it('refuses a non-initialize request that carries no known session', async () => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });

    expect(response.status).toBe(400);
  });
});
