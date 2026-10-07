// W0-Q9b — model-assisted authoring behind the gateway (D7 of
// docs/build-plan/w0-q8-assisted-authoring.md), against the REAL launched
// gateway. Every attempt below that is not an authorized person's must FAIL
// CLOSED:
//
//   * no consumer, or a consumer with no human bearer, never reaches the
//     authoring module: refused at the front door, NO audit row, and the body
//     is never read (the request below is still streaming when it is refused);
//   * a wrong method is 405 with a next, and writes nothing;
//   * an oversize body is 400 with a next, audited;
//   * an agent consumer (no human in its loop) gets no authoring endpoint, not
//     even status, audited, and no model is called;
//   * a request that names an acceptor is refused, and the acceptor recorded
//     for an accepted field is the signed-in subject;
//   * the provider key appears in no response and no audit row.
//
// The model provider is the only fake (LaunchOptions.authoringFetch); the
// gateway, its front door, its vault and its store are real.

import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  AUTHORING_ACCEPT_PATH,
  AUTHORING_STATUS_PATH,
  AUTHORING_SUGGEST_PATH,
  authoringAcceptResponseSchema,
  authoringStatusResponseSchema,
  authoringSuggestResponseSchema,
} from '../../core/shared/src/api/v1/index.js';
import { launchGateway, type LaunchedGateway } from '../../core/gateway/launch.js';
import {
  launchRepo,
  removeLaunchRepo,
  TEST_CONSUMER,
  TEST_GROUP,
} from '../../core/gateway/launch.test-support.js';
import { EncryptedFileStore } from '../../core/gateway/secrets/server.js';
import { parseSecretRef } from '../../core/gateway/secrets/index.js';
import { localUserStore } from '../../core/gateway/identity/index.js';
import {
  generateTestConsumerKeypair,
  signTestAssertion,
  testConsumerRecord,
  type TestKeypair,
} from '../../core/gateway/transport/consumer-auth/testkit.js';
import { MCPFORGE_CONSUMER_ASSERTION_HEADER } from '../../core/gateway/transport/index.js';
import type { AuditCallRecord } from '../../core/gateway/store/audit/types.js';

const AUDIENCE = 'https://mcpforge.local/mcp';
const SECRETS_ENV = { MCPFORGE_SECRETS_KEY: 'w0-q9b-policy-test-only-sealing-passphrase' };
const KEY = 'sk-SENTINEL-Q9B-POLICY-KEY-71c2';
const KEY_REF = 'secretRef://gateway/authoring-model-oc/api-key';
const CLERK = 'local:q9b-clerk';
const BOT_CONSUMER = 'bot-agent';
const PASSWORD = 'a-long-enough-test-password-1';
const SUGGESTED = 'Create an AP voucher for a supplier invoice.';
/** A NEW tool: not in the served catalogue, so its own sensitivity is the one that counts. */
const DRAFT = `apiVersion: mcpforge/v1
kind: Tool
id: jde.ap.voucher.simulate
app: jde
module: ap
entity: voucher
verb: simulate
sensitivity: internal
purpose: Old purpose.
`;
/** A draft of a SERVED financial tool that claims to be internal. */
const LOWERED = DRAFT.replace('voucher.simulate', 'voucher.create').replace(
  'verb: simulate',
  'verb: create',
);

