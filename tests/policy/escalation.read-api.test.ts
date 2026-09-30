// W0-P3a — the read-only governance API (`/api/v1/**`) must fail closed.
//
// W0-P2 §7: "an unregistered consumer and an unresolved human must both be
// refused on /api/v1/** exactly as on /mcp (non-negotiable #6)", and its
// authn/authz tests belong here. Every case below is an attempt to read more
// than the caller is entitled to, against the REAL launched gateway:
//
//   - no consumer, no human, a human without a consumer, a replayed assertion;
//   - a write method (the API is read-only);
//   - rows outside the READ AUTHORITY (owner decision, 27 Sep 2026: the tool
//     must be in Deployed ∩ Granted ∩ ConsumerAuthorized, or the row must be
//     the viewer's own), by list, by id and by paging;
//   - the consumer half of the intersection: the same human through a
//     narrower consumer sees less.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  approvalsResponseSchema,
  auditVerifyResponseSchema,
  callDetailResponseSchema,
  callsPageSchema,
  consumerUsageResponseSchema,
  deploymentResponseSchema,
  enablementResponseSchema,
} from '../../core/shared/src/api/v1/index.js';
import { launchGateway, type LaunchedGateway } from '../../core/gateway/launch.js';
import {
  launchRepo,
  removeLaunchRepo,
  TEST_CONSUMER,
  TEST_GROUP,
} from '../../core/gateway/launch.test-support.js';
import { EncryptedFileStore } from '../../core/gateway/secrets/server.js';
import { localUserStore } from '../../core/gateway/identity/index.js';
import {
  generateTestConsumerKeypair,
  signTestAssertion,
  testConsumerRecord,
  type TestKeypair,
} from '../../core/gateway/transport/consumer-auth/testkit.js';
import { MCPFORGE_CONSUMER_ASSERTION_HEADER } from '../../core/gateway/transport/index.js';

const AUDIENCE = 'https://mcpforge.local/mcp';
const SECRETS_ENV = { MCPFORGE_SECRETS_KEY: 'w0-p3a-test-only-sealing-passphrase' };
const NARROW_CONSUMER = 'narrow-agent';
const CLERK = { username: 'p3a-clerk', subject: 'local:p3a-clerk' };
const OUTSIDER = { username: 'p3a-outsider', subject: 'local:p3a-outsider' };
const PASSWORD = 'a-long-enough-test-password-1';
const IN_SCOPE_TOOL = 'jde.ap.voucher.search';
const OUT_OF_SCOPE_TOOL = 'jde.hr.employee.get';

