// W0-P25 — `POST /api/v1/approvals/{id}/decision` must fail closed.
//
// The one write under `/api/v1` (owner decision, 30 Sep 2026, option (a)).
// Every case below is an attempt to record a decision the caller is not
// entitled to, against the REAL launched gateway, plus the one path that
// must succeed. The owner's two rules for this endpoint are what is tested:
//
//   1. Who may decide: anyone other than the requester whose own authority
//      (Deployed ∩ Granted ∩ ConsumerAuthorized) includes the tool, through a
//      consumer whose registration allows writes.
//   2. Evidence: every decision and every refused attempt is a hash-chained
//      `approve` audit row, and the chain stays intact.
//
// Plus the properties the approval gate already owns, proven through this
// transport: self-approval is refused, a decided request cannot be decided
// again, an expired one cannot be decided at all, and the confirm token is
// never handed to the approver.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  approvalDecisionResponseSchema,
  approvalDetailResponseSchema,
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
import { DECISION_PSEUDO_TOOL_ID } from '../../core/gateway/api/v1/approval-decision.js';

const AUDIENCE = 'https://mcpforge.local/mcp';
const SECRETS_ENV = { MCPFORGE_SECRETS_KEY: 'w0-p25-test-only-sealing-passphrase' };
const READONLY_CONSUMER = 'readonly-agent';
const REQUESTER = { username: 'p25-requester', subject: 'local:p25-requester' };
const APPROVER = { username: 'p25-approver', subject: 'local:p25-approver' };
const OUTSIDER = { username: 'p25-outsider', subject: 'local:p25-outsider' };
const PASSWORD = 'a-long-enough-test-password-1';
const WRITE_TOOL = 'jde.ap.voucher.create';
const OUT_OF_SCOPE_TOOL = 'jde.hr.employee.get';

