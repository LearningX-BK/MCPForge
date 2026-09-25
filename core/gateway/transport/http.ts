// MCPForge — Streamable HTTP wiring for the MCP endpoint. W0-E1, 02 §4.2 step
// [1]: "Transport + protocol — session id, initialize, capability
// negotiation."
//
// **Transport choice.** 02 §4.2's request-path diagram names the transport
// explicitly: "Streamable HTTP, spec-baseline 2026-07-28." That is the
// current MCP transport (it replaced the older HTTP+SSE transport), and it is
// what this module implements — one `/mcp` endpoint handling POST (RPC calls,
// including `initialize`), GET (the optional server-initiated SSE stream) and
// DELETE (explicit session termination), exactly as the spec defines. No
// REST facade, no second endpoint shape (CLAUDE.md §3 / 02 §5.0).
//
// **A flag, not a fabrication (CLAUDE.md §8).** The doc's request-path
// diagram calls the baseline "2026-07-28". The installed
// `@modelcontextprotocol/sdk` (the current published release as of this
// session) implements protocol version `2025-11-25` as its latest, alongside
// older versions back to `2024-10-07` — see
// `SUPPORTED_PROTOCOL_VERSIONS` in the SDK's `types.js`. No SDK release
// advertising a `2026-07-28` version string exists to install against. This
// module does not hardcode either string: it negotiates whatever protocol
// version the connecting client and the installed SDK agree on, which is the
// spec-correct behaviour regardless of which dated version is "current" —
// but the literal string "2026-07-28" cannot be asserted anywhere in this
// codebase today, and that discrepancy between the architecture doc and the
// actual published spec/SDK is named here rather than silently worked around.
// A human should confirm whether "2026-07-28" is a forward-dated placeholder
// in the doc or whether a newer SDK release is expected before Wave 0 exit.
//
// **No Node web framework.** `StreamableHTTPServerTransport.handleRequest`
// accepts a raw `node:http` `IncomingMessage`/`ServerResponse` pair directly
// (see the SDK's own doc comment on the class) — no `express` or other
// framework dependency is needed or added here.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createGatewayMcpServer, type GatewayServerInfo } from './server.js';
import { inMemorySessionStore, type McpSessionStore } from './session.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createDisabledGatewayTelemetry, type GatewayTelemetry } from '../telemetry/tracer.js';
import {
  assertNoRegistrationEndpoint,
  dynamicClientRegistrationRefusal,
  isDynamicClientRegistrationPath,
  DYNAMIC_CLIENT_REGISTRATION_STATUS,
  type ConsumerAuthResult,
} from './consumer-auth/index.js';
import type { LoadedConsumer } from '../consumer/index.js';
import {
  identityRequestFrom,
  type SessionEstablisher,
  type SessionHandle,
} from './session-binding.js';

const MCP_PATH = '/mcp';
const SESSION_ID_HEADER = 'mcp-session-id';

/**
 * W0-N2. HTTP status for a `[2a]` refusal. 401 for a consumer that did not
 * authenticate; 403 for one that authenticated but whose registration is
 * suspended, expired or retired — it is a permission answer, not a credential
 * answer, and an operator reading a log needs to be able to tell them apart.
 */
const CONSUMER_AUTH_STATUS: Record<string, number> = {
  CONSUMER_UNREGISTERED: 401,
  CONSUMER_SUSPENDED: 403,
  // W0-P15 — the human half. 401: no credential, or it did not verify.
  // 403: it verified but names nobody this deployment can resolve.
  AUTH_REQUIRED: 401,
  IDENTITY_UNRESOLVED: 403,
};

/** W0-P15 — the verified session, replaced after every successful re-verification. */
interface SessionState {
  session?: unknown;
}

interface ActiveConnection {
  readonly transport: StreamableHTTPServerTransport;
  readonly state: SessionState;
}

