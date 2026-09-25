// MCPForge — W0-P15. The consumer and identity escalation cases, against the
// REAL session: the real transport, the real ConsumerAuthenticator, the real
// local IdentityProvider, the real group->role mapping reader and the real
// session assembly over committed artefacts. `escalation.consumer.test.ts`
// proves the same properties at the scope/policy layer over fixtures; this file
// proves they hold where a live client actually arrives.
//
// Every attempt must FAIL CLOSED.

import { afterEach, describe, expect, it } from 'vitest';
import { resolveScope, scopeRefusalError } from '../../core/gateway/scope/index.js';
import {
  CLERK,
  consumerHeader,
  initialize,
  removeRepo,
  sessionOf,
  sessionRepo,
  startSessionWorld,
  type SessionWorld,
} from '../../core/gateway/assembly/session.test-support.js';

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

function code(body: string): string | undefined {
  return (JSON.parse(body) as { error?: { data?: { code?: string } } }).error?.data?.code;
}

function noCatalogue(body: string): void {
  expect(body).not.toContain('"tools"');
  expect(body).not.toContain('"result"');
  expect(body).not.toContain('jde.');
}

describe('W0-P15 [P5] case 5, real session — an unregistered consumer with a VALID human token', () => {
  it('is refused at session establishment with CONSUMER_UNREGISTERED and served no catalogue', async () => {
    const w = await world([{ consumerId: 'ghost-agent', writeAllowed: true }], []);
    const r = await initialize(w, {
      ...consumerHeader(await w.assertion('ghost-agent')),
      authorization: `Bearer ${await w.tokenFor(CLERK.subject)}`,
    });
    expect(r.status).toBe(401);
    expect(code(r.body)).toBe('CONSUMER_UNREGISTERED');
    expect(r.sessionId).toBeNull();
    noCatalogue(r.body);
    expect(w.handles).toEqual([]);
  });
});

describe('W0-P15 non-negotiable #6, real session — a REGISTERED consumer with no resolvable human', () => {
  it('no human credential: AUTH_REQUIRED, no session, no catalogue', async () => {
    const w = await world([{ consumerId: 'test-agent', writeAllowed: true }], ['test-agent']);
    const r = await initialize(w, consumerHeader(await w.assertion('test-agent')));
    expect(code(r.body)).toBe('AUTH_REQUIRED');
    expect(r.sessionId).toBeNull();
    noCatalogue(r.body);
  });

  it('a verified token naming nobody this deployment knows: IDENTITY_UNRESOLVED, no session', async () => {
    const w = await world([{ consumerId: 'test-agent', writeAllowed: true }], ['test-agent']);
    const token = await w.tokenFor(CLERK.subject);
    w.removeUser(CLERK.subject);
    const r = await initialize(w, {
      ...consumerHeader(await w.assertion('test-agent')),
      authorization: `Bearer ${token}`,
    });
    expect(code(r.body)).toBe('IDENTITY_UNRESOLVED');
    expect(r.sessionId).toBeNull();
    noCatalogue(r.body);
  });

  it('a forged human token (signed by another issuer): refused, no session', async () => {
    const w = await world([{ consumerId: 'test-agent', writeAllowed: true }], ['test-agent']);
    const other = await world([{ consumerId: 'test-agent', writeAllowed: true }], ['test-agent']);
    const r = await initialize(w, {
      ...consumerHeader(await w.assertion('test-agent')),
      authorization: `Bearer ${await other.tokenFor(CLERK.subject)}`,
    });
    expect(code(r.body)).toBe('AUTH_REQUIRED');
    expect(r.sessionId).toBeNull();
  });
});

describe('W0-P15 non-negotiable #6, real session — the INTERSECTION, never the union', () => {
  it('a read-only consumer: every write tool is refused CONSUMER_NOT_AUTHORIZED even though the human holds p2p', async () => {
    const w = await world([{ consumerId: 'reader', writeAllowed: false }], ['reader']);
    await initialize(w, {
      ...consumerHeader(await w.assertion('reader')),
      authorization: `Bearer ${await w.tokenFor(CLERK.subject)}`,
    });
    const scope = sessionOf(w).scopeAt();
    expect(scope.session.heldRoleIds).toContain('p2p');
    const resolution = resolveScope(w.catalogue.entries, scope);
    for (const entry of w.catalogue.entries.filter((e) => e.write)) {
      expect(resolution.visible).not.toContain(entry.toolId);
      expect(scopeRefusalError(entry.toolId, resolution, 'c')?.code).toBe(
        'CONSUMER_NOT_AUTHORIZED',
      );
    }
  });
});

describe('W0-P15 [P5] case 6, real session — a consumer killed MID-SESSION', () => {
  it('its live session sees nothing on the next resolution, with no new session and no redeploy', async () => {
    const w = await world([{ consumerId: 'test-agent', writeAllowed: true }], ['test-agent']);
    await initialize(w, {
      ...consumerHeader(await w.assertion('test-agent')),
      authorization: `Bearer ${await w.tokenFor(CLERK.subject)}`,
    });
    const session = sessionOf(w);
    expect(resolveScope(w.catalogue.entries, session.scopeAt()).visible.length).toBeGreaterThan(0);
    w.flags.set([{ scope: 'consumer', target: 'test-agent', reason: 'credential leaked' }]);
    expect(resolveScope(w.catalogue.entries, session.scopeAt()).visible).toEqual([]);
  });
});
