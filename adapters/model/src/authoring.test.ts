import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  SecretValue,
  parseSecretRef,
  type SecretRef,
  type SecretStore,
} from '@mcpforge/gateway/secrets';

import {
  ALLOWED_FIELDS,
  UNCONFIGURED,
  applySuggestion,
  authoringEnabled,
  buildSuggestRequest,
  checkSuggestion,
  createModel,
  extractBlueVerseText,
  fakeModel,
  intentsPrompt,
  parseAuthoringConfig,
  parseCandidates,
  previewPayload,
  promoteIntent,
  provenancePath,
  recordAcceptance,
  renderPrompt,
  selectProvider,
  suggestField,
  suggestIntents,
  suggestedIntentsYaml,
  type AuthoringConfig,
  type Prompt,
} from './index.js';

// A draft stuffed with sentinel values in every field a model must never see.
const DRAFT_YAML = `apiVersion: mcpforge/v1
kind: Tool
id: jde.ap.voucher.create
version: 1.0.0
server: jde-fin-ap
title: Create a voucher
purpose: Create an AP voucher against a supplier.
disambiguation: Creates a NEW voucher.
app: jde
module: ap
entity: voucher
verb: create
sensitivity: internal
write: true
coreForRoles: [SENTINEL_ROLE]
binding:
  type: function
  technology: SENTINEL_TECHNOLOGY
  ref: SENTINEL_BINDING_REF
  identity:
    carries: unverified
    probe: SENTINEL_PROBE
input:
  - { name: supplier_number, type: string, required: true, desc: Supplier number. }
  - { name: amount, type: number, required: true, desc: Gross amount. }
output:
  summaryTemplate: "Voucher {document_number} created."
  resultKeys:
    - { name: document_number, path: "$.v.n" }
writeSafety:
  dryRun: { strategy: validate-pair, ref: SENTINEL_DRYRUN }
  confirm:
    required: true
    tokenTtlSeconds: 300
    planTemplate: "Create a voucher. This creates an OPEN PAYABLE in JD Edwards."
  humanApprovalRequired: false
  reversal: { class: compensating-tool, tool: SENTINEL_REVERSAL_TOOL }
governance:
  reviewPath: standard
  owner: SENTINEL_OWNER
  steward: bob
eval: { intentsFile: evals/x.yaml, minIntents: 10 }
`;
const DOC = parseYaml(DRAFT_YAML) as Record<string, unknown>;
const SIBLINGS = [{ id: 'jde.ap.voucher.get', purpose: 'Get one voucher.' }];
const SENTINELS = [
  'SENTINEL_ROLE',
  'SENTINEL_TECHNOLOGY',
  'SENTINEL_BINDING_REF',
  'SENTINEL_PROBE',
  'SENTINEL_DRYRUN',
  'SENTINEL_REVERSAL_TOOL',
  'SENTINEL_OWNER',
  'unverified',
  'bob',
  'jde-fin-ap',
];

const CONFIG: AuthoringConfig = {
  apiVersion: 'mcpforge/v1',
  kind: 'AuthoringModels',
  enabled: true,
  default: 'blueverse',
  providers: [
    {
      id: 'blueverse',
      kind: 'blueverse',
      keyRef: 'secretRef://gateway/authoring-model-blueverse/api-key',
      baseUrl: 'https://blueverse-foundry.ltm.com/chatservice/chat',
      spaceName: 'space-1',
      flowId: 'flow-1',
      allowedSensitivities: ['public', 'internal', 'confidential'],
    },
    {
      id: 'claude',
      kind: 'anthropic',
      keyRef: 'secretRef://gateway/authoring-model-claude/api-key',
      baseUrl: 'https://api.anthropic.com/v1/messages',
      model: 'claude-sonnet-5-5',
      allowedSensitivities: ['public', 'internal', 'confidential', 'financial'],
    },
  ],
};

