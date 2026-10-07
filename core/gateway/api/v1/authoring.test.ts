// W0-Q9b — the gateway's authoring endpoints (D7), in isolation, over a REAL
// SQLite runtime store and a REAL sealed vault. The provider is the only fake:
// an injected fetch that records what would have left the gateway. The
// launched-gateway policy suite (tests/policy/escalation.authoring.test.ts)
// drives the front door; this file drives everything behind it.

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  authoringAcceptResponseSchema,
  authoringSuggestResponseSchema,
} from '@mcpforge/shared/api/v1';
import type { EstablishedSession } from '../../assembly/session.js';
import { ConsumerCallRateLimiter } from '../../caps/consumer-quota.js';
import { parseSecretRef } from '../../secrets/index.js';
import { EncryptedFileStore } from '../../secrets/server.js';
import type { AuditCallRecord } from '../../store/audit/types.js';
import type { RuntimeStore } from '../../store/repository.js';
import { openRuntimeStore } from '../../store/server.js';
import {
  AUTHORING_SUGGESTION_TTL_MS,
  authoringAccept,
  authoringStatus,
  authoringSuggest,
  type AuthoringDeps,
} from './authoring.js';
import { ApiRefusal, STATUS_BY_CODE } from './refusal.js';

// Each model call opens the sealed vault (a deliberately slow KDF), and several
// tests make five or more: the default 5 s is too tight when the suite runs in
// parallel with the rest of the gateway's.
vi.setConfig({ testTimeout: 30_000 });

const KEY = 'sk-SENTINEL-AUTHORING-KEY-9f3a';
const KEY_REF = 'secretRef://gateway/authoring-model-oc/api-key';
const SECRETS_ENV = { MCPFORGE_SECRETS_KEY: 'w0-q9b-test-only-sealing-passphrase' };
const ALICE = 'local:alice';
const BOB = 'local:bob';
const SUGGESTED = 'Create an AP voucher for a supplier invoice.';

const OVERLAY = `apiVersion: mcpforge/v1
kind: AuthoringModels
enabled: true
default: oc
providers:
  - id: oc
    kind: openai-compatible
    model: test-model
    baseUrl: http://model.test/v1/chat/completions
    keyRef: ${KEY_REF}
`;

const DRAFT = `apiVersion: mcpforge/v1
kind: Tool
id: jde.ap.voucher.create
app: jde
module: ap
entity: voucher
verb: create
sensitivity: internal
write: true
purpose: Old purpose.
binding: { type: function, ref: SENTINEL_BINDING_REF }
governance: { reviewPath: standard, steward: bob }
input:
  - { name: amount, type: number, desc: Amount. }
`;

const SIBLING = `apiVersion: mcpforge/v1
kind: Tool
id: jde.ap.voucher.get
app: jde
module: ap
entity: voucher
verb: get
purpose: Get one voucher.
`;

let defs: string;
let install: string;
let store: RuntimeStore;
let vault: EncryptedFileStore;
let clock: Date;
let calls: { url: string; headers: Record<string, string>; body: string }[];
let reply: () => Promise<Response>;

function put(rel: string, text: string): void {
  mkdirSync(join(defs, rel, '..'), { recursive: true });
  writeFileSync(join(defs, rel), text);
}

const fakeFetch: typeof fetch = async (input, init) => {
  calls.push({
    url: String(input),
    headers: { ...(init?.headers as Record<string, string>) },
    body: String(init?.body ?? ''),
  });
  return reply();
};

const okReply = (text: string) => () =>
  Promise.resolve(
    new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 }),
  );

function session(
  options: {
    subject?: string;
    humanInTheLoop?: boolean;
    maxSensitivity?: string;
    consumerId?: string;
  } = {},
): EstablishedSession {
  const principal = { subject: options.subject ?? ALICE, groups: [] };
  const scopeSession = {
    principal,
    heldRoleIds: ['p2p'],
    consumer: {
      consumerId: options.consumerId ?? 'portal-local',
      authorizations: {
        writeAllowed: true,
        maxSensitivity: options.maxSensitivity ?? 'confidential',
      },
      attestation: { humanInTheLoop: options.humanInTheLoop ?? true },
    },
    consumerSession: { recordSha: 'sha', authMethod: 'private-key-jwt', consumerSessionId: 'cs' },
  };
  return {
    sessionId: 's-1',
    principal,
    scopeSession,
    scopeAt: () => ({ deployment: { deploymentId: 'local' } }),
  } as unknown as EstablishedSession;
}

