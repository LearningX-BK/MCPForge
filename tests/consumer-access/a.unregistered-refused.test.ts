// MCPForge — W0-N14(a): 01 §11.5 criterion 14(a).
//
// "A call presenting a valid user identity from an UNREGISTERED consumer is
// refused at session establishment with CONSUMER_UNREGISTERED, and no
// `tools/list` is served."
//
// This runs the REAL front door: `createGatewayHttpTransport` (W0-E1) wired to
// the REAL `ConsumerAuthenticator` (W0-N2), which is exactly what
// `core/gateway/transport/consumer-auth/consumer-auth.http.test.ts` already
// proves in depth and labels "Wave 0 exit criterion 14(a)" in its own header.
// This file is the checkpoint-evidence assembly of that same real mechanism —
// it does not re-implement or restate the auth logic, it drives the real HTTP
// server over `node:fetch` and records what came back.
//
// "No tools/list is served" is asserted as ZERO CATALOGUE BYTES: the refusal
// response carries no `result`, no `tools` array, no `capabilities` object,
// and the gateway mints no session a caller could then present to ask again.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGatewayHttpTransport, type ConsumerAuthGate, type GatewayHttpTransport } from '../../core/gateway/transport/http.js';
import { STUB_TOOL_ID } from '../../core/gateway/transport/server.js';
import {
  ConsumerAuthenticator,
  readConsumerPresentation,
  MCPFORGE_CONSUMER_ASSERTION_HEADER,
} from '../../core/gateway/transport/consumer-auth/index.js';
import {
  generateTestConsumerKeypair,
  signTestAssertion,
  testRegistry,
  type TestKeypair,
} from '../../core/gateway/transport/consumer-auth/testkit.js';
import { withEvidence } from './support/evidence.js';

const AUDIENCE = 'https://mcpforge.local/mcp';

describe('W0-N14(a) — an unregistered consumer is refused at session establishment, no tools/list served', () => {
  let gateway: GatewayHttpTransport;
  let keypair: TestKeypair;
  let boundPort: number;
  const identityResolutions: string[] = [];

  beforeEach(async () => {
    keypair = await generateTestConsumerKeypair();
    // The registry is EMPTY: no consumer record exists anywhere for the id the
    // caller is about to claim. The credential itself is otherwise flawless —
    // correctly signed, correctly audienced, correctly shaped — so the only
    // reason this is refused is the missing registration.
    const authenticator = new ConsumerAuthenticator({ registry: testRegistry([]), audience: AUDIENCE });
    const gate: ConsumerAuthGate = {
      authenticate: (headers, correlationId) =>
        authenticator.authenticate(readConsumerPresentation(headers), correlationId),
      resolveIdentity: (consumer) => {
        identityResolutions.push(consumer.record.id);
      },
    };
    gateway = createGatewayHttpTransport({ consumerAuth: gate });
    const { port } = await gateway.listen(0);
    boundPort = port;
  });

  afterEach(async () => {
    await gateway.close();
  });

  it('refuses initialize with CONSUMER_UNREGISTERED and serves zero catalogue bytes', async () => {
    await withEvidence(
      'a',
      '(a) A call presenting a valid user identity from an unregistered consumer is refused at session establishment with CONSUMER_UNREGISTERED, and no tools/list is served.',
      'refuses initialize with CONSUMER_UNREGISTERED and serves zero catalogue bytes',
      async () => {
        const assertion = await signTestAssertion({
          consumerId: 'ghost-agent-w0n14',
          audience: AUDIENCE,
          keypair,
        });

        const url = new URL(`http://127.0.0.1:${boundPort}/mcp`);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            [MCPFORGE_CONSUMER_ASSERTION_HEADER]: assertion,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'w0-n14-a-probe', version: '0.0.0' },
            },
          }),
        });
        const body = await response.text();
        const parsed = JSON.parse(body) as {
          result?: unknown;
          error?: { data?: { code?: string; next?: string } };
        };

        expect(response.status).toBe(401);
        expect(parsed.result).toBeUndefined();
        expect(parsed.error?.data?.code).toBe('CONSUMER_UNREGISTERED');
        expect(parsed.error?.data?.next?.trim().length ?? 0).toBeGreaterThan(0);
        expect(body).not.toContain(STUB_TOOL_ID);
        expect(body).not.toContain('"tools"');
        expect(body).not.toContain('"capabilities"');
        expect(gateway.sessionStore.size).toBe(0);
        // 02 §4.2: [2a] runs BEFORE [3] identity resolution. A refused
        // consumer never reaches it, which is the ordering half of "no
        // human-only path" (CLAUDE.md non-negotiable #6).
        expect(identityResolutions).toEqual([]);

        // A refused consumer cannot then invent a session id and ask tools/list
        // directly either — the same absence of a front door, a second way.
        const listResponse = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-session-id': 'invented-session-id',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
        });
        const listBody = await listResponse.text();
        expect(listResponse.status).toBe(400);
        expect(listBody).not.toContain(STUB_TOOL_ID);
        expect(gateway.sessionStore.size).toBe(0);

        return {
          httpStatus: response.status,
          errorCode: parsed.error?.data?.code,
          errorNext: parsed.error?.data?.next,
          zeroCatalogueBytesAsserted: ['tools', 'capabilities', STUB_TOOL_ID],
          identityResolutionsRun: identityResolutions.length,
          sessionsMinted: gateway.sessionStore.size,
          secondaryToolsListStatus: listResponse.status,
          realMechanism:
            'core/gateway/transport/http.ts createGatewayHttpTransport + core/gateway/transport/consumer-auth/authenticate.ts ConsumerAuthenticator — the same code core/gateway/transport/consumer-auth/consumer-auth.http.test.ts (W0-N2) exercises, driven here over a real node:http server via fetch.',
        };
      },
    );
  });
});
