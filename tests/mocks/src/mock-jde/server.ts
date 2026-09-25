// MCPForge — a LOCAL MOCK JD EDWARDS, reached over real HTTP. W0-P14.
//
// Owner decision (W0-P11 (2)): the live target at Wave 0 is a local mock JDE
// reached over a real HTTP AIS client, never an in-process fake in production
// code. This is that mock. It lives under `tests/mocks/**` and nothing under
// `core/**` or `adapters/**` may import it; production code reaches it only by
// URL, from the overlay.
//
// It implements the two halves 02 §3.5 option (a) needs:
//
//   * A TRUSTED TOKEN PROVIDER (`POST /jderest/mcpforge/token`). The gateway
//     authenticates as itself (HTTP Basic, a client id and secret it was
//     provisioned with) and asks for a per-user token for one subject. An
//     unknown client is 401. A subject that is not a provisioned user is 404,
//     never a default user. The protocol is documented in
//     adapters/function/src/http/token-provider.ts.
//   * AIS ORCHESTRATIONS (`POST /jderest/v3/orchestrator/<name>`, auth header
//     `jde-AIS-Auth`). A missing, unknown or expired token is 401. Every
//     orchestration EXECUTES AS THE TOKEN'S USER and composes the identity-echo
//     final step the way a steward-built orchestration does (02 §3.5): the
//     response carries `MCPFORGE_PROBE_WHOAMI: { MCPFORGE_EXECUTING_USER }`,
//     upper-cased as JDE reports user ids. The echo therefore PROVES identity
//     carriage end to end instead of restating it.
//
// Every request is recorded, including the ones it refused, so a test can
// assert that a refused call never reached an orchestration at all.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const MOCK_JDE_TOKEN_PATH = '/jderest/mcpforge/token';
export const MOCK_JDE_ORCHESTRATOR_PREFIX = '/jderest/v3/orchestrator/';
export const PROBE_STEP = 'MCPFORGE_PROBE_WHOAMI';
export const EXECUTING_USER_KEY = 'MCPFORGE_EXECUTING_USER';

/** What an orchestration handler sees. `user` is the JDE user the token names. */
export interface OrchestrationContext {
  readonly orchestration: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly user: string;
}

/** A handler's answer. `body` is the business output; the echo step is added for 2xx answers. */
export interface OrchestrationAnswer {
  readonly status?: number;
  readonly body: Record<string, unknown>;
}

export type OrchestrationHandler = (
  ctx: OrchestrationContext,
) => OrchestrationAnswer | Promise<OrchestrationAnswer>;

export interface MockJdeConfig {
  /** Subjects provisioned as JDE users. Anyone else gets no token. */
  readonly users: readonly string[];
  /** Token-provider clients: client id -> secret. */
  readonly clients: Readonly<Record<string, string>>;
  readonly tokenTtlSeconds?: number;
  /** Per-orchestration behaviour; anything unlisted uses the defaults below. */
  readonly orchestrations?: Readonly<Record<string, OrchestrationHandler>>;
  /**
   * Model a MISCONFIGURED instance: every orchestration runs as this user
   * regardless of the token (for example, SSO silently falling back to a
   * service account). The runtime echo must catch it.
   */
  readonly forceExecutingUser?: string;
  readonly now?: () => number;
}

export interface MockJdeRequest {
  readonly kind: 'token' | 'orchestration' | 'other';
  readonly path: string;
  readonly status: number;
  /** For a token request: the subject asked for. */
  readonly subject?: string;
  readonly clientId?: string;
  /** For an orchestration that RAN: its name, inputs and the user it ran as. */
  readonly orchestration?: string;
  readonly orchestrationVersion?: string;
  readonly correlationId?: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly executedAs?: string;
}

export interface MockJde {
  /** `http://127.0.0.1:<port>` */
  readonly origin: string;
  /** The AIS REST root for `ais-targets.yaml`'s `baseUrl`. */
  readonly baseUrl: string;
  readonly tokenUrl: string;
  readonly requests: readonly MockJdeRequest[];
  /** Orchestrations that actually ran (status 2xx or an application error). */
  ran(): readonly MockJdeRequest[];
  close(): Promise<void>;
}

/** JDE reports user ids upper-cased. */
function jdeUserFor(subject: string): string {
  return subject.trim().toUpperCase();
}

let docSeq = 70_000;

/** Plausible default behaviour for the Wave 0 JDE orchestrations. */
export const DEFAULT_ORCHESTRATIONS: Readonly<Record<string, OrchestrationHandler>> = {
  AP_VOUCHER_CREATE: ({ inputs }) => ({
    body: {
      voucher: {
        docNumber: String((docSeq += 1)),
        docType: 'PV',
        docCo: String(inputs['company'] ?? ''),
      },
      status: 'CREATED',
    },
  }),
  AP_VOUCHER_CANCEL: ({ inputs }) => ({
    body: {
      voucher: {
        docNumber: String(inputs['document_number'] ?? ''),
        docType: String(inputs['document_type'] ?? ''),
        docCo: String(inputs['document_company'] ?? ''),
        status: 'CANCELLED',
      },
    },
  }),
};

