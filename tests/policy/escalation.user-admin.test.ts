// W0-P28 — `/api/v1/admin/users` must fail closed.
//
// Local user administration from the portal (owner decisions, 30 Sep 2026).
// Every case below is an attempt to administer accounts without the right to,
// against the REAL launched gateway, plus the paths that must succeed. The
// owner's rules are what is tested:
//
//   1. Who may administer: a human in a group listed under `identityAdmins:`
//      in the deployment's git mapping, through a consumer that may write
//      (a change) or any registered consumer (the list). Never a persona.
//   2. Evidence: every change and every refused change attempt is a
//      hash-chained `identity` audit row, and no row carries a password.
//
// Plus the guard decided with it: the last active identity admin cannot be
// disabled or moved out of every admin group.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminUserChangeResponseSchema,
  adminUsersResponseSchema,
  apiErrorSchema,
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
const SECRETS_ENV = { MCPFORGE_SECRETS_KEY: 'w0-p28-test-only-sealing-passphrase' };
const READONLY_CONSUMER = 'readonly-agent';
const ADMIN_GROUP = 'test-identity-admins';
const ADMIN = { username: 'p28-admin', subject: 'local:p28-admin' };
const CLERK = { username: 'p28-clerk', subject: 'local:p28-clerk' };
const PASSWORD = 'a-long-enough-test-password-1';
const NEW_PASSWORD = 'an-entirely-new-passphrase-28';