const KEY = 'TOP-SECRET-KEY-VALUE';
function store(present: readonly string[] = ['blueverse', 'claude']): SecretStore {
  const has = (uri: string): boolean => present.some((p) => uri.includes(`authoring-model-${p}/`));
  return {
    kind: 'encrypted-file',
    async get(ref: SecretRef) {
      if (!has(ref.uri)) throw new Error('missing');
      return new SecretValue(ref, 1, KEY);
    },
    async metadata(ref: SecretRef) {
      if (!has(ref.uri)) throw new Error('missing');
      return {
        ref: ref.uri,
        version: 1,
        createdAt: 'x',
        rotatedAt: undefined,
        expiresAt: undefined,
      };
    },
    async rotate(ref: SecretRef) {
      return ref;
    },
    async list() {
      return [];
    },
    async put() {
      throw new Error('unused');
    },
    async revoke() {},
  } as unknown as SecretStore;
}

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
function fetchStub(reply: { status?: number; body: unknown }, calls: Call[] = []): typeof fetch {
  return (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({
      url,
      headers: init.headers,
      body: JSON.parse(init.body) as Record<string, unknown>,
    });
    return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
    });
  }) as unknown as typeof fetch;
}

describe('the allow-list is closed and checked before any provider is called (note §1)', () => {
  it('is exactly the documented list', () => {
    expect([...ALLOWED_FIELDS]).toEqual([
      'purpose',
      'disambiguation',
      'aliases',
      'input.desc',
      'input.example',
      'output.summaryTemplate',
      'writeSafety.confirm.planTemplate',
    ]);
  });

  it.each([
    'binding.type',
    'binding.ref',
    'identity.carries',
    'writeSafety.reversal.class',
    'writeSafety.dryRun.strategy',
    'writeSafety.humanApprovalRequired',
    'governance.reviewPath',
    'sensitivity',
    'write',
    'version',
    'id',
    'server',
    'coreForRoles',
    'generated/tools/x/handler.generated.ts',
  ])('refuses %s and never calls the provider', async (field) => {
    const sent: Prompt[] = [];
    const r = await suggestField(
      { config: CONFIG, target: { field: field as never }, draft: { doc: DOC } },
      { secrets: store() },
      fakeModel({ sent }),
    );
    expect(r).toMatchObject({ ok: false, code: 'AUTHORING_FIELD_NOT_ALLOWED' });
    expect(sent).toEqual([]);
  });
});

describe('applySuggestion cannot write outside the allow-list, even when the model tries', () => {
  const ATTACKS = [
    'Look up vouchers.\nbinding:\n  type: plsql\n  ref: EVIL',
    'x\ngovernance:\n  reviewPath: expedited',
    '{"binding": {"type": "plsql"}}',
    'x: y\nidentity:\n  carries: verified',
    '---\nwrite: false',
  ];
  it.each(ATTACKS)('the gate refuses %j', (text) => {
    expect(checkSuggestion({ field: 'purpose' }, text, { doc: DOC })).toMatchObject({
      ok: false,
      code: 'AUTHORING_GATE_REFUSED',
    });
  });

  it.each(ATTACKS)(
    'and even with the gate bypassed, %j only ever becomes one string scalar',
    (text) => {
      const r = applySuggestion(DRAFT_YAML, { field: 'purpose' }, text);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const after = parseYaml(r.yaml) as Record<string, unknown> & {
        binding?: unknown;
        governance?: unknown;
        version?: unknown;
        write?: unknown;
        purpose?: unknown;
      };
      const before = parseYaml(DRAFT_YAML) as Record<string, unknown> & {
        binding?: unknown;
        governance?: unknown;
        version?: unknown;
        write?: unknown;
        purpose?: unknown;
      };
      expect(after['purpose']).toBe(text);
      expect(after['binding']).toEqual(before['binding']);
      expect(after['governance']).toEqual(before['governance']);
      expect(after['write']).toBe(true);
      expect({ ...after, purpose: 0 }).toEqual({ ...before, purpose: 0 });
    },
  );

  it('changes exactly one path for each allowed field', () => {
    const base = parseYaml(DRAFT_YAML) as Record<string, unknown> & {
      binding?: unknown;
      governance?: unknown;
      version?: unknown;
      write?: unknown;
      purpose?: unknown;
    };
    const cases: [Parameters<typeof applySuggestion>[1], string][] = [
      [{ field: 'disambiguation' }, 'Not jde.ap.voucher.get.'],
      [{ field: 'aliases' }, 'bill entry\nenter a bill'],
      [{ field: 'output.summaryTemplate' }, 'Voucher {document_number} booked.'],
      [{ field: 'writeSafety.confirm.planTemplate' }, 'Create it. This creates an OPEN PAYABLE.'],
      [{ field: 'input.desc', inputName: 'amount' }, 'Gross amount.'],
      [{ field: 'input.example', inputName: 'amount' }, '125.50'],
    ];
    for (const [target, text] of cases) {
      const r = applySuggestion(DRAFT_YAML, target, text);
      expect(r.ok, JSON.stringify(target)).toBe(true);
      if (!r.ok) continue;
      const after = parseYaml(r.yaml) as Record<string, unknown> & {
        binding?: unknown;
        governance?: unknown;
        version?: unknown;
        write?: unknown;
        purpose?: unknown;
      };
      expect(after['binding']).toEqual(base['binding']);
      expect(after['governance']).toEqual(base['governance']);
      expect(after['version']).toBe(base['version']);
    }
  });

  it('never creates write safety, and never invents an input', () => {
    const readOnly = DRAFT_YAML.replace(/writeSafety:[\s\S]*?\ngovernance:/, 'governance:');
    expect(
      applySuggestion(readOnly, { field: 'writeSafety.confirm.planTemplate' }, 'This x.'),
    ).toMatchObject({ ok: false });
    expect(
      applySuggestion(DRAFT_YAML, { field: 'input.desc', inputName: 'nope' }, 'x'),
    ).toMatchObject({ ok: false });
    expect(applySuggestion('purpose: [unclosed', { field: 'purpose' }, 'x')).toMatchObject({
      ok: false,
    });
  });
});