describe('W0-P25 — the approval decision path fails closed', () => {
  let repo: string;
  let launched: LaunchedGateway;
  let keypair: TestKeypair;
  let readonlyKeypair: TestKeypair;
  let base: string;
  let plan = 0;

  beforeAll(async () => {
    keypair = await generateTestConsumerKeypair();
    readonlyKeypair = await generateTestConsumerKeypair('readonly-a');
    repo = launchRepo({
      keypair,
      aisBaseUrl: 'http://127.0.0.1:9/unused',
      aisTokenUrl: 'http://127.0.0.1:9/unused',
      grantRefs: [],
    });

    // The SAME humans through a consumer that is registered, active and
    // authorized for the same binding types and roles, but may not write.
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
    for (const u of [REQUESTER, APPROVER]) {
      await users.createUser({
        ...u,
        displayName: u.username,
        password: PASSWORD,
        groups: [TEST_GROUP],
      });
    }
    await users.createUser({
      ...OUTSIDER,
      displayName: 'Outsider',
      password: PASSWORD,
      groups: [],
    });
  }, 180_000);

  afterAll(async () => {
    await launched?.close();
    if (repo) removeLaunchRepo(repo);
  });

  /** A fresh pending request raised by `callerSubject`. */
  async function pending(
    opts: { toolId?: string; callerSubject?: string; expiresAt?: string } = {},
  ): Promise<string> {
    plan += 1;
    const created = await launched.store.approvals.create({
      planHash: `p25-plan-${plan}`,
      argsCanonicalHash: `p25-args-${plan}`,
      planSummary: `Create an AP voucher, plan ${plan}. This creates an OPEN PAYABLE in JD Edwards.`,
      callerSubject: opts.callerSubject ?? REQUESTER.subject,
      consumerId: TEST_CONSUMER,
      toolId: opts.toolId ?? WRITE_TOOL,
      toolVersion: '1.0.0',
      expiresAt: opts.expiresAt ?? '2099-01-01T00:00:00.000Z',
    });
    return created.id;
  }

  async function bearer(username: string): Promise<string> {
    const res = await fetch(`${base}/auth/local/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { accessToken: string }).accessToken;
  }

  async function decide(
    approvalId: string,
    body: unknown,
    opts: { as?: string | null; consumer?: 'test' | 'readonly' | null; method?: string } = {},
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
    const as = opts.as === undefined ? APPROVER.username : opts.as;
    if (as !== null) headers['authorization'] = `Bearer ${await bearer(as)}`;
    const res = await fetch(`${base}/api/v1/approvals/${encodeURIComponent(approvalId)}/decision`, {
      method: opts.method ?? 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
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

  async function statusOf(approvalId: string): Promise<string | undefined> {
    return (await launched.store.approvals.get(approvalId))?.status;
  }

  async function approveRows(approvalId: string) {
    const rows = await launched.store.audit.listByResultKey('approvalId', approvalId);
    return rows.filter((r) => r.phase === 'approve').sort((a, b) => a.id.localeCompare(b.id));
  }

  // --- the front door ------------------------------------------------------------

  it('refuses a decision with no consumer, and with no human', async () => {
    const id = await pending();
    const noConsumer = await decide(id, { decision: 'approved' }, { consumer: null });
    expect(noConsumer.status).toBe(401);
    expect(refusal(noConsumer.body).code).toBe('CONSUMER_UNREGISTERED');
    const noHuman = await decide(id, { decision: 'approved' }, { as: null });
    expect(noHuman.status).toBe(401);
    expect(refusal(noHuman.body).code).toBe('AUTH_REQUIRED');
    expect(await statusOf(id)).toBe('pending');
  });

  // --- who may decide ---------------------------------------------------------------

  it('refuses self-approval, records the attempt, and leaves the request pending', async () => {
    const id = await pending();
    const r = await decide(id, { decision: 'approved' }, { as: REQUESTER.username });
    expect(r.status).toBe(403);
    expect(refusal(r.body).code).toBe('POLICY_GUARDRAIL_BREACH');
    expect(await statusOf(id)).toBe('pending');
    const rows = await approveRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      callerSubject: REQUESTER.subject,
      toolId: WRITE_TOOL,
      outcome: 'policy_denied',
      deniedByRule: 'approval.self_approval',
      confirmTokenHash: null,
    });
  });

  it('refuses a human whose own roles do not include the tool: a 404, identical to a missing request', async () => {
    const id = await pending();
    const r = await decide(id, { decision: 'approved' }, { as: OUTSIDER.username });
    const missing = await decide(
      'apr_does-not-exist',
      { decision: 'approved' },
      { as: OUTSIDER.username },
    );
    expect(r.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(refusal(r.body).code).toBe(refusal(missing.body).code);
    expect(r.text).not.toContain(WRITE_TOOL);
    expect(await statusOf(id)).toBe('pending');
    // Recorded, under a pseudo tool id: the row is the outsider's own, and
    // they may read it back, so it must not name the tool they cannot see.
    const rows = await approveRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      callerSubject: OUTSIDER.subject,
      toolId: DECISION_PSEUDO_TOOL_ID,
      outcome: 'policy_denied',
      deniedByRule: 'approval.not_approver',
      planHash: null,
    });
  });

  it('refuses an approver whose own roles do not include THIS tool', async () => {
    const id = await pending({ toolId: OUT_OF_SCOPE_TOOL, callerSubject: 'local:someone-else' });
    const r = await decide(id, { decision: 'approved' });
    expect(r.status).toBe(404);
    refusal(r.body);
    expect(await statusOf(id)).toBe('pending');
  });

  it('refuses a consumer whose registration does not allow writes, even for an entitled approver', async () => {
    const id = await pending();
    const r = await decide(id, { decision: 'approved' }, { consumer: 'readonly' });
    expect(r.status).toBe(403);
    expect(refusal(r.body).code).toBe('CONSUMER_NOT_AUTHORIZED');
    expect(await statusOf(id)).toBe('pending');
    const rows = await approveRows(id);
    expect(rows[0]).toMatchObject({
      consumerId: READONLY_CONSUMER,
      toolId: DECISION_PSEUDO_TOOL_ID,
      deniedByRule: 'approval.consumer_write_not_allowed',
    });
  });

  it('never lets the body name the approver, and a decline needs a reason', async () => {
    const id = await pending();
    const smuggled = await decide(id, { decision: 'approved', approverSubject: APPROVER.subject });
    expect(smuggled.status).toBe(400);
    expect(refusal(smuggled.body).code).toBe('INPUT_INVALID');
    const noReason = await decide(id, { decision: 'rejected' });
    expect(noReason.status).toBe(400);
    const notJson = await decide(id, '{nope');
    expect(notJson.status).toBe(400);
    expect(await statusOf(id)).toBe('pending');
  });

  it('serves the decision path on POST only', async () => {
    const id = await pending();
    const put = await decide(id, { decision: 'approved' }, { method: 'PUT' });
    expect(put.status).toBe(405);
    refusal(put.body);
    expect(await statusOf(id)).toBe('pending');
  });

  // --- the path that must work ----------------------------------------------------

  it('lets an entitled second person approve, returns no token, and records it', async () => {
    const id = await pending();
    const r = await decide(id, { decision: 'approved' });
    expect(r.status).toBe(200);
    const decided = approvalDecisionResponseSchema.parse(r.body);
    expect(decided.approval.status).toBe('approved');
    expect(decided.approval.approverSubject).toBe(APPROVER.subject);
    expect(decided.next).toContain('forge.approval.status');
    // The token belongs to the requester. It is not in the response, in any field.
    expect(r.text).not.toMatch(/confirmToken|cnf_/);

    const rows = await approveRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(decided.auditCallId);
    expect(rows[0]).toMatchObject({
      callerSubject: APPROVER.subject,
      toolId: WRITE_TOOL,
      phase: 'approve',
      outcome: 'ok',
      isWrite: false,
      planHash: decided.approval.planHash,
    });
    expect(rows[0]!.confirmTokenHash).toMatch(/^[0-9a-f]{64}$/);

    // The read API agrees with what was written.
    const token = await bearer(APPROVER.username);
    const res = await fetch(`${base}/api/v1/approvals/${id}`, {
      headers: {
        authorization: `Bearer ${token}`,
        [MCPFORGE_CONSUMER_ASSERTION_HEADER]: await signTestAssertion({
          consumerId: TEST_CONSUMER,
          audience: AUDIENCE,
          keypair,
        }),
      },
    });
    expect(approvalDetailResponseSchema.parse(await res.json()).approval.status).toBe('approved');

    // And a decided request cannot be decided again, by anyone.
    const again = await decide(id, { decision: 'rejected', reason: 'Changed my mind.' });
    expect(again.status).toBe(409);
    expect(refusal(again.body).code).toBe('APPROVAL_REQUIRED');
    expect(await statusOf(id)).toBe('approved');
    expect((await approveRows(id)).map((row) => row.deniedByRule)).toEqual([
      null,
      'approval.not_pending',
    ]);
  });

  it('records a decline with its reason', async () => {
    const id = await pending();
    const r = await decide(id, { decision: 'rejected', reason: 'Supplier is on hold.' });
    expect(r.status).toBe(200);
    const decided = approvalDecisionResponseSchema.parse(r.body);
    expect(decided.approval).toMatchObject({
      status: 'rejected',
      decisionReason: 'Supplier is on hold.',
      approverSubject: APPROVER.subject,
    });
    const rows = await approveRows(id);
    expect(rows[0]).toMatchObject({ outcome: 'ok', confirmTokenHash: null });
  });

  it('refuses to decide an expired request, and says so rather than calling it missing', async () => {
    const id = await pending({ expiresAt: '2020-01-01T00:00:00.000Z' });
    const r = await decide(id, { decision: 'approved' });
    expect(r.status).toBe(409);
    expect(refusal(r.body).code).toBe('PLAN_EXPIRED');
    expect((await launched.store.approvals.get(id))?.approverSubject).toBeNull();
    expect((await approveRows(id))[0]).toMatchObject({ deniedByRule: 'approval.expired' });
  });

  it('keeps the audit chain intact through every decision and refusal above', async () => {
    const verified = await launched.store.audit.verifyChain('local');
    expect(verified.status).toBe('intact');
    // 9 refused-or-decided attempts above; malformed bodies are not attempts.
    expect(verified.rowsChecked).toBeGreaterThanOrEqual(9);
  });
});