describe('W0-P28 — local user administration fails closed', () => {
  let repo: string;
  let launched: LaunchedGateway;
  let keypair: TestKeypair;
  let readonlyKeypair: TestKeypair;
  let base: string;

  beforeAll(async () => {
    keypair = await generateTestConsumerKeypair();
    readonlyKeypair = await generateTestConsumerKeypair('readonly-a');
    repo = launchRepo({
      keypair,
      aisBaseUrl: 'http://127.0.0.1:9/unused',
      aisTokenUrl: 'http://127.0.0.1:9/unused',
      grantRefs: [],
    });

    // Who may administer is git: the mapping names the admin group.
    writeFileSync(
      join(repo, 'overlays', 'local', 'mappings', 'groups-to-roles.yaml'),
      [
        'apiVersion: mcpforge/v1',
        'kind: GroupRoleMapping',
        'deployment: local',
        'groups:',
        `  ${TEST_GROUP}:`,
        '    roles: [p2p]',
        `  ${ADMIN_GROUP}:`,
        '    roles: [p2p]',
        'personas:',
        // A persona is a lens: the clerk's group holding `admin` must grant nothing.
        `  ${TEST_GROUP}:`,
        '    personas: [admin]',
        'identityAdmins:',
        `  - ${ADMIN_GROUP}`,
        '',
      ].join('\n'),
    );

    const ro = testConsumerRecord({
      id: READONLY_CONSUMER,
      publicKeys: [
        {
          kid: readonlyKeypair.kid,
          kty: 'OKP',
          crv: 'Ed25519',
          x: readonlyKeypair.publicJwk.x,
          addedAt: '2026-08-27',
        },
      ],
    });
    const roRecord = { ...ro, authorizations: { ...ro.authorizations, writeAllowed: false } };
    writeFileSync(
      join(repo, 'consumers', `${READONLY_CONSUMER}.consumer.yaml`),
      JSON.stringify(roRecord, null, 2),
    );
    writeFileSync(
      join(repo, 'generated', 'consumers', `${READONLY_CONSUMER}.authorization.json`),
      JSON.stringify({
        consumerId: READONLY_CONSUMER,
        effectiveStatus: 'active',
        authorizations: roRecord.authorizations,
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
      ...ADMIN,
      displayName: 'Admin',
      password: PASSWORD,
      groups: [ADMIN_GROUP],
    });
    await users.createUser({
      ...CLERK,
      displayName: 'Clerk',
      password: PASSWORD,
      groups: [TEST_GROUP],
    });
  }, 180_000);

  afterAll(async () => {
    await launched?.close();
    if (repo) removeLaunchRepo(repo);
  });

  async function bearer(username: string, password = PASSWORD): Promise<string> {
    const res = await fetch(`${base}/auth/local/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { accessToken: string }).accessToken;
  }

  async function call(
    path: string,
    opts: {
      method?: string;
      body?: unknown;
      as?: string | null;
      consumer?: 'test' | 'readonly' | null;
    } = {},
  ): Promise<{ status: number; body: unknown; text: string }> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const consumer = opts.consumer === undefined ? 'test' : opts.consumer;
    if (consumer === 'test') {
      headers[MCPFORGE_CONSUMER_ASSERTION_HEADER] = await signTestAssertion({
        consumerId: TEST_CONSUMER,
        audience: AUDIENCE,
        keypair,
      });
    } else if (consumer === 'readonly') {
      headers[MCPFORGE_CONSUMER_ASSERTION_HEADER] = await signTestAssertion({
        consumerId: READONLY_CONSUMER,
        audience: AUDIENCE,
        keypair: readonlyKeypair,
      });
    }
    const as = opts.as === undefined ? ADMIN.username : opts.as;
    if (as !== null) headers['authorization'] = `Bearer ${await bearer(as)}`;
    const res = await fetch(`${base}/api/v1/admin/users${path}`, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers,
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text) as unknown, text };
  }

  function refusal(body: unknown) {
    const parsed = apiErrorSchema.parse(body);
    expect(parsed.error.next.trim().length).toBeGreaterThan(0);
    expect(parsed.error.next.toLowerCase()).not.toContain('try again');
    return parsed.error;
  }

  async function identityRows() {
    const rows = await launched.store.audit.listRecent({
      visibleToolIds: [],
      ownSubject: ADMIN.subject,
      limit: 500,
    });
    const clerkRows = await launched.store.audit.listRecent({
      visibleToolIds: [],
      ownSubject: CLERK.subject,
      limit: 500,
    });
    return [...rows, ...clerkRows].filter((r) => r.phase === 'identity');
  }

  // --- the front door ------------------------------------------------------------

  it('refuses with no consumer and with no human, before anything is read', async () => {
    const noConsumer = await call('', { consumer: null });
    expect(noConsumer.status).toBe(401);
    expect(refusal(noConsumer.body).code).toBe('CONSUMER_UNREGISTERED');
    const noHuman = await call('', { as: null });
    expect(noHuman.status).toBe(401);
    expect(refusal(noHuman.body).code).toBe('AUTH_REQUIRED');
  });

  // --- who may administer -------------------------------------------------------------

  it('refuses a non-admin, even one whose group holds the admin PERSONA, and records the attempt', async () => {
    const list = await call('', { as: CLERK.username });
    expect(list.status).toBe(403);
    expect(refusal(list.body).code).toBe('TOOL_NOT_IN_SCOPE');

    const before = (await identityRows()).length;
    const create = await call('', {
      as: CLERK.username,
      body: {
        username: 'p28-sneaky',
        displayName: 'Sneaky',
        password: PASSWORD,
        groups: [ADMIN_GROUP],
      },
    });
    expect(create.status).toBe(403);
    expect(refusal(create.body).code).toBe('TOOL_NOT_IN_SCOPE');
    expect(await localUserStore({ store: launched.store }).getUserByUsername('p28-sneaky')).toBe(
      undefined,
    );

    const promote = await call(`/${encodeURIComponent(CLERK.subject)}`, {
      as: CLERK.username,
      body: { action: 'set_groups', groups: [TEST_GROUP, ADMIN_GROUP] },
    });
    expect(promote.status).toBe(403);
    const clerk = await localUserStore({ store: launched.store }).getUser(CLERK.subject);
    expect(clerk?.groups).toEqual([TEST_GROUP]);

    const rows = await identityRows();
    expect(rows.length).toBe(before + 2);
    const denied = rows.filter((r) => r.deniedByRule === 'identity.not_identity_admin');
    expect(denied.length).toBeGreaterThanOrEqual(2);
    expect(
      denied.every((r) => r.outcome === 'policy_denied' && r.callerSubject === CLERK.subject),
    ).toBe(true);
  });

  it('refuses a change through a consumer that may not write, but lets it list', async () => {
    const list = await call('', { consumer: 'readonly' });
    expect(list.status).toBe(200);

    const r = await call(`/${encodeURIComponent(CLERK.subject)}`, {
      consumer: 'readonly',
      body: { action: 'disable' },
    });
    expect(r.status).toBe(403);
    expect(refusal(r.body).code).toBe('CONSUMER_NOT_AUTHORIZED');
    expect((await localUserStore({ store: launched.store }).getUser(CLERK.subject))?.active).toBe(
      true,
    );
    const rows = await identityRows();
    expect(rows.some((row) => row.deniedByRule === 'identity.consumer_write_not_allowed')).toBe(
      true,
    );
  });

  // --- what an admin may do -------------------------------------------------------------

  it('lists accounts with no credential field and flags the admins', async () => {
    const r = await call('');
    expect(r.status).toBe(200);
    const body = adminUsersResponseSchema.parse(r.body);
    expect(body.identityAdminGroups).toEqual([ADMIN_GROUP]);
    expect(body.users.find((u) => u.subject === ADMIN.subject)?.identityAdmin).toBe(true);
    expect(body.users.find((u) => u.subject === CLERK.subject)?.identityAdmin).toBe(false);
    expect(r.text).not.toMatch(/argon2|passwordHash|totpSecret/i);
  });

  it('creates, regroups, disables, enables and resets a password, each one an identity row with no password', async () => {
    const created = await call('', {
      body: {
        username: 'p28-new',
        displayName: 'New Person',
        password: PASSWORD,
        groups: [TEST_GROUP, 'unmapped-group'],
      },
    });
    expect(created.status).toBe(200);
    const c = adminUserChangeResponseSchema.parse(created.body);
    expect(c.user.groups).toEqual([TEST_GROUP, 'unmapped-group'].sort());
    expect(c.next).toContain('unmapped-group');
    const subject = c.user.subject;
    const path = `/${encodeURIComponent(subject)}`;

    // The new account signs in with the password it was given.
    await bearer('p28-new');

    const regroup = await call(path, { body: { action: 'set_groups', groups: [TEST_GROUP] } });
    expect(adminUserChangeResponseSchema.parse(regroup.body).user.groups).toEqual([TEST_GROUP]);

    const disabled = await call(path, { body: { action: 'disable' } });
    expect(adminUserChangeResponseSchema.parse(disabled.body).user.active).toBe(false);
    const signIn = await fetch(`${base}/auth/local/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'p28-new', password: PASSWORD }),
    });
    expect(signIn.status).not.toBe(200);

    const enabled = await call(path, { body: { action: 'enable' } });
    expect(adminUserChangeResponseSchema.parse(enabled.body).user.active).toBe(true);

    const reset = await call(path, { body: { action: 'reset_password', password: NEW_PASSWORD } });
    expect(reset.status).toBe(200);
    expect(reset.text).not.toContain(NEW_PASSWORD);
    await bearer('p28-new', NEW_PASSWORD);

    const rows = (await launched.store.audit.listByResultKey('subject', subject)).filter(
      (r) => r.phase === 'identity',
    );
    expect(rows.map((r) => r.toolId).sort()).toEqual(
      [
        'forge.identity.create',
        'forge.identity.disable',
        'forge.identity.enable',
        'forge.identity.reset_password',
        'forge.identity.set_groups',
      ].sort(),
    );
    expect(rows.every((r) => r.outcome === 'ok' && r.callerSubject === ADMIN.subject)).toBe(true);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(NEW_PASSWORD);
    expect(serialized).not.toMatch(/argon2/i);
  }, 60_000);

  it('refuses a too-short password without echoing it, and records nothing it could not attempt', async () => {
    const short = 'short-pw';
    const r = await call('', {
      body: { username: 'p28-short', displayName: 'Short', password: short },
    });
    expect(r.status).toBe(400);
    expect(refusal(r.body).code).toBe('INPUT_INVALID');
    expect(r.text).not.toContain(short);
  });

  it('refuses a duplicate username and records the refused attempt', async () => {
    const r = await call('', {
      body: { username: CLERK.username, displayName: 'Dup', password: PASSWORD },
    });
    expect(r.status).toBe(400);
    expect(refusal(r.body).code).toBe('INPUT_INVALID');
    const rows = await identityRows();
    expect(
      rows.some(
        (row) =>
          row.deniedByRule === 'identity.invalid_state' && row.toolId === 'forge.identity.create',
      ),
    ).toBe(true);
  });

  // --- the last admin -------------------------------------------------------------------

  it('refuses to disable or un-admin the last active identity admin', async () => {
    const path = `/${encodeURIComponent(ADMIN.subject)}`;
    const disable = await call(path, { body: { action: 'disable' } });
    expect(disable.status).toBe(403);
    expect(refusal(disable.body).code).toBe('POLICY_GUARDRAIL_BREACH');

    const demote = await call(path, { body: { action: 'set_groups', groups: [TEST_GROUP] } });
    expect(demote.status).toBe(403);
    const admin = await localUserStore({ store: launched.store }).getUser(ADMIN.subject);
    expect(admin?.active).toBe(true);
    expect(admin?.groups).toEqual([ADMIN_GROUP]);
    const rows = await identityRows();
    expect(rows.filter((r) => r.deniedByRule === 'identity.last_admin').length).toBe(2);
  });

  it('refuses an unknown subject with NOT_FOUND', async () => {
    const r = await call('/local%3Anobody', { body: { action: 'disable' } });
    expect(r.status).toBe(404);
    expect(refusal(r.body).code).toBe('NOT_FOUND');
  });

  it('refuses any other method with a next', async () => {
    const r = await call('', { method: 'DELETE' });
    expect(r.status).toBe(405);
    refusal(r.body);
  });

  it('leaves the audit chain intact', async () => {
    const deployments = await launched.store.audit.listDeployments();
    for (const d of deployments) {
      expect((await launched.store.audit.verifyChain(d)).status).toBe('intact');
    }
  });
});
