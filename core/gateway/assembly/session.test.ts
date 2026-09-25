// MCPForge — W0-P15. Session establishment over the REAL transport: consumer
// [2a], human [2]/[3], group->role mapping, the real ScopeContext, and per-
// request re-verification.

import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveScope } from '../scope/index.js';
import { loadDeploymentConfig, DeploymentConfigInvalid } from './deployment.js';
import { createSessionAssembly, SessionAssemblyUnavailable } from './session.js';
import {
  CLERK,
  NO_ROLE_USER,
  REPO_ROOT,
  consumerHeader,
  initialize,
  removeRepo,
  sessionOf,
  sessionRepo,
  startSessionWorld,
  type SessionWorld,
} from './session.test-support.js';
import { inMemoryRuntimeFlags } from '../scope/index.js';
import {
  DEFAULT_LOCAL_AUDIENCE,
  DEFAULT_LOCAL_ISSUER,
  generateLocalSigningKey,
  localIdentityProvider,
  localTokenIssuer,
  staticLocalPrincipalSource,
} from '../identity/index.js';

const worlds: SessionWorld[] = [];
const repos: string[] = [];
afterEach(async () => {
  while (worlds.length > 0) await worlds.pop()!.close();
  while (repos.length > 0) removeRepo(repos.pop()!);
});

async function world(
  consumers: Parameters<typeof sessionRepo>[0],
  registered: readonly string[],
): Promise<SessionWorld> {
  const repoRoot = sessionRepo(consumers);
  repos.push(repoRoot);
  const w = await startSessionWorld({ repoRoot, registered });
  worlds.push(w);
  return w;
}

function refusalCode(body: string): string | undefined {
  return (JSON.parse(body) as { error?: { data?: { code?: string } } }).error?.data?.code;
}

async function post(w: SessionWorld, sessionId: string, headers: Record<string, string>) {
  const r = await fetch(w.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
      'mcp-protocol-version': '2025-11-25',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
  });
  return { status: r.status, body: await r.text() };
}

describe('W0-P15 — a session is established only for a registered consumer AND a resolved human', () => {
  it('both present: the session carries the human, their mapped roles and the consumer', async () => {
    const w = await world([{ consumerId: 'test-agent', writeAllowed: true }], ['test-agent']);
    const r = await initialize(w, {
      ...consumerHeader(await w.assertion('test-agent')),
      authorization: `Bearer ${await w.tokenFor(CLERK.subject)}`,
    });
    expect(r.status).toBe(200);
    expect(r.sessionId).not.toBeNull();
    const s = sessionOf(w);
    expect(s.sessionId).toBe(r.sessionId);
    expect(s.principal.subject).toBe(CLERK.subject);
    expect(s.scopeSession.heldRoleIds).toEqual(['p2p']);
    expect(s.scopeSession.consumer.consumerId).toBe('test-agent');
    expect(s.scopeSession.consumerSession).toMatchObject({
      consumerId: 'test-agent',
      consumerSessionId: r.sessionId,
      authMethod: 'private-key-jwt',
    });
  });

  it('no bearer: AUTH_REQUIRED at initialize, no session, no server built', async () => {
    const w = await world([{ consumerId: 'test-agent', writeAllowed: true }], ['test-agent']);
    const r = await initialize(w, consumerHeader(await w.assertion('test-agent')));
    expect(r.status).toBe(401);
    expect(refusalCode(r.body)).toBe('AUTH_REQUIRED');
    expect(r.sessionId).toBeNull();
    expect(w.handles).toEqual([]);
    expect(w.gateway.sessionStore.size).toBe(0);
  });

  it('a verified token for nobody this deployment knows: IDENTITY_UNRESOLVED, no session', async () => {
    const w = await world([{ consumerId: 'test-agent', writeAllowed: true }], ['test-agent']);
    const token = await w.tokenFor(CLERK.subject);
    w.removeUser(CLERK.subject); // deactivated after the token was issued
    const r = await initialize(w, {
      ...consumerHeader(await w.assertion('test-agent')),
      authorization: `Bearer ${token}`,
    });
    expect(r.status).toBe(403);
    expect(refusalCode(r.body)).toBe('IDENTITY_UNRESOLVED');
    expect(r.sessionId).toBeNull();
    expect(w.handles).toEqual([]);
  });

  it('an unregistered consumer with a valid human: CONSUMER_UNREGISTERED, the human is never resolved', async () => {
    const w = await world([{ consumerId: 'test-agent', writeAllowed: true }], []);
    const r = await initialize(w, {
      ...consumerHeader(await w.assertion('test-agent')),
      authorization: `Bearer ${await w.tokenFor(CLERK.subject)}`,
    });
    expect(r.status).toBe(401);
    expect(refusalCode(r.body)).toBe('CONSUMER_UNREGISTERED');
    expect(w.handles).toEqual([]);
  });

  it('a registered consumer with no compiled authorization holds no session', async () => {
    const w = await world([], ['test-agent']);
    const r = await initialize(w, {
      ...consumerHeader(await w.assertion('test-agent')),
      authorization: `Bearer ${await w.tokenFor(CLERK.subject)}`,
    });
    expect(refusalCode(r.body)).toBe('CONSUMER_UNREGISTERED');
    expect(w.handles).toEqual([]);
  });

  it('a compiled registration that is not active holds no session', async () => {
    const w = await world(
      [{ consumerId: 'test-agent', writeAllowed: true, effectiveStatus: 'suspended' }],
      ['test-agent'],
    );
    const r = await initialize(w, {
      ...consumerHeader(await w.assertion('test-agent')),
      authorization: `Bearer ${await w.tokenFor(CLERK.subject)}`,
    });
    expect(r.status).toBe(403);
    expect(refusalCode(r.body)).toBe('CONSUMER_SUSPENDED');
  });
});