function deps(over: Partial<AuthoringDeps> = {}): AuthoringDeps {
  return {
    store,
    source: { secretStore: vault, definitionsRoot: defs, deployment: 'local', fetch: fakeFetch },
    catalogue: { entries: [] },
    callsPerMinute: () => 60,
    rateLimiter: new ConsumerCallRateLimiter(),
    gatewayVersion: 'test',
    now: () => clock,
    ...over,
  };
}

const actor = (s: EstablishedSession = session()) => ({
  session: s,
  subject: s.principal.subject,
  correlationId: 'req-1',
});

const body = (b: unknown) => () => Promise.resolve(b);

async function refusal(p: Promise<unknown>): Promise<ApiRefusal> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ApiRefusal);
  const r = e as ApiRefusal;
  // Non-negotiable 5: every refusal is actionable.
  expect(r.next.trim().length).toBeGreaterThan(0);
  expect(r.next.toLowerCase()).not.toContain('try again');
  expect(STATUS_BY_CODE[r.code], `${r.code} has an HTTP status`).toBeDefined();
  return r;
}

async function rows(): Promise<AuditCallRecord[]> {
  return (await store.audit.listChain('local')).filter((r) => r.phase === 'authoring');
}

async function suggestOk(d = deps(), a = actor()) {
  const r = authoringSuggestResponseSchema.parse(
    await authoringSuggest(d, a, body({ yaml: DRAFT, field: 'purpose' })),
  );
  if (r.dryRun) throw new Error('expected a suggestion');
  return r;
}

beforeAll(async () => {
  install = mkdtempSync(join(tmpdir(), 'forge-q9b-install-'));
  store = await openRuntimeStore({ kind: 'sqlite', file: join(install, 'runtime.db') });
  vault = new EncryptedFileStore({ repoRoot: install, env: SECRETS_ENV });
  await vault.put(parseSecretRef(KEY_REF), KEY);
});
afterAll(async () => {
  await store.close();
  rmSync(install, { recursive: true, force: true });
});
beforeEach(() => {
  defs = mkdtempSync(join(tmpdir(), 'forge-q9b-defs-'));
  put('overlays/local/authoring.yaml', OVERLAY);
  put('manifests/jde/ap/voucher.get.tool.yaml', SIBLING);
  clock = new Date('2026-10-07T10:00:00Z');
  calls = [];
  reply = okReply(SUGGESTED);
});
afterEach(() => rmSync(defs, { recursive: true, force: true }));

describe('status', () => {
  it('reports providers and whether a key is stored, never the key', async () => {
    const s = await authoringStatus(deps(), actor());
    expect(s).toMatchObject({
      enabled: true,
      defaultProvider: 'oc',
      providers: [{ id: 'oc', kind: 'openai-compatible', available: true }],
    });
    expect(JSON.stringify(s)).not.toContain(KEY);
    expect(calls).toHaveLength(0);
  });

  it('is absent, not broken, with no overlay or a broken one', async () => {
    rmSync(join(defs, 'overlays'), { recursive: true });
    expect(await authoringStatus(deps(), actor())).toMatchObject({ enabled: false, providers: [] });
    put(
      'overlays/local/authoring.yaml',
      OVERLAY.replace('keyRef:', 'apiKey: sk-pasted\n    keyRef:'),
    );
    expect(await authoringStatus(deps(), actor())).toMatchObject({ enabled: false });
  });

  it('refuses an agent consumer (no human in its loop), audited', async () => {
    const before = (await rows()).length;
    const r = await refusal(authoringStatus(deps(), actor(session({ humanInTheLoop: false }))));
    expect(r.code).toBe('CONSUMER_NOT_AUTHORIZED');
    const row = (await rows()).at(-1)!;
    expect((await rows()).length).toBe(before + 1);
    expect(row).toMatchObject({
      toolId: 'forge.authoring.status',
      outcome: 'policy_denied',
      deniedByRule: 'authoring.consumer_no_human',
      isWrite: false,
    });
  });
});