export interface GatewayHttpTransportOptions {
  readonly serverInfo?: GatewayServerInfo;
  readonly sessionStore?: McpSessionStore;
  /**
   * Factory for the `McpServer` behind each new session. Defaults to
   * `() => createGatewayMcpServer(serverInfo)` — a fresh skeleton per
   * session, exactly W0-E1's behaviour. Overriding it lets a caller (a real
   * gateway process, or a W0-E5 kill-switch pipeline test) hold the SAME
   * server instance the HTTP layer connects, so it can call
   * `server.sendToolListChanged()` and have that notification travel the
   * real Streamable HTTP wire to a real client.
   */
  readonly createServer?: (session?: SessionHandle<unknown>) => McpServer;
  /**
   * W0-P15 — steps `[2]` and `[3]`: the human, bound to the session. When
   * present, `establish` runs at `initialize` after `[2a]` succeeded (a refusal
   * means no session and no `tools/list`), and `reverify` runs on every later
   * request before the MCP SDK sees it. The factory above receives a handle to
   * the latest verified session.
   */
  readonly sessions?: SessionEstablisher<unknown>;
  /**
   * W0-E7. 02 §4.8's "Transport + protocol" budget row (3ms). Defaults to a
   * disabled instance — no exporter, no span ever queued — so telemetry is
   * strictly opt-in and never changes this transport's behaviour or timing
   * characteristics for a caller that does not ask for it.
   */
  readonly telemetry?: GatewayTelemetry;
  /**
   * W0-N2 — step `[2a]`, consumer authentication and the registration check
   * (02 §4.2, 02 §11.2). Supplied by the gateway assembly; see the ordering
   * note on `handleMcpRequestUninstrumented` below.
   *
   * **When this is absent, no session is served.** There is deliberately no
   * "unenforced" mode: an optional gate that defaults to open is exactly the
   * service-account-shaped bypass CLAUDE.md non-negotiable 1 forbids, and a
   * gateway that has not been given a registry is a misconfigured gateway, not
   * an unauthenticated one. A caller that wants a session must pass a gate.
   */
  readonly consumerAuth?: ConsumerAuthGate;
  /**
   * W0-N2 — the published protected-resource / authorization-server metadata,
   * if this deployment has any (see `../identity/oidc/protected-resource.ts`,
   * which returns `publishable: false` for a Wave 0 local deployment). Served
   * verbatim at `path`, after `assertNoRegistrationEndpoint` — DCR is
   * structurally absent from anything this gateway publishes.
   */
  readonly publishedMetadata?: PublishedMetadata;
}

/** A metadata document this gateway serves, and where. */
export interface PublishedMetadata {
  readonly path: string;
  readonly document: object;
}

/**
 * The `[2a]` seam. `authenticate` runs first; `resolveIdentity` — step `[3]` —
 * is invoked ONLY after it succeeds, which is what makes 02 §4.2's ordering
 * ("`[2a]` ... between `[2]` and `[3]`") structural rather than a comment.
 */
export interface ConsumerAuthGate {
  authenticate(
    headers: IncomingMessage['headers'],
    correlationId: string,
  ): Promise<ConsumerAuthResult>;
  /**
   * Step `[3]`, identity resolution. Optional here because the gateway's own
   * identity wiring is a later task's; what this task fixes is that it can
   * never run for a consumer that failed `[2a]`.
   */
  resolveIdentity?(
    consumer: LoadedConsumer,
    headers: IncomingMessage['headers'],
  ): Promise<void> | void;
}

export interface GatewayHttpTransport {
  readonly httpServer: Server;
  readonly sessionStore: McpSessionStore;
  listen(port: number, host?: string): Promise<{ port: number }>;
  close(): Promise<void>;
}

/**
 * Builds (but does not start) the gateway's MCP Streamable HTTP endpoint.
 * One `StreamableHTTPServerTransport` + one `McpServer` per MCP session,
 * keyed by the `Mcp-Session-Id` the transport assigns on `initialize`.
 */