describe('W0-P15 — authorization is the INTERSECTION of consumer and human (non-negotiable #6)', () => {
  it('a read-only consumer hides every write tool the human could otherwise see', async () => {
    const w = await world([{ consumerId: 'reader', writeAllowed: false }], ['reader']);
    await initialize(w, {
      ...consumerHeader(await w.assertion('reader')),
      authorization: `Bearer ${await w.tokenFor(CLERK.subject)}`,
    });
    const visible = resolveScope(w.catalogue.entries, sessionOf(w).scopeAt()).visible;
    const writes = w.catalogue.entries.filter((e) => e.write).map((e) => e.toolId);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.filter((id) => writes.includes(id))).toEqual([]);
  });

  it('a human with no mapped role sees nothing, however broad the consumer', async () => {
    const w = await world([{ consumerId: 'test-agent', writeAllowed: true }], ['test-agent']);
    await initialize(w, {
      ...consumerHeader(await w.assertion('test-agent')),
      authorization: `Bearer ${await w.tokenFor(NO_ROLE_USER.subject)}`,
    });
    const s = sessionOf(w);
    expect(s.scopeSession.heldRoleIds).toEqual([]);
    expect(resolveScope(w.catalogue.entries, s.scopeAt()).visible).toEqual([]);
  });

  it('a consumer whose roles do not include the human’s role sees nothing', async () => {
    const w = await world(
      [{ consumerId: 'test-agent', writeAllowed: true, roles: ['o2c'] }],
      ['test-agent'],
    );
    await initialize(w, {
      ...consumerHeader(await w.assertion('test-agent')),
      authorization: `Bearer ${await w.tokenFor(CLERK.subject)}`,
    });
    expect(resolveScope(w.catalogue.entries, sessionOf(w).scopeAt()).visible).toEqual([]);
  });

  it('both broad: the p2p selection is visible, writes included', async () => {
    const w = await world([{ consumerId: 'test-agent', writeAllowed: true }], ['test-agent']);
    await initialize(w, {
      ...consumerHeader(await w.assertion('test-agent')),
      authorization: `Bearer ${await w.tokenFor(CLERK.subject)}`,
    });
    const visible = resolveScope(w.catalogue.entries, sessionOf(w).scopeAt()).visible;
    expect(visible).toContain('jde.ap.voucher.create');
    expect(visible).toContain('jde.ap.voucher.search');
  });
});

