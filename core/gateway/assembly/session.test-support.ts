// MCPForge — W0-P15 test support: a real session world over a temp repo.
//
// Everything on the session path is the shipped code: the real transport, the
// real ConsumerAuthenticator (private-key-JWT, replay store), the real local
// IdentityProvider and token issuer, the real group->role mapping reader and
// the real session assembly reading real committed artefacts. The temp repo
// copies `generated/roles`, `generated/packages` and the local deployment
// overlay from this repository, and adds only what a test must control: its
// own group->role mapping and its own consumer's compiled authorization.
//
// Not a production file: `.test-support.ts` is excluded from the trust-boundary
// production walk and from the build.

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConsumerRecord } from '../consumer/index.js';
import {
  inMemoryRuntimeFlags,
  staticProbeStatuses,
  type ProbeStatusSource,
} from '../scope/index.js';
import {
  DEFAULT_LOCAL_AUDIENCE,
  DEFAULT_LOCAL_ISSUER,
  generateLocalSigningKey,
  localIdentityProvider,
  localTokenIssuer,
  type LocalPrincipalRecord,
} from '../identity/index.js';
import {
  ConsumerAuthenticator,
  createGatewayHttpTransport,
  MCPFORGE_CONSUMER_ASSERTION_HEADER,
  readConsumerPresentation,
  type GatewayHttpTransport,
  type SessionHandle,
} from '../transport/index.js';
import { createGatewayMcpServer } from '../transport/server.js';
import {
  generateTestConsumerKeypair,
  signTestAssertion,
  testConsumerRecord,
  testRegistry,
  type TestKeypair,
} from '../transport/consumer-auth/testkit.js';
import { loadRuntimeCatalogue, type RuntimeCatalogue } from './catalogue.js';
import { createSessionAssembly, type EstablishedSession, type SessionAssembly } from './session.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..', '..');
export const AUDIENCE = 'https://mcpforge.test/mcp';

export const CLERK: LocalPrincipalRecord = {
  subject: 'local:a.clerk',
  displayName: 'A. Clerk',
  groups: ['finance-ap-clerks'],
};
export const NO_ROLE_USER: LocalPrincipalRecord = {
  subject: 'local:no.roles',
  displayName: 'No Roles',
  groups: ['canteen'],
};

/** The test deployment's mapping: one group -> the one role that exists. */
const TEST_MAPPING = `apiVersion: mcpforge/v1
kind: GroupRoleMapping
deployment: local
groups:
  finance-ap-clerks:
    roles: [p2p]
`;

export interface ConsumerAuthorizationFixture {
  readonly consumerId: string;
  readonly writeAllowed: boolean;
  readonly effectiveStatus?: string;
  readonly roles?: readonly string[];
}

/** A temp repo with the committed artefacts sessions read, plus the test's own. */
export function sessionRepo(consumers: readonly ConsumerAuthorizationFixture[]): string {
  const root = mkdtempSync(join(tmpdir(), 'mcpforge-p15-'));
  for (const rel of ['generated/roles', 'generated/packages']) {
    cpSync(join(REPO_ROOT, rel), join(root, rel), { recursive: true });
  }
  cpSync(
    join(REPO_ROOT, 'overlays', 'local', 'deployment.yaml'),
    join(root, 'overlays', 'local', 'deployment.yaml'),
  );
  mkdirSync(join(root, 'overlays', 'local', 'mappings'), { recursive: true });
  writeFileSync(join(root, 'overlays', 'local', 'mappings', 'groups-to-roles.yaml'), TEST_MAPPING);
  mkdirSync(join(root, 'generated', 'consumers'), { recursive: true });
  for (const c of consumers) {
    writeFileSync(
      join(root, 'generated', 'consumers', `${c.consumerId}.authorization.json`),
      JSON.stringify({
        consumerId: c.consumerId,
        effectiveStatus: c.effectiveStatus ?? 'active',
        authorizations: {
          bindingTypes: ['function'],
          maxSensitivity: 'financial',
          writeAllowed: c.writeAllowed,
          roles: [...(c.roles ?? ['p2p'])],
          packages: ['jde-fin'],
        },
        attestation: { humanInTheLoop: true },
      }),
    );
  }
  return root;
}