export function createGatewayHttpTransport(
  options: GatewayHttpTransportOptions = {},
): GatewayHttpTransport {
  const sessionStore = options.sessionStore ?? inMemorySessionStore();
  const connections = new Map<string, ActiveConnection>();
  const telemetry = options.telemetry ?? createDisabledGatewayTelemetry();

  async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { value } = await telemetry.withStageSpan('transport_protocol', () =>
      handleMcpRequestUninstrumented(req, res),
    );
    return value;
  }

  async function handleMcpRequestUninstrumented(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const headerSessionId = req.headers[SESSION_ID_HEADER];
    const sessionId = Array.isArray(headerSessionId) ? headerSessionId[0] : headerSessionId;

    const connection = sessionId ? connections.get(sessionId) : undefined;

    if (!connection) {
      const body = req.method === 'POST' ? await readJsonBody(req) : undefined;

      if (req.method === 'POST' && isInitializeRequest(body)) {
        // ---- 02 §4.2 step [2a] — consumer authentication -----------------
        // FIRST, and before anything else in this branch. Nothing below runs
        // for a refused consumer: no `McpServer` is constructed, no transport
        // is created, no session id is minted, no session row is written, and
        // `resolveIdentity` (step [3]) is never called. That is what "is
        // served no tools/list ... never enumerates the catalogue" means
        // structurally rather than as a promise (02 §11.2).
        const gate = options.consumerAuth;
        const correlationId = randomUUID();
        if (gate === undefined) {
          // A gateway with no `[2a]` gate is misconfigured, not open. There is
          // no default-allow branch here by design (CLAUDE.md #1, #6).
          respondConsumerRefusal(res, 503, {
            code: 'INTERNAL',
            message:
              'This gateway was started without a consumer-authentication gate, so it can establish no MCP session.',
            condition:
              'MCPForge requires step [2a] consumer authentication on every session (02 §4.2, 02 §11.2). No gate was configured.',
            next: 'Start the gateway with its consumer registry wired in (`consumerAuth`). Report this correlationId to the MCPForge operator; no session was established and no catalogue was served.',
            retryable: false,
            correlationId,
          });
          return;
        }

        const outcome = await gate.authenticate(req.headers, correlationId);
        if (!outcome.ok) {
          const shape = outcome.error.toJSON();
          respondConsumerRefusal(res, CONSUMER_AUTH_STATUS[shape.code] ?? 403, shape);
          return;
        }

        // ---- 02 §4.2 step [3] — identity resolution ----------------------
        // Reachable only from here, i.e. only after [2a] returned ok.
        await gate.resolveIdentity?.(outcome.consumer, req.headers);

        // ---- W0-P15 — steps [2] + [3]: the human, bound to this session ----
        // The session id is minted HERE, before the SDK sees the request, so
        // the consumer's provenance can freeze it. A refusal leaves nothing
        // behind: no McpServer, no transport, no session row.
        const newSessionId = randomUUID();
        const state: SessionState = {};
        let handle: SessionHandle<unknown> | undefined;
        if (options.sessions !== undefined) {
          const established = await options.sessions.establish({
            auth: outcome,
            request: identityRequestFrom(req.headers),
            sessionId: newSessionId,
            correlationId,
          });
          if (!established.ok) {
            const shape = established.error.toJSON();
            respondConsumerRefusal(res, CONSUMER_AUTH_STATUS[shape.code] ?? 403, shape);
            return;
          }
          state.session = established.session;
          handle = { sessionId: newSessionId, current: () => state.session };
        }

        const server = options.createServer?.(handle) ?? createGatewayMcpServer(options.serverInfo);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newSessionId,
          onsessioninitialized: (initializedId) => {
            connections.set(initializedId, { transport, state });
            sessionStore.create(initializedId, negotiatedProtocolVersion(body));
          },
          onsessionclosed: (closedSessionId) => {
            connections.delete(closedSessionId);
            sessionStore.delete(closedSessionId);
          },
        });
        // Cast: the SDK's own `StreamableHTTPServerTransport` does not
        // structurally satisfy its own `Transport` interface under this
        // repo's `exactOptionalPropertyTypes: true` (an SDK typing gap, not
        // an MCPForge one — the class is used exactly per the SDK's own
        // documented usage).
        await server.connect(transport as unknown as Transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      // Non-initialize request with no known session: 02 §4.2 step [1] — the
      // transport layer refuses before anything downstream (auth, scope,
      // policy) is ever reached.
      res.writeHead(400, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: missing or unknown Mcp-Session-Id' },
          id: null,
        }),
      );
      return;
    }

    // ---- W0-P15 — every later request re-authenticates the SAME human -----
    if (options.sessions !== undefined) {
      const correlationId = randomUUID();
      const reverified = await options.sessions.reverify(
        connection.state.session,
        identityRequestFrom(req.headers),
        correlationId,
      );
      if (!reverified.ok) {
        const shape = reverified.error.toJSON();
        respondConsumerRefusal(res, CONSUMER_AUTH_STATUS[shape.code] ?? 403, shape);
        return;
      }
      connection.state.session = reverified.session;
    }

    await connection.transport.handleRequest(req, res);
  }

  const httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // W0-N2 — DCR is structurally absent, and its refusal is LEGIBLE. This
    // check precedes the 404 fall-through below on purpose: a 404 here would
    // read as "wrong path, try another one" and turn a governance decision
    // into a debugging session (05 §1.3.3).
    if (isDynamicClientRegistrationPath(url.pathname)) {
      const body = dynamicClientRegistrationRefusal(randomUUID());
      res
        .writeHead(DYNAMIC_CLIENT_REGISTRATION_STATUS, { 'content-type': 'application/json' })
        .end(JSON.stringify(body));
      return;
    }

    const metadata = options.publishedMetadata;
    if (
      metadata !== undefined &&
      url.pathname === new URL(metadata.path, 'http://localhost').pathname
    ) {
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify(assertNoRegistrationEndpoint(metadata.document)));
      return;
    }

    if (url.pathname !== MCP_PATH) {
      res.writeHead(404).end();
      return;
    }
    handleMcpRequest(req, res).catch((err: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: `Internal error: ${(err as Error).message}` },
          id: null,
        }),
      );
    });
  });

  return {
    httpServer,
    sessionStore,
    listen(port, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          const address = httpServer.address();
          const boundPort = typeof address === 'object' && address ? address.port : port;
          resolve({ port: boundPort });
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
        // Stop accepting, then drop idle keep-alive sockets so an idle client
        // cannot hold shutdown open until its keep-alive timeout expires.
        // In-flight requests still complete.
        httpServer.closeIdleConnections();
      });
    },
  };
}

/**
 * W0-N2. A `[2a]` refusal, as a JSON-RPC error whose `data` is the closed-
 * taxonomy `ForgeError` — so the agent gets its `next` (CLAUDE.md #5).
 *
 * **This response carries no catalogue.** It names no tool, no server, no
 * role and no package; the only identifiers in it are the ones the caller
 * already presented. `consumer-auth.http.test.ts` asserts exactly that, byte
 * for byte, because "is served no `tools/list`" has to mean "learns nothing
 * about the catalogue", not merely "got an error".
 */
function respondConsumerRefusal(
  res: ServerResponse,
  status: number,
  shape: {
    code: string;
    message: string;
    condition: string;
    next: string;
    retryable: boolean;
    correlationId: string;
  },
): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: shape.message, data: shape },
    }),
  );
}

function negotiatedProtocolVersion(initializeBody: unknown): string {
  const params = (initializeBody as { params?: { protocolVersion?: unknown } } | undefined)?.params;
  const requested = params?.protocolVersion;
  return typeof requested === 'string' ? requested : 'unknown';
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on('error', reject);
  });
}