describe('W0-P15 — every later request re-authenticates the SAME human', () => {
  async function established(w: SessionWorld): Promise<string> {
    const r = await initialize(w, {
      ...consumerHeader(await w.assertion('test-agent')),
      authorization: `Bearer ${await w.tokenFor(CLERK.subject)}`,
    });
    return r.sessionId!;
  }

  it('the same human: served', async () => {
    const w = await world([{ consumerId: 'test-agent', writeAllowed: true }], ['test-agent']);
    const sid = await established(w);
    const r = await post(w, sid, { authorization: `Bearer ${await w.tokenFor(CLERK.subject)}` });
    expect(r.status).toBe(200);
  });

  it('no bearer on a live session id: refused before the MCP server sees it', async () => {
    const w = await world([{ consumerId: 'test-agent', writeAllowed: true }], ['test-agent']);
    const sid = await established(w);
    const r = await post(w, sid, {});
    expect(r.status).toBe(401);
    expect(refusalCode(r.body)).toBe('AUTH_REQUIRED');
  });

  it('another person’s valid token on this session id: refused, the session is not theirs', async () => {
    const w = await world([{ consumerId: 'test-agent', writeAllowed: true }], ['test-agent']);
    const sid = await established(w);
    const r = await post(w, sid, {
      authorization: `Bearer ${await w.tokenFor(NO_ROLE_USER.subject)}`,
    });
    expect(r.status).toBe(401);
    expect(refusalCode(r.body)).toBe('AUTH_REQUIRED');
    expect(sessionOf(w).principal.subject).toBe(CLERK.subject);
  });
});

describe('W0-P15 — startup reads committed artefacts and fails closed', () => {
  const flags = inMemoryRuntimeFlags();
  const identity = localIdentityProvider({
    issuer: localTokenIssuer({
      signingKey: generateLocalSigningKey(),
      issuer: DEFAULT_LOCAL_ISSUER,
      audience: DEFAULT_LOCAL_AUDIENCE,
    }),
    source: staticLocalPrincipalSource([]),
  });

  it('the shipped local overlay selects jde-fin', () => {
    expect(loadDeploymentConfig(REPO_ROOT, 'local').packageIds).toEqual(['jde-fin']);
  });

  it('the shipped local mapping is surfaced: it grants roles that do not exist', () => {
    const assembly = createSessionAssembly({
      repoRoot: REPO_ROOT,
      deployment: 'local',
      identity,
      flags,
    });
    expect(assembly.warnings.join('\n')).toMatch(/p2p-ap-clerk/);
  });

  it('with no probe report, nothing is visible (02 §4.5)', async () => {
    const repoRoot = sessionRepo([{ consumerId: 'test-agent', writeAllowed: true }]);
    repos.push(repoRoot);
    const w = await startSessionWorld({
      repoRoot,
      registered: ['test-agent'],
      probe: 'repo-default',
    });
    worlds.push(w);
    await initialize(w, {
      ...consumerHeader(await w.assertion('test-agent')),
      authorization: `Bearer ${await w.tokenFor(CLERK.subject)}`,
    });
    expect(resolveScope(w.catalogue.entries, sessionOf(w).scopeAt()).visible).toEqual([]);
  });

  it('a missing deployment overlay refuses to build sessions', () => {
    const repoRoot = sessionRepo([]);
    repos.push(repoRoot);
    rmSync(join(repoRoot, 'overlays', 'local', 'deployment.yaml'));
    expect(() => createSessionAssembly({ repoRoot, deployment: 'local', identity, flags })).toThrow(
      SessionAssemblyUnavailable,
    );
  });

  it('a deployment overlay naming an uncompiled package, or an undeclared key, is refused', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'mcpforge-p15-dep-'));
    repos.push(repoRoot);
    cpSync(join(REPO_ROOT, 'generated', 'packages'), join(repoRoot, 'generated', 'packages'), {
      recursive: true,
    });
    const file = join(repoRoot, 'overlays', 'local', 'deployment.yaml');
    cpSync(join(REPO_ROOT, 'overlays', 'local', 'deployment.yaml'), file);
    writeFileSync(
      file,
      'apiVersion: mcpforge/v1\nkind: Deployment\ndeployment: local\npackages: [jde-fin, ghost]\ndefaultRole: p2p\n',
    );
    try {
      loadDeploymentConfig(repoRoot, 'local');
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(DeploymentConfigInvalid);
      const problems = (error as DeploymentConfigInvalid).problems.join('\n');
      expect(problems).toMatch(/ghost has no compiled selection/);
      expect(problems).toMatch(/defaultRole is not declared/);
    }
  });

  it('a mapping file claiming another deployment is refused', () => {
    const repoRoot = sessionRepo([]);
    repos.push(repoRoot);
    writeFileSync(
      join(repoRoot, 'overlays', 'local', 'mappings', 'groups-to-roles.yaml'),
      'apiVersion: mcpforge/v1\nkind: GroupRoleMapping\ndeployment: prod\ngroups: {}\n',
    );
    expect(() => createSessionAssembly({ repoRoot, deployment: 'local', identity, flags })).toThrow(
      /declares deployment "prod"/,
    );
  });
});