export function removeRepo(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** Every catalogue tool probe-resolved, so visibility reflects grants alone. */
export function allResolved(catalogue: RuntimeCatalogue): ProbeStatusSource {
  return staticProbeStatuses(new Map(catalogue.toolIds.map((id) => [id, 'resolved' as const])));
}

let catalogueOnce: Promise<RuntimeCatalogue> | undefined;
/** The real runtime catalogue, loaded once per test file (it runs forge validate). */
function sharedCatalogue(): Promise<RuntimeCatalogue> {
  catalogueOnce ??= loadRuntimeCatalogue({ repoRoot: REPO_ROOT });
  return catalogueOnce;
}

export interface SessionWorld {
  readonly gateway: GatewayHttpTransport;
  readonly url: string;
  readonly assembly: SessionAssembly;
  readonly catalogue: RuntimeCatalogue;
  readonly keypair: TestKeypair;
  /** Every session handle the transport handed to the server factory. */
  readonly handles: SessionHandle<unknown>[];
  /** The runtime-flags source the sessions read (kill switches). */
  readonly flags: ReturnType<typeof inMemoryRuntimeFlags>;
  tokenFor(subject: string): Promise<string>;
  /** Deactivate a user in the local store (their already-issued tokens still verify). */
  removeUser(subject: string): void;
  assertion(consumerId: string): Promise<string>;
  close(): Promise<void>;
}

export async function startSessionWorld(input: {
  readonly repoRoot: string;
  /** Consumers REGISTERED in the registry (step [2a]). */
  readonly registered: readonly string[];
  readonly users?: readonly LocalPrincipalRecord[];
  /** Omitted: every tool resolved. `'repo-default'`: the assembly's own default (the repo's probe report). */
  readonly probe?: ProbeStatusSource | 'repo-default';
  readonly consumerRecord?: (id: string, keypair: TestKeypair) => ConsumerRecord;
}): Promise<SessionWorld> {
  const catalogue = await sharedCatalogue();
  const keypair = await generateTestConsumerKeypair();
  const issuer = localTokenIssuer({
    signingKey: generateLocalSigningKey(),
    issuer: DEFAULT_LOCAL_ISSUER,
    audience: DEFAULT_LOCAL_AUDIENCE,
  });
  const flags = inMemoryRuntimeFlags();
  const users = [...(input.users ?? [CLERK, NO_ROLE_USER])];
  const identity = localIdentityProvider({
    issuer,
    source: {
      findBySubject: (subject) => Promise.resolve(users.find((u) => u.subject === subject)),
    },
  });
  const assembly = createSessionAssembly({
    repoRoot: input.repoRoot,
    deployment: 'local',
    identity,
    flags,
    ...(input.probe === 'repo-default' ? {} : { probe: input.probe ?? allResolved(catalogue) }),
  });
  const records = input.registered.map(
    (id) =>
      input.consumerRecord?.(id, keypair) ??
      testConsumerRecord({
        id,
        publicKeys: [
          {
            kid: keypair.kid,
            kty: 'OKP',
            crv: 'Ed25519',
            x: keypair.publicJwk.x,
            addedAt: '2026-08-27',
          },
        ],
      }),
  );
  const authenticator = new ConsumerAuthenticator({
    registry: testRegistry(records),
    audience: AUDIENCE,
  });
  const handles: SessionHandle<unknown>[] = [];
  const gateway = createGatewayHttpTransport({
    consumerAuth: {
      authenticate: (headers, correlationId) =>
        authenticator.authenticate(readConsumerPresentation(headers), correlationId),
    },
    sessions: assembly,
    createServer: (handle) => {
      if (handle !== undefined) handles.push(handle);
      // The W0-E1 skeleton server: this task binds the session; serving the
      // real surface over it is W0-P16.
      return createGatewayMcpServer();
    },
  });
  const { port } = await gateway.listen(0);
  return {
    gateway,
    url: `http://127.0.0.1:${port}/mcp`,
    assembly,
    catalogue,
    keypair,
    handles,
    flags,
    tokenFor: async (subject) => (await identity.issueToken(subject, ['pwd'], 'test')).token,
    removeUser: (subject) => {
      const i = users.findIndex((u) => u.subject === subject);
      if (i >= 0) users.splice(i, 1);
    },
    assertion: (consumerId) => signTestAssertion({ consumerId, audience: AUDIENCE, keypair }),
    close: () => gateway.close(),
  };
}

export async function initialize(
  world: SessionWorld,
  headers: Record<string, string>,
): Promise<{ status: number; body: string; sessionId: string | null }> {
  const response = await fetch(world.url, {
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
        clientInfo: { name: 'w0-p15', version: '0.0.0' },
      },
    }),
  });
  return {
    status: response.status,
    body: await response.text(),
    sessionId: response.headers.get('mcp-session-id'),
  };
}

export function consumerHeader(assertion: string): Record<string, string> {
  return { [MCPFORGE_CONSUMER_ASSERTION_HEADER]: assertion };
}

export function sessionOf(world: SessionWorld): EstablishedSession {
  const handle = world.handles.at(-1);
  if (handle === undefined) throw new Error('no session was bound');
  return handle.current() as EstablishedSession;
}