describe('what leaves the machine (note §4)', () => {
  it('sends only the positive list: no binding, identity, governance, write-safety values or roles', () => {
    for (const field of ALLOWED_FIELDS) {
      const target = field.startsWith('input.') ? { field, inputName: 'amount' } : { field };
      const built = buildSuggestRequest(target, { doc: DOC, siblings: SIBLINGS });
      expect(built.ok, field).toBe(true);
      if (!built.ok) continue;
      const wire =
        JSON.stringify(built.request) +
        renderPrompt(built.request).system +
        renderPrompt(built.request).user;
      for (const s of SENTINELS) expect(wire, `${field} leaked ${s}`).not.toContain(s);
      expect(wire).toContain('jde.ap.voucher.create');
    }
  });

  it('shows the payload before sending and sends nothing', () => {
    const p = previewPayload({ config: CONFIG, target: { field: 'purpose' }, draft: { doc: DOC } });
    expect(p).toMatchObject({ ok: true, provider: 'blueverse' });
    if (p.ok) expect(p.user).toContain('Field: purpose');
  });
});

describe('overlay and provider selection (note §2.1)', () => {
  const yaml = (extra: string): string =>
    `apiVersion: mcpforge/v1\nkind: AuthoringModels\nenabled: true\ndefault: bv\nproviders:\n  - id: bv\n    kind: blueverse\n    keyRef: secretRef://gateway/authoring-model-bv/api-key\n${extra}`;

  it('is off and absent by default', () => {
    expect(authoringEnabled(UNCONFIGURED)).toBe(false);
    expect(selectProvider(UNCONFIGURED)).toMatchObject({
      ok: false,
      code: 'AUTHORING_NOT_CONFIGURED',
    });
  });

  it('defaults BlueVerse to the ltm.com host and the D4 sensitivity default', () => {
    const r = parseAuthoringConfig(yaml(''));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.config.providers[0]!;
    expect(p.kind === 'blueverse' && p.baseUrl).toBe(
      'https://blueverse-foundry.ltm.com/chatservice/chat',
    );
    expect(p.allowedSensitivities).toEqual(['public', 'internal', 'confidential']);
    expect(JSON.stringify(r.config)).not.toContain('ltimindtree');
  });

  it('rejects a pasted key, a non-secretRef keyRef and an unknown default', () => {
    expect(parseAuthoringConfig(yaml('    apiKey: sk-live-123\n'))).toMatchObject({ ok: false });
    expect(
      parseAuthoringConfig(
        yaml('').replace('secretRef://gateway/authoring-model-bv/api-key', 'sk-live-123'),
      ),
    ).toMatchObject({ ok: false });
    expect(parseAuthoringConfig(yaml('').replace('default: bv', 'default: nope'))).toMatchObject({
      ok: false,
    });
  });

  it('there is NO silent fallback: a failing provider fails, naming the others, and the other is never called', async () => {
    const calls: Call[] = [];
    const r = await suggestField(
      { config: CONFIG, target: { field: 'purpose' }, draft: { doc: DOC } },
      { secrets: store(), fetch: fetchStub({ status: 500, body: 'boom' }, calls) },
    );
    expect(r).toMatchObject({ ok: false, code: 'AUTHORING_PROVIDER_FAILED' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('blueverse-foundry.ltm.com');
    if (!r.ok) expect(r.next).toMatch(/--provider/);
  });

  it('an unknown provider names the configured ones', () => {
    const r = selectProvider(CONFIG, 'gpt');
    expect(r).toMatchObject({ ok: false, code: 'AUTHORING_PROVIDER_UNKNOWN' });
    if (!r.ok) expect(r.next).toContain('blueverse, claude');
  });

  it('D4: a financial tool is blocked by default and allowed where the provider opts in', async () => {
    const financial = { ...DOC, sensitivity: 'financial' };
    const blocked = await suggestField(
      {
        config: CONFIG,
        target: { field: 'purpose' },
        draft: { doc: financial },
        providerId: 'blueverse',
      },
      { secrets: store() },
      fakeModel(),
    );
    expect(blocked).toMatchObject({ ok: false, code: 'AUTHORING_SENSITIVITY_BLOCKED' });
    const allowed = await suggestField(
      {
        config: CONFIG,
        target: { field: 'purpose' },
        draft: { doc: financial },
        providerId: 'claude',
      },
      { secrets: store() },
      fakeModel(),
    );
    expect(allowed.ok).toBe(true);
  });
});

describe('providers: the key is dereferenced only here and never escapes (note §3)', () => {
  it('BlueVerse: POST {query, space_name, flowId} with a Bearer token, to the ltm.com host', async () => {
    const calls: Call[] = [];
    const r = await suggestField(
      { config: CONFIG, target: { field: 'purpose' }, draft: { doc: DOC } },
      {
        secrets: store(),
        fetch: fetchStub({ body: { data: { answer: 'Look up AP vouchers by amount.' } } }, calls),
        newRequestId: () => 'req-1',
      },
    );
    expect(r).toMatchObject({ ok: true, text: 'Look up AP vouchers by amount.' });
    expect(calls[0]!.url).toBe('https://blueverse-foundry.ltm.com/chatservice/chat');
    expect(calls[0]!.headers['Authorization']).toBe(`Bearer ${KEY}`);
    expect(Object.keys(calls[0]!.body).sort()).toEqual(['flowId', 'query', 'space_name']);
    expect(calls[0]!.body['space_name']).toBe('space-1');
    expect(String(calls[0]!.body['query'])).toContain('Field: purpose');
    // BlueVerse selects the model inside the flow, so the model is the flow.
    if (r.ok)
      expect(r.provenance).toEqual({
        provider: 'blueverse',
        model: 'flow:flow-1',
        requestId: 'req-1',
      });
  });

  it.each([
    [{ output: ' a ' }, 'a'],
    [{ answer: 'b' }, 'b'],
    [{ data: { response: 'c' } }, 'c'],
    [{ result: { text: 'd' } }, 'd'],
    [{ choices: [{ message: { content: 'e' } }] }, 'e'],
  ])('extracts BlueVerse shape %j', (body, expected) => {
    expect(extractBlueVerseText(body)).toBe(expected);
  });

  it('an unrecognised BlueVerse shape is a failure, NOT a JSON blob handed to the draft', async () => {
    const r = await suggestField(
      { config: CONFIG, target: { field: 'purpose' }, draft: { doc: DOC } },
      { secrets: store(), fetch: fetchStub({ body: { weird: { nested: [1, 2] } } }) },
    );
    expect(r).toMatchObject({ ok: false, code: 'AUTHORING_RESPONSE_UNRECOGNISED' });
    expect(extractBlueVerseText({ weird: 1 })).toBeUndefined();
  });

  it('Anthropic: x-api-key header, system + user, text content', async () => {
    const calls: Call[] = [];
    const r = await suggestField(
      { config: CONFIG, target: { field: 'purpose' }, draft: { doc: DOC }, providerId: 'claude' },
      {
        secrets: store(),
        fetch: fetchStub(
          { body: { content: [{ type: 'text', text: 'Find vouchers by supplier.' }] } },
          calls,
        ),
      },
    );
    expect(r).toMatchObject({ ok: true, text: 'Find vouchers by supplier.' });
    expect(calls[0]!.headers['x-api-key']).toBe(KEY);
    expect(calls[0]!.body['model']).toBe('claude-sonnet-5-5');
    expect(typeof calls[0]!.body['system']).toBe('string');
  });

  it('OpenAI-compatible: appends /v1/chat/completions to a bare base URL', async () => {
    const calls: Call[] = [];
    const cfg: AuthoringConfig = {
      ...CONFIG,
      default: 'local',
      providers: [
        {
          id: 'local',
          kind: 'openai-compatible',
          keyRef: 'secretRef://gateway/authoring-model-local/api-key',
          baseUrl: 'http://localhost:11434',
          model: 'llama',
          allowedSensitivities: ['internal'],
        },
      ],
    };
    const r = await suggestField(
      { config: cfg, target: { field: 'purpose' }, draft: { doc: DOC } },
      {
        secrets: store(['local']),
        fetch: fetchStub(
          { body: { choices: [{ message: { content: 'Find vouchers.' } }] } },
          calls,
        ),
      },
    );
    expect(r.ok).toBe(true);
    expect(calls[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('no key stored: the provider is unavailable, no network call is made, and the message names the command', async () => {
    const calls: Call[] = [];
    const r = await suggestField(
      { config: CONFIG, target: { field: 'purpose' }, draft: { doc: DOC } },
      { secrets: store([]), fetch: fetchStub({ body: {} }, calls) },
    );
    expect(r).toMatchObject({ ok: false, code: 'AUTHORING_PROVIDER_UNAVAILABLE' });
    expect(calls).toEqual([]);
    if (!r.ok)
      expect(r.next).toContain(
        'forge secrets put secretRef://gateway/authoring-model-blueverse/api-key',
      );
  });

  it('a BlueVerse provider with no space/flow is unavailable, not guessed', async () => {
    const cfg: AuthoringConfig = {
      ...CONFIG,
      providers: [{ ...CONFIG.providers[0]!, spaceName: '', flowId: '' } as never],
    };
    const m = await createModel(cfg.providers[0]!, { secrets: store() });
    expect(m.available).toBe(false);
  });

  it('the key never appears in a failure, a provenance record or a result', async () => {
    for (const status of [401, 500]) {
      const r = await suggestField(
        { config: CONFIG, target: { field: 'purpose' }, draft: { doc: DOC } },
        { secrets: store(), fetch: fetchStub({ status, body: `echo ${KEY}` }) },
      );
      expect(JSON.stringify(r)).not.toContain(KEY);
    }
    const ok = await suggestField(
      { config: CONFIG, target: { field: 'purpose' }, draft: { doc: DOC } },
      { secrets: store(), fetch: fetchStub({ body: { output: 'Find vouchers.' } }) },
    );
    expect(JSON.stringify(ok)).not.toContain(KEY);
    // and the SecretValue itself prints redacted, never the value
    expect(
      String(
        await store().get(parseSecretRef('secretRef://gateway/authoring-model-blueverse/api-key')),
      ),
    ).not.toContain(KEY);
  });

  it('a 401 tells you how to rotate the key', async () => {
    const r = await suggestField(
      { config: CONFIG, target: { field: 'purpose' }, draft: { doc: DOC } },
      { secrets: store(), fetch: fetchStub({ status: 401, body: '' }) },
    );
    if (!r.ok) expect(r.next).toContain('forge secrets put');
  });
});

describe('the structural gate (note §5 step 3)', () => {
  const ctx = { doc: DOC, siblings: SIBLINGS };
  it('purpose and desc word budgets use the validate constants', () => {
    expect(
      checkSuggestion(
        { field: 'purpose' },
        'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen',
        ctx,
      ),
    ).toMatchObject({ ok: false });
    expect(checkSuggestion({ field: 'purpose' }, '"Find vouchers by supplier."', ctx)).toEqual({
      ok: true,
      text: 'Find vouchers by supplier.',
    });
    expect(
      checkSuggestion(
        { field: 'input.desc', inputName: 'amount' },
        'a b c d e f g h i j k l m',
        ctx,
      ),
    ).toMatchObject({ ok: false });
  });
  it('disambiguation must name every sibling', () => {
    expect(checkSuggestion({ field: 'disambiguation' }, 'Not for reading.', ctx)).toMatchObject({
      ok: false,
    });
    expect(
      checkSuggestion({ field: 'disambiguation' }, 'To read one use jde.ap.voucher.get.', ctx),
    ).toMatchObject({ ok: true });
  });
  it('summaryTemplate placeholders must be declared result keys', () => {
    expect(
      checkSuggestion({ field: 'output.summaryTemplate' }, 'Voucher {nope} created.', ctx),
    ).toMatchObject({ ok: false });
    expect(
      checkSuggestion(
        { field: 'output.summaryTemplate' },
        'Voucher {document_number} created.',
        ctx,
      ),
    ).toMatchObject({ ok: true });
  });
  it('the plan text must state a consequence', () => {
    expect(
      checkSuggestion({ field: 'writeSafety.confirm.planTemplate' }, 'Create a voucher.', ctx),
    ).toMatchObject({ ok: false });
    expect(
      checkSuggestion(
        { field: 'writeSafety.confirm.planTemplate' },
        'Create it. This creates an OPEN PAYABLE.',
        ctx,
      ),
    ).toMatchObject({ ok: true });
  });
  it('an example must match the parameter type; aliases are capped at 8', () => {
    expect(
      checkSuggestion({ field: 'input.example', inputName: 'amount' }, 'lots', ctx),
    ).toMatchObject({ ok: false });
    expect(
      checkSuggestion({ field: 'input.example', inputName: 'amount' }, '12.5', ctx),
    ).toMatchObject({ ok: true });
    expect(
      checkSuggestion(
        { field: 'aliases' },
        Array.from({ length: 9 }, (_, i) => `a${i}`).join('\n'),
        ctx,
      ),
    ).toMatchObject({ ok: false });
  });
  it('re-checks the allow-list itself: an off-list field is refused, never accepted', () => {
    expect(checkSuggestion({ field: 'binding.ref' as never }, 'EVIL', ctx)).toMatchObject({
      ok: false,
      code: 'AUTHORING_FIELD_NOT_ALLOWED',
    });
  });
  it('refuses empty text, secret references and leftover REPLACE placeholders; every refusal has a next', () => {
    for (const t of ['', '   ', 'use secretRef://gateway/x/y', 'REPLACE me']) {
      const r = checkSuggestion({ field: 'purpose' }, t, ctx);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.next.length).toBeGreaterThan(0);
    }
  });
});

describe('provenance (note §5 step 7)', () => {
  it('records provider, model, request id and the acceptor, and re-accepting replaces the entry', () => {
    const p = { provider: 'blueverse', model: 'flow:f', requestId: 'r1' };
    const a = recordAcceptance(
      undefined,
      'jde.ap.voucher.create',
      { field: 'purpose' },
      p,
      'alice',
      't1',
    );
    const b = recordAcceptance(
      a,
      'jde.ap.voucher.create',
      { field: 'purpose' },
      { ...p, requestId: 'r2' },
      'bob',
      't2',
    );
    const c = recordAcceptance(
      b,
      'jde.ap.voucher.create',
      { field: 'input.desc', inputName: 'amount' },
      p,
      'bob',
      't3',
    );
    const doc = parseYaml(c) as {
      fields: { field: string; requestId: string; acceptedBy: string }[];
    };
    expect(doc.fields.map((f) => [f.field, f.requestId, f.acceptedBy])).toEqual([
      ['purpose', 'r2', 'bob'],
      ['input.desc', 'r1', 'bob'],
    ]);
    expect(c).not.toContain(KEY);
    expect(provenancePath('jde.ap.voucher.create')).toBe(
      'provenance/jde.ap.voucher.create.authoring.yaml',
    );
  });
});

describe('eval intents stay steward-owned (note §6)', () => {
  const input = {
    config: CONFIG,
    toolId: 'jde.ap.voucher.create',
    app: 'jde',
    module: 'ap',
    entity: 'voucher',
    verb: 'create',
    sensitivity: 'internal',
  };

  it('is a SEPARATE call whose context excludes the draft copy', async () => {
    const sent: Prompt[] = [];
    const r = await suggestIntents(
      input,
      { secrets: store() },
      fakeModel({
        sent,
        reply: () => '1. book a bill\n2. enter a supplier invoice\n- add an AP voucher',
      }),
    );
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    const wire = `${sent[0]!.system}\n${sent[0]!.user}`;
    for (const copy of [
      'Create an AP voucher against a supplier.',
      'Creates a NEW voucher',
      'OPEN PAYABLE',
      ...SENTINELS,
    ]) {
      expect(wire).not.toContain(copy);
    }
    expect(intentsPrompt(input).user).toContain('jde.ap.voucher.create');
    if (r.ok)
      expect(r.candidates.map((c) => c.utterance)).toEqual([
        'book a bill',
        'enter a supplier invoice',
        'add an AP voucher',
      ]);
  });

  it('writes a suggestions file that is marked as suggestions, never an evals/ document', () => {
    const y = suggestedIntentsYaml('t', parseCandidates('a question', 't'), {
      provider: 'p',
      model: 'm',
      requestId: 'r',
    });
    expect(y).toContain('kind: SuggestedIntents');
    expect(y).toContain('never the author of record');
    expect(y).not.toContain('authoredBy');
  });

  it('promotion into evals/ is refused unless the promoter IS the named steward', () => {
    const c = { utterance: 'book a bill', expectedTool: 'jde.ap.voucher.create' };
    const refused = promoteIntent('intents: []\n', c, 'alice', 'bob', 't');
    expect(refused).toMatchObject({ ok: false });
    if (!refused.ok) expect(refused.next).toContain('bob');
    const ok = promoteIntent('intents: []\n', c, 'bob', 'bob', 't');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const doc = parseYaml(ok.intentsYaml) as { intents: Record<string, unknown>[] };
      expect(doc.intents[0]).toMatchObject({ authoredBy: 'bob', promotedFromSuggestion: true });
    }
  });
});

describe('end to end with the fake', () => {
  it('returns a gated suggestion with provenance, and a gate failure is surfaced, not written', async () => {
    const good = await suggestField(
      { config: CONFIG, target: { field: 'purpose' }, draft: { doc: DOC, siblings: SIBLINGS } },
      { secrets: store() },
      fakeModel({ id: 'blueverse' }),
    );
    expect(good).toMatchObject({ ok: true, provenance: { provider: 'blueverse' } });
    const bad = await suggestField(
      { config: CONFIG, target: { field: 'purpose' }, draft: { doc: DOC } },
      { secrets: store() },
      fakeModel({ reply: () => 'x\nbinding:\n  type: plsql' }),
    );
    expect(bad).toMatchObject({ ok: false, code: 'AUTHORING_GATE_REFUSED' });
  });

  it('an unavailable model is reported, with no fallback', async () => {
    const r = await suggestField(
      { config: CONFIG, target: { field: 'purpose' }, draft: { doc: DOC } },
      { secrets: store() },
      fakeModel({ available: false }),
    );
    expect(r).toMatchObject({ ok: false, code: 'AUTHORING_PROVIDER_UNAVAILABLE' });
  });
});