function genericAnswer({ orchestration, inputs }: OrchestrationContext): OrchestrationAnswer {
  if (orchestration.endsWith('_VALIDATE')) return { body: { valid: true, warnings: [] } };
  return { body: { orchestration, echo: inputs } };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, doc: unknown): void {
  const text = JSON.stringify(doc);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function secretsEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

function parseBasic(header: string | undefined): { id: string; secret: string } | null {
  if (header === undefined || !header.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  return i < 0 ? null : { id: decoded.slice(0, i), secret: decoded.slice(i + 1) };
}

export async function startMockJde(
  config: MockJdeConfig,
  listen: { readonly port?: number; readonly host?: string } = {},
): Promise<MockJde> {
  const now = config.now ?? (() => Date.now());
  const ttl = config.tokenTtlSeconds ?? 1800;
  const users = new Set(config.users.map((u) => u.trim().toLowerCase()));
  const tokens = new Map<string, { user: string; expiresAt: number }>();
  const handlers = { ...DEFAULT_ORCHESTRATIONS, ...(config.orchestrations ?? {}) };
  const requests: MockJdeRequest[] = [];

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://mock').pathname;
    const text = await readBody(req);

    if (req.method === 'POST' && path === MOCK_JDE_TOKEN_PATH) {
      const basic = parseBasic(req.headers['authorization']);
      const known = basic === null ? undefined : config.clients[basic.id];
      if (basic === null || known === undefined || !secretsEqual(known, basic.secret)) {
        requests.push({
          kind: 'token',
          path,
          status: 401,
          ...(basic ? { clientId: basic.id } : {}),
        });
        send(res, 401, { message: 'Unknown token-provider client.' });
        return;
      }
      let subject: unknown;
      try {
        subject = (JSON.parse(text) as { subject?: unknown }).subject;
      } catch {
        subject = undefined;
      }
      if (typeof subject !== 'string' || !users.has(subject.trim().toLowerCase())) {
        requests.push({
          kind: 'token',
          path,
          status: 404,
          clientId: basic.id,
          ...(typeof subject === 'string' ? { subject } : {}),
        });
        send(res, 404, { message: 'No JD Edwards user is provisioned for this subject.' });
        return;
      }
      const token = randomBytes(24).toString('base64url');
      const user = jdeUserFor(subject);
      tokens.set(token, { user, expiresAt: now() + ttl * 1000 });
      requests.push({ kind: 'token', path, status: 200, clientId: basic.id, subject });
      send(res, 200, { token, expiresInSeconds: ttl, username: user });
      return;
    }

    if (req.method === 'POST' && path.startsWith(MOCK_JDE_ORCHESTRATOR_PREFIX)) {
      const orchestration = decodeURIComponent(path.slice(MOCK_JDE_ORCHESTRATOR_PREFIX.length));
      const header = req.headers['jde-ais-auth'];
      const session = typeof header === 'string' ? tokens.get(header) : undefined;
      if (session === undefined || session.expiresAt <= now()) {
        requests.push({ kind: 'orchestration', path, status: 401, orchestration });
        send(res, 401, { message: 'Invalid or expired AIS token.' });
        return;
      }
      let inputs: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          inputs = parsed as Record<string, unknown>;
        }
      } catch {
        requests.push({ kind: 'orchestration', path, status: 400, orchestration });
        send(res, 400, { message: 'Request body is not JSON.' });
        return;
      }
      const executedAs = config.forceExecutingUser ?? session.user;
      const handler = handlers[orchestration] ?? genericAnswer;
      const answer = await handler({ orchestration, inputs, user: executedAs });
      const status = answer.status ?? 200;
      const version = req.headers['x-mcpforge-orchestration-version'];
      const correlation = req.headers['x-mcpforge-correlation-id'];
      requests.push({
        kind: 'orchestration',
        path,
        status,
        orchestration,
        inputs,
        executedAs,
        ...(typeof version === 'string' ? { orchestrationVersion: version } : {}),
        ...(typeof correlation === 'string' ? { correlationId: correlation } : {}),
      });
      const body =
        status >= 200 && status < 300
          ? { ...answer.body, [PROBE_STEP]: { [EXECUTING_USER_KEY]: executedAs } }
          : answer.body;
      send(res, status, body);
      return;
    }

    requests.push({ kind: 'other', path, status: 404 });
    send(res, 404, { message: `No such AIS resource: ${req.method ?? ''} ${path}` });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      send(res, 500, { message: error instanceof Error ? error.message : String(error) });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(listen.port ?? 0, listen.host ?? '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  const origin = `http://${address.address}:${address.port}`;

  return {
    origin,
    baseUrl: `${origin}/jderest`,
    tokenUrl: `${origin}${MOCK_JDE_TOKEN_PATH}`,
    requests,
    ran: () => requests.filter((r) => r.kind === 'orchestration' && r.executedAs !== undefined),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