describe('W0-Q9b — authoring endpoints fail closed at the front door and for agents', () => {
  let defs: string;
  let install: string;
  let launched: LaunchedGateway;
  let keypair: TestKeypair;
  let botKeypair: TestKeypair;
  const modelCalls: string[] = [];

  beforeAll(async () => {
    keypair = await generateTestConsumerKeypair();
    botKeypair = await generateTestConsumerKeypair('bot-q9b');
    defs = launchRepo({
      keypair,
      aisBaseUrl: 'http://127.0.0.1:9',
      aisTokenUrl: 'http://127.0.0.1:9/token',
      grantRefs: [],
    });
    writeFileSync(
      join(defs, 'overlays', 'local', 'authoring.yaml'),
      [
        'apiVersion: mcpforge/v1',
        'kind: AuthoringModels',
        'enabled: true',
        'default: oc',
        'providers:',
        '  - id: oc',
        '    kind: openai-compatible',
        '    model: test-model',
        '    baseUrl: http://model.test/v1/chat/completions',
        `    keyRef: ${KEY_REF}`,
        '',
      ].join('\n'),
    );

    // An autonomous agent: allowed to write, but with NO human in its loop.
    const bot = testConsumerRecord({
      id: BOT_CONSUMER,
      writeAllowed: true,
      maxSensitivity: 'financial',
      publicKeys: [
        {
          kid: botKeypair.kid,
          kty: 'OKP',
          crv: 'Ed25519',
          x: botKeypair.publicJwk.x,
          addedAt: '2026-08-27',
        },
      ],
    });
    const botRecord = {
      ...bot,
      authorizations: { ...bot.authorizations, bindingTypes: ['function'] },
      attestation: { humanInTheLoop: false },
    };
    writeFileSync(
      join(defs, 'consumers', `${BOT_CONSUMER}.consumer.yaml`),
      JSON.stringify(botRecord, null, 2),
    );
    writeFileSync(
      join(defs, 'generated', 'consumers', `${BOT_CONSUMER}.authorization.json`),
      JSON.stringify({
        consumerId: BOT_CONSUMER,
        effectiveStatus: 'active',
        authorizations: botRecord.authorizations,
        attestation: { humanInTheLoop: false },
        bindingGrants: [],
      }),
    );

    install = mkdtempSync(join(tmpdir(), 'mcpforge-q9b-install-'));
    const secrets = new EncryptedFileStore({ repoRoot: install, env: SECRETS_ENV });
    await secrets.put(parseSecretRef(KEY_REF), KEY);
    launched = await launchGateway({
      repoRoot: install,
      definitionsRoot: defs,
      mode: 'headless',
      environmentClass: 'local',
      secretStore: secrets,
      authoringFetch: async (_url, init) => {
        modelCalls.push(String(init?.body ?? ''));
        return new Response(JSON.stringify({ choices: [{ message: { content: SUGGESTED } }] }), {
          status: 200,
        });
      },
    });
    await localUserStore({ store: launched.store }).createUser({
      username: 'q9b-clerk',
      displayName: 'Clerk',
      password: PASSWORD,
      groups: [TEST_GROUP],
      subject: CLERK,
    });
  }, 240_000);

  afterAll(async () => {
    await launched?.close();
    if (defs) removeLaunchRepo(defs);
    if (install) rmSync(install, { recursive: true, force: true });
  });

  async function headers(who: {
    human?: boolean;
    consumer?: 'test' | 'bot';
  }): Promise<Record<string, string>> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (who.consumer !== undefined) {
      h[MCPFORGE_CONSUMER_ASSERTION_HEADER] = await signTestAssertion(
        who.consumer === 'test'
          ? { consumerId: TEST_CONSUMER, audience: AUDIENCE, keypair }
          : { consumerId: BOT_CONSUMER, audience: AUDIENCE, keypair: botKeypair },
      );
    }
    if (who.human === true) {
      h['authorization'] =
        `Bearer ${(await launched.identity.issueToken(CLERK, ['pwd'], 'q9b')).token}`;
    }
    return h;
  }

  async function call(
    path: string,
    who: { human?: boolean; consumer?: 'test' | 'bot' },
    options: { method?: string; body?: unknown; raw?: string } = {},
  ): Promise<{ status: number; body: unknown; text: string; allow: string | null }> {
    const method = options.method ?? (path === AUTHORING_STATUS_PATH ? 'GET' : 'POST');
    const res = await fetch(`http://127.0.0.1:${launched.gatewayPort}${path}`, {
      method,
      headers: await headers(who),
      ...(method === 'GET' ? {} : { body: options.raw ?? JSON.stringify(options.body ?? {}) }),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: JSON.parse(text) as unknown,
      text,
      allow: res.headers.get('allow'),
    };
  }

  /**
   * Send the headers and the START of a body, then wait: if the gateway were
   * reading the body it could not answer until the body ended. It answers
   * while the body is still open, so it never read it.
   */
  async function refusedWhileStreaming(
    path: string,
    who: { human?: boolean; consumer?: 'test' | 'bot' },
  ): Promise<{ status: number; body: unknown }> {
    const h = await headers(who);
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port: launched.gatewayPort, path, method: 'POST', headers: h },
        (res) => {
          let text = '';
          res.on('data', (c: Buffer) => (text += c.toString('utf8')));
          res.on('end', () => {
            req.destroy();
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) as unknown });
          });
        },
      );
      req.on('error', (e) => {
        if ((e as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(e);
      });
      req.write('{"yaml": "id: never-finished');
      setTimeout(() => reject(new Error('the gateway waited for the body')), 10_000).unref();
    });
  }

  async function authoringRows(): Promise<AuditCallRecord[]> {
    return (await launched.store.audit.listChain('local')).filter((r) => r.phase === 'authoring');
  }

  it('no consumer: CONSUMER_UNREGISTERED 401 on every path, no row, and the body is never read', async () => {
    const before = (await authoringRows()).length;
    for (const path of [AUTHORING_SUGGEST_PATH, AUTHORING_ACCEPT_PATH]) {
      const r = await refusedWhileStreaming(path, { human: true });
      expect(r.status).toBe(401);
      expect(apiErrorSchema.parse(r.body).error.code).toBe('CONSUMER_UNREGISTERED');
    }
    const status = await call(AUTHORING_STATUS_PATH, { human: true });
    expect(status.status).toBe(401);
    expect((await authoringRows()).length).toBe(before);
    expect(modelCalls).toHaveLength(0);
  });

  it('a consumer but no human bearer is refused at the front door, no row, body never read', async () => {
    const before = (await authoringRows()).length;
    for (const path of [AUTHORING_SUGGEST_PATH, AUTHORING_ACCEPT_PATH]) {
      const r = await refusedWhileStreaming(path, { consumer: 'test' });
      expect(r.status).toBeGreaterThanOrEqual(401);
      expect(r.status).toBeLessThan(404);
      expect(apiErrorSchema.parse(r.body).error.next.length).toBeGreaterThan(0);
    }
    expect((await authoringRows()).length).toBe(before);
    expect(modelCalls).toHaveLength(0);
  });

  it('a wrong method is 405 with a next and writes nothing', async () => {
    const before = (await authoringRows()).length;
    const get = await call(
      AUTHORING_SUGGEST_PATH,
      { human: true, consumer: 'test' },
      { method: 'GET' },
    );
    expect(get.status).toBe(405);
    expect(get.allow).toBe('POST');
    expect(apiErrorSchema.parse(get.body).error.next).toContain('POST');
    const post = await call(
      AUTHORING_STATUS_PATH,
      { human: true, consumer: 'test' },
      { method: 'POST' },
    );
    expect(post.status).toBe(405);
    expect(post.allow).toBe('GET');
    expect((await authoringRows()).length).toBe(before);
  });

  it('an oversize body is 400 with a next, audited', async () => {
    const r = await call(
      AUTHORING_SUGGEST_PATH,
      { human: true, consumer: 'test' },
      { raw: JSON.stringify({ yaml: 'x'.repeat(300 * 1024), field: 'purpose' }) },
    );
    expect(r.status).toBe(400);
    const e = apiErrorSchema.parse(r.body).error;
    expect(e.code).toBe('INPUT_INVALID');
    expect(e.next.length).toBeGreaterThan(0);
    expect((await authoringRows()).at(-1)).toMatchObject({
      callerSubject: CLERK,
      deniedByRule: 'authoring.input_invalid',
    });
    expect(modelCalls).toHaveLength(0);
  });

  it('an agent consumer gets no authoring endpoint, not even status: 403, audited, no model call', async () => {
    for (const path of [AUTHORING_STATUS_PATH, AUTHORING_SUGGEST_PATH]) {
      const r = await call(
        path,
        { human: true, consumer: 'bot' },
        { body: { yaml: DRAFT, field: 'purpose' } },
      );
      expect(r.status).toBe(403);
      expect(apiErrorSchema.parse(r.body).error.code).toBe('CONSUMER_NOT_AUTHORIZED');
      expect((await authoringRows()).at(-1)).toMatchObject({
        consumerId: BOT_CONSUMER,
        outcome: 'policy_denied',
        deniedByRule: 'authoring.consumer_no_human',
      });
    }
    expect(modelCalls).toHaveLength(0);
  });

  it('a person through the portal kind of consumer: status, suggest, a spoofed acceptor refused, then accept as themselves', async () => {
    const who = { human: true, consumer: 'test' } as const;
    const status = authoringStatusResponseSchema.parse(
      (await call(AUTHORING_STATUS_PATH, who)).body,
    );
    expect(status).toMatchObject({ enabled: true, providers: [{ id: 'oc', available: true }] });

    const dry = await call(AUTHORING_SUGGEST_PATH, who, {
      body: { yaml: DRAFT, field: 'purpose', dryRun: true },
    });
    expect(authoringSuggestResponseSchema.parse(dry.body)).toMatchObject({
      dryRun: true,
      sent: false,
    });
    expect(modelCalls).toHaveLength(0);

    // A draft cannot lower a served tool's sensitivity to reach a provider.
    const lowered = await call(AUTHORING_SUGGEST_PATH, who, {
      body: { yaml: LOWERED, field: 'purpose' },
    });
    expect(lowered.status).toBe(403);
    expect(apiErrorSchema.parse(lowered.body).error.code).toBe('AUTHORING_SENSITIVITY_BLOCKED');
    expect(modelCalls).toHaveLength(0);

    const asked = await call(AUTHORING_SUGGEST_PATH, who, {
      body: { yaml: DRAFT, field: 'purpose' },
    });
    expect(asked.status, asked.text).toBe(200);
    const s = authoringSuggestResponseSchema.parse(asked.body);
    if (s.dryRun) throw new Error('expected a suggestion');
    expect(modelCalls).toHaveLength(1);

    const spoof = await call(AUTHORING_ACCEPT_PATH, who, {
      body: {
        yaml: DRAFT,
        field: 'purpose',
        text: s.text,
        suggestionId: s.suggestionId,
        acceptedBy: 'local:mallory',
      },
    });
    expect(spoof.status).toBe(400);
    expect(apiErrorSchema.parse(spoof.body).error.code).toBe('INPUT_INVALID');

    const accepted = await call(AUTHORING_ACCEPT_PATH, who, {
      body: { yaml: DRAFT, field: 'purpose', text: s.text, suggestionId: s.suggestionId },
    });
    expect(accepted.status).toBe(200);
    const a = authoringAcceptResponseSchema.parse(accepted.body);
    expect(a.accepted.acceptedBy).toBe(CLERK);
    expect(a.yaml).toContain(SUGGESTED);

    // The key is in no response and no row; neither is the spoofed acceptor.
    const rows = JSON.stringify(await authoringRows());
    for (const text of [status, dry.text, s, spoof.text, accepted.text, rows].map((x) =>
      typeof x === 'string' ? x : JSON.stringify(x),
    )) {
      expect(text).not.toContain(KEY);
    }
    expect(rows).not.toContain('mallory');
    expect((await launched.store.audit.verifyChain('local')).status).toBe('intact');
  }, 30_000);
});