describe('W0-P3a — /api/v1 fails closed', () => {
  let repo: string;
  let launched: LaunchedGateway;
  let keypair: TestKeypair;
  let narrowKeypair: TestKeypair;
  let base: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    keypair = await generateTestConsumerKeypair();
    narrowKeypair = await generateTestConsumerKeypair('narrow-a');
    repo = launchRepo({
      keypair,
      aisBaseUrl: 'http://127.0.0.1:9/unused',
      aisTokenUrl: 'http://127.0.0.1:9/unused',
      grantRefs: [],
    });

    // A second consumer for the SAME human: registered, active, but
    // authorized for no binding type, so it narrows the intersection to
    // nothing but the viewer's own rows.
    const narrow = testConsumerRecord({
      id: NARROW_CONSUMER,
      publicKeys: [
        {
          kid: narrowKeypair.kid,
          kty: 'OKP',
          crv: 'Ed25519',
          x: narrowKeypair.publicJwk.x,
          addedAt: '2026-08-27',
        },
      ],
    });
    const narrowRecord = {
      ...narrow,
      authorizations: { ...narrow.authorizations, bindingTypes: [] },
    };
    writeFileSync(
      join(repo, 'consumers', `${NARROW_CONSUMER}.consumer.yaml`),
      JSON.stringify(narrowRecord, null, 2),
    );
    writeFileSync(
      join(repo, 'generated', 'consumers', `${NARROW_CONSUMER}.authorization.json`),
      JSON.stringify({
        consumerId: NARROW_CONSUMER,
        effectiveStatus: 'active',
        authorizations: narrowRecord.authorizations,
        attestation: { humanInTheLoop: true },
        bindingGrants: [],
      }),
    );

    launched = await launchGateway({
      repoRoot: repo,
      mode: 'headless',
      secretStore: new EncryptedFileStore({ repoRoot: repo, env: SECRETS_ENV }),
      flagPollMs: 50,
    });
    base = `http://127.0.0.1:${launched.gatewayPort}`;

    const users = localUserStore({ store: launched.store });
    await users.createUser({
      ...CLERK,
      displayName: 'Clerk',
      password: PASSWORD,
      groups: [TEST_GROUP],
    });
    await users.createUser({
      ...OUTSIDER,
      displayName: 'Outsider',
      password: PASSWORD,
      groups: [],
    });

    const row = (toolId: string, callerSubject: string) =>
      launched.store.audit.append({
        callerSubject,
        consumerId: TEST_CONSUMER,
        humanInTheLoop: true,
        toolId,
        isWrite: false,
        deploymentId: 'local',
        phase: 'execute',
        outcome: 'ok',
      });
    ids['inScopeOther'] = (await row(IN_SCOPE_TOOL, 'local:someone-else')).id;
    ids['outOfScopeOther'] = (await row(OUT_OF_SCOPE_TOOL, 'local:someone-else')).id;
    ids['outsiderOwn'] = (await row(OUT_OF_SCOPE_TOOL, OUTSIDER.subject)).id;
    ids['inScopeClerk'] = (await row(IN_SCOPE_TOOL, CLERK.subject)).id;

    const approval = (toolId: string, callerSubject: string, planHash: string) =>
      launched.store.approvals.create({
        planHash,
        argsCanonicalHash: `args-${planHash}`,
        planSummary: `This is plan ${planHash}.`,
        callerSubject,
        toolId,
        expiresAt: '2099-01-01T00:00:00.000Z',
      });
    ids['approvalIn'] = (await approval('jde.ap.voucher.create', 'local:someone-else', 'p-in')).id;
    ids['approvalOut'] = (await approval(OUT_OF_SCOPE_TOOL, 'local:someone-else', 'p-out')).id;
  }, 180_000);

  afterAll(async () => {
    await launched?.close();
    if (repo) removeLaunchRepo(repo);
  });

  async function bearer(username: string): Promise<string> {
    const res = await fetch(`${base}/auth/local/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { accessToken: string }).accessToken;
  }

  async function assertion(consumerId = TEST_CONSUMER, kp = keypair): Promise<string> {
    return signTestAssertion({ consumerId, audience: AUDIENCE, keypair: kp });
  }

  async function get(
    path: string,
    opts: { consumer?: string | null; token?: string | null; method?: string } = {},
  ): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = {};
    if (opts.consumer !== null)
      headers[MCPFORGE_CONSUMER_ASSERTION_HEADER] = opts.consumer ?? (await assertion());
    if (opts.token != null) headers['authorization'] = `Bearer ${opts.token}`;
    const res = await fetch(`${base}${path}`, { method: opts.method ?? 'GET', headers });
    return { status: res.status, body: await res.json() };
  }

  function refusal(body: unknown) {
    const parsed = apiErrorSchema.parse(body);
    expect(parsed.error.next.trim().length).toBeGreaterThan(0);
    return parsed.error;
  }

  // --- the front door ----------------------------------------------------------

  it('refuses a request with no consumer and no human', async () => {
    const r = await get('/api/v1/calls', { consumer: null });
    expect(r.status).toBe(401);
    expect(refusal(r.body).code).toBe('CONSUMER_UNREGISTERED');
  });

  it('refuses a human without a registered consumer: there is no human-only path', async () => {
    const r = await get('/api/v1/calls', { consumer: null, token: await bearer(CLERK.username) });
    expect(r.status).toBe(401);
    expect(refusal(r.body).code).toBe('CONSUMER_UNREGISTERED');
  });

  it('refuses a registered consumer with no human: there is no consumer-only path', async () => {
    const r = await get('/api/v1/calls', { token: null });
    expect(r.status).toBe(401);
    expect(refusal(r.body).code).toBe('AUTH_REQUIRED');
  });

  it('refuses a replayed consumer assertion', async () => {
    const token = await bearer(CLERK.username);
    const once = await assertion();
    expect((await get('/api/v1/calls', { consumer: once, token })).status).toBe(200);
    const replay = await get('/api/v1/calls', { consumer: once, token });
    expect(replay.status).toBe(401);
    refusal(replay.body);
  });

  it('refuses every write method, and says where writes go', async () => {
    const token = await bearer(CLERK.username);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await get('/api/v1/approvals', { token, method });
      expect(r.status).toBe(405);
      expect(refusal(r.body).next).toMatch(/\/mcp/);
    }
  });

  it('does not reveal which paths exist to an unauthenticated caller', async () => {
    const unknown = await get('/api/v1/tools', { consumer: null });
    const known = await get('/api/v1/calls', { consumer: null });
    expect(unknown.status).toBe(known.status);
    // Once authenticated, an unknown path is a 404 that names the real surface.
    const authed = await get('/api/v1/tools', { token: await bearer(CLERK.username) });
    expect(authed.status).toBe(404);
    expect(refusal(authed.body).next).toMatch(/\/calls/);
  });

  // --- the read authority -----------------------------------------------------------

  it('shows the clerk in-scope rows and their own, never an out-of-scope row', async () => {
    const r = await get('/api/v1/calls', { token: await bearer(CLERK.username) });
    expect(r.status).toBe(200);
    const page = callsPageSchema.parse(r.body);
    const seen = page.items.map((c) => c.id);
    expect(seen).toContain(ids['inScopeOther']);
    expect(seen).toContain(ids['inScopeClerk']);
    expect(seen).not.toContain(ids['outOfScopeOther']);
    expect(seen).not.toContain(ids['outsiderOwn']);
  });

  it('shows a human with no roles only their own rows', async () => {
    const r = await get('/api/v1/calls', { token: await bearer(OUTSIDER.username) });
    const seen = callsPageSchema.parse(r.body).items.map((c) => c.id);
    expect(seen).toEqual([ids['outsiderOwn']]);
  });

  it('narrows by consumer: the same clerk through a consumer authorized for nothing sees only their own rows', async () => {
    const r = await get('/api/v1/calls', {
      consumer: await assertion(NARROW_CONSUMER, narrowKeypair),
      token: await bearer(CLERK.username),
    });
    expect(r.status).toBe(200);
    expect(callsPageSchema.parse(r.body).items.map((c) => c.id)).toEqual([ids['inScopeClerk']]);
  });

  it('an out-of-scope call by id is a 404, identical to one that does not exist', async () => {
    const token = await bearer(CLERK.username);
    const hidden = await get(`/api/v1/calls/${ids['outOfScopeOther']}`, { token });
    const missing = await get('/api/v1/calls/00000000-0000-7000-8000-000000000000', {
      token: await bearer(CLERK.username),
    });
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(refusal(hidden.body).code).toBe(refusal(missing.body).code);
    const visible = await get(`/api/v1/calls/${ids['inScopeOther']}`, {
      token: await bearer(CLERK.username),
    });
    expect(callDetailResponseSchema.parse(visible.body).call.id).toBe(ids['inScopeOther']);
  });

  it('names the original execution on a replay (W0-P3d replayOf), and nothing on a fresh call', async () => {
    const begun = await launched.store.idempotency.begin({
      callerSubject: CLERK.subject,
      toolId: IN_SCOPE_TOOL,
      toolVersion: '1.0.0',
      argsCanonicalHash: 'p3d-args',
      confirmToken: 'p3d-confirm-token',
    });
    const row = (replayed: boolean) =>
      launched.store.audit.append({
        callerSubject: CLERK.subject,
        consumerId: TEST_CONSUMER,
        humanInTheLoop: true,
        toolId: IN_SCOPE_TOOL,
        isWrite: true,
        deploymentId: 'local',
        phase: 'execute',
        outcome: 'ok',
        idempotencyKey: begun.idempotencyKey,
        replayed,
      });
    const original = await row(false);
    await launched.store.idempotency.complete({
      idempotencyKey: begun.idempotencyKey,
      result: { ok: true },
      callId: original.id,
    });
    const replay = await row(true);

    const token = await bearer(CLERK.username);
    const replayDetail = callDetailResponseSchema.parse(
      (await get(`/api/v1/calls/${replay.id}`, { token })).body,
    );
    expect(replayDetail.call.replayOf).toEqual({ callId: original.id, ts: original.ts });
    const originalDetail = callDetailResponseSchema.parse(
      (await get(`/api/v1/calls/${original.id}`, { token: await bearer(CLERK.username) })).body,
    );
    expect(originalDetail.call.replayOf).toBeNull();
  });

  it('pages without leaking: every page is authority-filtered and the cursor moves strictly older', async () => {
    const token = await bearer(CLERK.username);
    const first = callsPageSchema.parse((await get('/api/v1/calls?limit=1', { token })).body);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = callsPageSchema.parse(
      (
        await get(`/api/v1/calls?limit=1&cursor=${first.nextCursor}`, {
          token: await bearer(CLERK.username),
        })
      ).body,
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.id < first.items[0]!.id).toBe(true);
    const all = [...first.items, ...second.items].map((c) => c.id);
    expect(all).not.toContain(ids['outOfScopeOther']);
  });

  it('filters the approval queue and refuses an out-of-scope approval by id', async () => {
    const token = await bearer(CLERK.username);
    const queue = approvalsResponseSchema.parse((await get('/api/v1/approvals', { token })).body);
    const seen = queue.items.map((a) => a.id);
    expect(seen).toContain(ids['approvalIn']);
    expect(seen).not.toContain(ids['approvalOut']);
    expect(
      (
        await get(`/api/v1/approvals/${ids['approvalOut']}`, {
          token: await bearer(CLERK.username),
        })
      ).status,
    ).toBe(404);
    const decided = await get('/api/v1/approvals?status=decided', {
      token: await bearer(CLERK.username),
    });
    expect(approvalsResponseSchema.parse(decided.body).status).toBe('decided');
  });

  it('enablement lists only tools in the read authority', async () => {
    const outsider = enablementResponseSchema.parse(
      (await get('/api/v1/enablement', { token: await bearer(OUTSIDER.username) })).body,
    );
    expect(outsider.tools).toEqual([]);
    const clerk = enablementResponseSchema.parse(
      (await get('/api/v1/enablement', { token: await bearer(CLERK.username) })).body,
    );
    expect(clerk.tools.map((t) => t.toolId)).toContain(IN_SCOPE_TOOL);
    // No probe has run in this world: statuses are null, never invented.
    expect(clerk.probe).toBeNull();
    expect(clerk.tools.every((t) => t.status === null)).toBe(true);
  });

  it('serves the aggregates to any signed-in viewer, parsed by the shared contract', async () => {
    const token = await bearer(OUTSIDER.username);
    const verify = auditVerifyResponseSchema.parse(
      (await get('/api/v1/audit/verify', { token })).body,
    );
    expect(verify.chains.find((c) => c.deploymentId === 'local')?.status).toBe('intact');
    const usage = consumerUsageResponseSchema.parse(
      (await get('/api/v1/consumers/usage', { token: await bearer(OUTSIDER.username) })).body,
    );
    expect(usage.consumers.find((c) => c.consumerId === TEST_CONSUMER)?.buckets).toHaveLength(24);
    const deployment = deploymentResponseSchema.parse(
      (await get('/api/v1/deployment', { token: await bearer(OUTSIDER.username) })).body,
    );
    expect(deployment.toolCount).toBe(11);
    expect(deployment.catalogueDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(deployment)).not.toMatch(/runtime\.db|\.mcpforge/);
  });
});