describe('suggest', () => {
  it('dryRun shows exactly what would be sent, sends nothing and writes no row', async () => {
    const before = (await rows()).length;
    const r = authoringSuggestResponseSchema.parse(
      await authoringSuggest(
        deps(),
        actor(),
        body({ yaml: DRAFT, field: 'purpose', dryRun: true }),
      ),
    );
    expect(r.dryRun).toBe(true);
    if (!r.dryRun) return;
    expect(r.sent).toBe(false);
    expect(r.user).toContain('jde.ap.voucher.create');
    expect(r.user).toContain('jde.ap.voucher.get'); // sibling from the gateway's own definitions root
    expect(r.user).not.toContain('SENTINEL_BINDING_REF');
    expect(calls).toHaveLength(0);
    expect((await rows()).length).toBe(before);
  });

  it('returns the text with a suggestionId that IS its audit row; the row holds no prompt, text or key', async () => {
    const r = await suggestOk();
    expect(r.text).toBe(SUGGESTED);
    expect(r.provenance).toMatchObject({ provider: 'oc', model: 'test-model' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).not.toContain('SENTINEL_BINDING_REF');

    const row = await store.audit.get(r.suggestionId);
    expect(row).toMatchObject({
      phase: 'authoring',
      toolId: 'forge.authoring.suggest',
      outcome: 'ok',
      callerSubject: ALICE,
      isWrite: false,
      sensitivityClass: 'internal',
    });
    expect(Object.keys(row!.argsRedacted as object).sort()).toEqual(
      ['bytesSent', 'draftToolId', 'field', 'inputName', 'providerId'].sort(),
    );
    expect(row!.argsRedacted).toMatchObject({
      draftToolId: 'jde.ap.voucher.create',
      field: 'purpose',
      providerId: 'oc',
    });
    expect((row!.argsRedacted as { bytesSent: number }).bytesSent).toBeGreaterThan(0);
    expect(row!.resultKeys).toContainEqual({
      keyName: 'textSha256',
      keyValue: createHash('sha256').update(SUGGESTED).digest('hex'),
    });
    expect(row!.credentialRefs).toEqual([{ secretRef: KEY_REF, version: null }]);
    const all = JSON.stringify(await rows());
    expect(all).not.toContain(KEY);
    expect(all).not.toContain(SUGGESTED);
    expect(all).not.toContain('Requirement:');
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('refuses an agent consumer before reading the body or calling a model, audited', async () => {
    let read = false;
    const r = await refusal(
      authoringSuggest(deps(), actor(session({ humanInTheLoop: false })), () => {
        read = true;
        return Promise.resolve({ yaml: DRAFT, field: 'purpose' });
      }),
    );
    expect(r.code).toBe('CONSUMER_NOT_AUTHORIZED');
    expect(STATUS_BY_CODE[r.code]).toBe(403);
    expect(read).toBe(false);
    expect(calls).toHaveLength(0);
    expect((await rows()).at(-1)).toMatchObject({ deniedByRule: 'authoring.consumer_no_human' });
  });

  it("refuses a draft above the consumer ceiling, and a draft that LOWERS a served tool's sensitivity", async () => {
    const above = await refusal(
      authoringSuggest(
        deps(),
        actor(),
        body({
          yaml: DRAFT.replace('sensitivity: internal', 'sensitivity: financial'),
          field: 'purpose',
        }),
      ),
    );
    expect(above.code).toBe('AUTHORING_SENSITIVITY_BLOCKED');
    expect(STATUS_BY_CODE[above.code]).toBe(403);

    const served = deps({
      catalogue: {
        entries: [{ toolId: 'jde.ap.voucher.create', sensitivity: 'financial' }] as never,
      },
    });
    const lowered = await refusal(
      authoringSuggest(served, actor(), body({ yaml: DRAFT, field: 'purpose' })),
    );
    expect(lowered.code).toBe('AUTHORING_SENSITIVITY_BLOCKED');
    expect(lowered.message).toContain('the draft says internal');
    expect(calls).toHaveLength(0);
    expect((await rows()).at(-1)).toMatchObject({
      outcome: 'policy_denied',
      deniedByRule: 'authoring.sensitivity_above_ceiling',
    });
  });

  it('a field off the allow-list is refused before any provider is called', async () => {
    const r = await refusal(
      authoringSuggest(deps(), actor(), body({ yaml: DRAFT, field: 'binding.ref' })),
    );
    expect(r.code).toBe('AUTHORING_FIELD_NOT_ALLOWED');
    expect(STATUS_BY_CODE[r.code]).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('unconfigured overlay: AUTHORING_NOT_CONFIGURED, audited, nothing sent', async () => {
    rmSync(join(defs, 'overlays'), { recursive: true });
    const r = await refusal(
      authoringSuggest(deps(), actor(), body({ yaml: DRAFT, field: 'purpose' })),
    );
    expect(r.code).toBe('AUTHORING_NOT_CONFIGURED');
    expect(STATUS_BY_CODE[r.code]).toBe(409);
    expect((await rows()).at(-1)).toMatchObject({ errorCode: 'AUTHORING_NOT_CONFIGURED' });
    expect(calls).toHaveLength(0);
  });

  it('a provider with no key stored is unavailable: refused, nothing sent', async () => {
    put(
      'overlays/local/authoring.yaml',
      OVERLAY.replace('authoring-model-oc', 'authoring-model-none'),
    );
    const r = await refusal(
      authoringSuggest(deps(), actor(), body({ yaml: DRAFT, field: 'purpose' })),
    );
    expect(r.code).toBe('AUTHORING_PROVIDER_UNAVAILABLE');
    expect(calls).toHaveLength(0);
    expect((await rows()).at(-1)).toMatchObject({ outcome: 'business_error' });
  });

  it.each([
    [
      'network failure',
      () => Promise.reject(new TypeError('fetch failed')),
      'AUTHORING_PROVIDER_FAILED',
      'binding_error',
      502,
    ],
    [
      'HTTP 500',
      () => Promise.resolve(new Response('boom', { status: 500 })),
      'AUTHORING_PROVIDER_FAILED',
      'binding_error',
      502,
    ],
    [
      'timeout',
      () => Promise.reject(new DOMException('slow', 'TimeoutError')),
      'AUTHORING_PROVIDER_FAILED',
      'timeout',
      502,
    ],
    [
      'unrecognised shape',
      () => Promise.resolve(new Response('{}', { status: 200 })),
      'AUTHORING_RESPONSE_UNRECOGNISED',
      'binding_error',
      502,
    ],
    [
      'gate refusal',
      okReply('Create it.\nbinding:\n  type: plsql'),
      'AUTHORING_GATE_REFUSED',
      'business_error',
      422,
    ],
  ] as const)(
    'model failure (%s) is refused, audited, and carries no key',
    async (_n, r, code, outcome, status) => {
      reply = r;
      const refused = await refusal(
        authoringSuggest(deps(), actor(), body({ yaml: DRAFT, field: 'purpose' })),
      );
      expect(refused.code).toBe(code);
      expect(STATUS_BY_CODE[refused.code]).toBe(status);
      expect(`${refused.message} ${refused.next}`).not.toContain(KEY);
      const row = (await rows()).at(-1)!;
      expect(row).toMatchObject({ errorCode: code, outcome });
      expect(JSON.stringify(row)).not.toContain(KEY);
    },
  );

  it("is rate limited at the consumer's callsPerMinute, per subject", async () => {
    const d = deps({ callsPerMinute: () => 2 });
    await suggestOk(d);
    await suggestOk(d);
    const r = await refusal(authoringSuggest(d, actor(), body({ yaml: DRAFT, field: 'purpose' })));
    expect(r.code).toBe('RATE_LIMITED');
    expect(STATUS_BY_CODE[r.code]).toBe(429);
    expect(calls).toHaveLength(2);
    // Another person through the same consumer has their own window.
    await suggestOk(d, actor(session({ subject: BOB })));
    // A minute later the window has moved on.
    clock = new Date(clock.getTime() + 61_000);
    await suggestOk(d);
  });
});

describe('the acceptor is the session, never the request', () => {
  it.each(['suggest', 'accept'] as const)(
    '%s refuses a spoofed acceptedBy (400) and records no such value',
    async (which) => {
      const spoof =
        which === 'suggest'
          ? { yaml: DRAFT, field: 'purpose', acceptedBy: 'local:mallory' }
          : {
              yaml: DRAFT,
              field: 'purpose',
              text: SUGGESTED,
              suggestionId: 'x',
              acceptedBy: 'local:mallory',
            };
      const fn = which === 'suggest' ? authoringSuggest : authoringAccept;
      const r = await refusal(fn(deps(), actor(), body(spoof)));
      expect(r.code).toBe('INPUT_INVALID');
      expect(STATUS_BY_CODE[r.code]).toBe(400);
      expect(r.next).toContain('Remove');
      expect((await rows()).at(-1)).toMatchObject({
        outcome: 'policy_denied',
        deniedByRule: 'authoring.acceptor_not_requestable',
      });
      expect(JSON.stringify(await rows())).not.toContain('mallory');
    },
  );

  it('a spoofed provenance is refused the same way', async () => {
    const r = await refusal(
      authoringAccept(
        deps(),
        actor(),
        body({
          yaml: DRAFT,
          field: 'purpose',
          text: SUGGESTED,
          suggestionId: 'x',
          provenance: { provider: 'oc', model: 'm', requestId: 'r' },
        }),
      ),
    );
    expect(r.code).toBe('INPUT_INVALID');
    expect(r.message).toContain('provenance');
  });

  it('accept applies one field, stamps the session subject, and reads provenance from the suggestion row', async () => {
    const s = await suggestOk();
    const a = authoringAcceptResponseSchema.parse(
      await authoringAccept(
        deps(),
        actor(),
        body({ yaml: DRAFT, field: 'purpose', text: s.text, suggestionId: s.suggestionId }),
      ),
    );
    expect(a.accepted).toMatchObject({
      field: 'purpose',
      acceptedBy: ALICE,
      provider: s.provenance.provider,
      model: s.provenance.model,
      requestId: s.provenance.requestId,
    });
    expect(a.provenancePath).toBe('provenance/jde.ap.voucher.create.authoring.yaml');
    const doc = parseYaml(a.yaml) as {
      purpose: string;
      binding: { ref: string };
      governance: { steward: string };
    };
    expect(doc.purpose).toBe(SUGGESTED);
    expect(doc.binding.ref).toBe('SENTINEL_BINDING_REF');
    expect(doc.governance.steward).toBe('bob');
    const row = await store.audit.get(a.auditCallId);
    expect(row).toMatchObject({
      toolId: 'forge.authoring.accept',
      outcome: 'ok',
      callerSubject: ALICE,
    });
    expect(row!.resultKeys).toContainEqual({ keyName: 'suggestionId', keyValue: s.suggestionId });
    expect(JSON.stringify(a)).not.toContain(KEY);
  });

  it("refuses another person's suggestion, changed text, another field, another draft, a stale one and an unknown id", async () => {
    const s = await suggestOk();
    const base = { yaml: DRAFT, field: 'purpose', text: s.text, suggestionId: s.suggestionId };
    const cases: [string, unknown, EstablishedSession?][] = [
      ['other subject', base, session({ subject: BOB })],
      ['text changed', { ...base, text: `${s.text} Also pays it.` }],
      ['other field', { ...base, field: 'disambiguation' }],
      [
        'other draft',
        { ...base, yaml: DRAFT.replace('id: jde.ap.voucher.create', 'id: jde.ap.voucher.update') },
      ],
      ['unknown id', { ...base, suggestionId: 'call-does-not-exist' }],
    ];
    for (const [label, req, who] of cases) {
      const r = await refusal(authoringAccept(deps(), actor(who), body(req)));
      expect(r.code, label).toBe('AUTHORING_SUGGESTION_UNKNOWN');
      expect(STATUS_BY_CODE[r.code]).toBe(409);
      expect((await rows()).at(-1), label).toMatchObject({
        deniedByRule: 'authoring.suggestion_unknown',
      });
    }
    clock = new Date(clock.getTime() + AUTHORING_SUGGESTION_TTL_MS + 1);
    const stale = await refusal(authoringAccept(deps(), actor(), body(base)));
    expect(stale.code).toBe('AUTHORING_SUGGESTION_UNKNOWN');
  });

  it('cannot accept a refused suggestion or a suggestion-shaped row of another kind', async () => {
    reply = okReply('Create it.\nbinding:\n  type: plsql');
    await refusal(authoringSuggest(deps(), actor(), body({ yaml: DRAFT, field: 'purpose' })));
    const refusedRow = (await rows()).at(-1)!;
    const r = await refusal(
      authoringAccept(
        deps(),
        actor(),
        body({ yaml: DRAFT, field: 'purpose', text: 'Create it.', suggestionId: refusedRow.id }),
      ),
    );
    expect(r.code).toBe('AUTHORING_SUGGESTION_UNKNOWN');
  });
});

describe('request bounds', () => {
  it('a body that does not parse is refused with a next and audited', async () => {
    const r = await refusal(
      authoringSuggest(deps(), actor(), () =>
        Promise.reject(
          new ApiRefusal(
            'INPUT_INVALID',
            'The request body is larger than 262144 bytes.',
            'Send less.',
          ),
        ),
      ),
    );
    expect(r.code).toBe('INPUT_INVALID');
    expect((await rows()).at(-1)).toMatchObject({ deniedByRule: 'authoring.input_invalid' });
    const notYaml = await refusal(
      authoringSuggest(deps(), actor(), body({ yaml: '- a\n- b\n', field: 'purpose' })),
    );
    expect(notYaml.code).toBe('INPUT_INVALID');
  });

  it('the hash chain is intact after every row above', async () => {
    expect((await store.audit.verifyChain('local')).status).toBe('intact');
  });
});
