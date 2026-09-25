// MCPForge — W0-P14 contract tests: the REAL `function` executor, through the
// REAL HTTP AIS client and per-user token exchange, against the local mock JDE
// over real sockets. The descriptors and schemas are the shipped ones, read
// from `manifests/` and `generated/`, so the calls are the calls the gateway
// will make.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  aisTargetForServer,
  buildFunctionBindingDescriptor,
  compileGeneratedSchema,
  createFunctionExecutor,
  createHttpAisClient,
  createHttpAisTokenProvider,
  loadAisTargetsOverlay,
  type AisTokenProvider,
  type FunctionBindingDescriptor,
} from '@mcpforge/adapter-function';
import { TEST_EXECUTION_GRANT, TEST_GRANTS } from '@mcpforge/adapter-function/testing';
import type { ToolManifest } from '@mcpforge/shared/manifest';
import { startMockJde, type MockJde, type MockJdeConfig } from './server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');

const CLERK = 'a.clerk@ltm.example';
const APPROVER = 'a.approver@ltm.example';
const STRANGER = 'nobody@ltm.example';
const CLIENT_ID = 'mcpforge-test-jde-fin-ap';
const CLIENT_SECRET = 'test-only-client-secret-not-a-real-one';
const CREDENTIAL_REF = { uri: 'secretRef://binding/jde-fin-ap/token-provider-client' };

function manifest(rel: string): ToolManifest {
  return parseYaml(readFileSync(join(REPO_ROOT, rel), 'utf8')) as ToolManifest;
}

function toolFixture(rel: string) {
  const m = manifest(rel);
  const descriptor = buildFunctionBindingDescriptor(m);
  const schema = JSON.parse(
    readFileSync(join(REPO_ROOT, 'generated', 'tools', m.id, 'schema.json'), 'utf8'),
  ) as object;
  return { manifest: m, descriptor, validate: compileGeneratedSchema(schema) };
}

const CREATE = toolFixture('manifests/jde/fin/ap/voucher.create.tool.yaml');
const GET = toolFixture('manifests/jde/fin/ap/voucher.get.tool.yaml');
const CREATE_ARGS = { supplier_number: '4242', amount: 18_400, currency: 'GBP', company: '00100' };
const GET_ARGS = { document_number: '70001', document_type: 'PV', document_company: '00100' };

/** A SecretStore stand-in with the gateway's shape: get(ref) -> a revealable value. */
function secretStore(value: string) {
  const reads: unknown[] = [];
  return {
    reads,
    store: {
      async get(ref: typeof CREDENTIAL_REF) {
        reads.push(ref);
        return { revealSecretValue: () => value };
      },
    },
  };
}

interface World {
  readonly jde: MockJde;
  readonly tokens: AisTokenProvider;
  readonly exec: ReturnType<typeof createFunctionExecutor>;
}

const open: MockJde[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()!.close();
});

async function world(
  overrides: Partial<MockJdeConfig> = {},
  opts: { secret?: string; now?: () => number } = {},
): Promise<World> {
  const jde = await startMockJde({
    users: [CLERK, APPROVER],
    clients: { [CLIENT_ID]: CLIENT_SECRET },
    ...overrides,
  });
  open.push(jde);
  const tokens = createHttpAisTokenProvider({
    tokenUrl: jde.tokenUrl,
    clientId: CLIENT_ID,
    clientCredential: {
      ref: CREDENTIAL_REF,
      secretStore: secretStore(opts.secret ?? CLIENT_SECRET).store,
    },
    ...(opts.now ? { now: opts.now } : {}),
  });
  const client = createHttpAisClient({ baseUrl: jde.baseUrl, tokens });
  return { jde, tokens, exec: createFunctionExecutor({ grants: TEST_GRANTS, client }) };
}

function run(
  w: World,
  tool: {
    descriptor: FunctionBindingDescriptor;
    validate: ReturnType<typeof compileGeneratedSchema>;
  },
  args: Record<string, unknown>,
  subject: string | undefined,
  correlationId = 'corr-p14',
) {
  return w.exec.execute(tool.descriptor, {
    executionGrant: TEST_EXECUTION_GRANT,
    args,
    correlationId,
    validate: tool.validate,
    ...(subject === undefined ? {} : { principalSubject: subject }),
  });
}

async function forgeCode(
  p: Promise<unknown>,
): Promise<{ code: string; next: string; message: string }> {
  try {
    await p;
  } catch (error) {
    const e = error as { name?: string; code?: string; next?: string; message?: string };
    const code = e.code !== undefined && e.next !== undefined ? e.code : 'NOT_A_FORGE_ERROR';
    return { code, next: e.next ?? '', message: e.message ?? '' };
  }
  throw new Error('expected the call to be refused');
}

describe('W0-P14 — a write runs AS the caller, over HTTP, and the echo proves it', () => {
  it('voucher.create: per-user token, mapped inputs only, pinned version, echo matched', async () => {
    const w = await world();
    const result = await run(w, CREATE, { ...CREATE_ARGS, confirm: null }, CLERK);

    expect(result.status).toBe(200);
    expect(result.identityEcho).toMatchObject({ required: true, match: true });
    expect(result.identityEcho.observed).toBe(CLERK.toUpperCase());
    const body = JSON.parse(result.body) as { voucher: { docType: string } };
    expect(body.voucher.docType).toBe('PV');

    const [tokenReq, orch] = w.jde.requests;
    expect(tokenReq).toMatchObject({
      kind: 'token',
      status: 200,
      clientId: CLIENT_ID,
      subject: CLERK,
    });
    expect(orch).toMatchObject({
      kind: 'orchestration',
      status: 200,
      orchestration: 'AP_VOUCHER_CREATE',
      orchestrationVersion: '1.4',
      correlationId: 'corr-p14',
      executedAs: CLERK.toUpperCase(),
    });
    // `confirm` is not a manifest input: dropped by the closed mapping, never sent.
    expect(orch!.inputs).toEqual(CREATE_ARGS);
  });

  it('tokens are cached per subject and never shared between subjects', async () => {
    const w = await world();
    await run(w, GET, GET_ARGS, CLERK, 'c1');
    await run(w, GET, GET_ARGS, CLERK, 'c2');
    await run(w, GET, GET_ARGS, APPROVER, 'c3');
    const tokenReqs = w.jde.requests.filter((r) => r.kind === 'token');
    expect(tokenReqs.map((r) => r.subject)).toEqual([CLERK, APPROVER]);
    expect(w.jde.ran().map((r) => r.executedAs)).toEqual([
      CLERK.toUpperCase(),
      CLERK.toUpperCase(),
      APPROVER.toUpperCase(),
    ]);
  });

  it('an expired token is refused by the target (401), dropped, and re-exchanged next call', async () => {
    let clock = 1_000_000;
    const w = await world({ now: () => clock, tokenTtlSeconds: 60 }, { now: () => 0 });
    await run(w, GET, GET_ARGS, CLERK, 'c1');
    clock += 61_000; // the target expires it; the gateway's clock still thinks it is fresh
    const refused = await forgeCode(run(w, GET, GET_ARGS, CLERK, 'c2'));
    expect(refused.code).toBe('IDENTITY_UNRESOLVED');
    await run(w, GET, GET_ARGS, CLERK, 'c3');
    expect(w.jde.requests.filter((r) => r.kind === 'token')).toHaveLength(2);
    expect(w.jde.ran()).toHaveLength(2);
  });
});

describe('W0-P14 — no identity, no call: there is no fallback (CLAUDE.md #1)', () => {
  it('no caller subject: refused before ANY request leaves the gateway', async () => {
    const w = await world();
    const r = await forgeCode(run(w, GET, GET_ARGS, undefined));
    expect(r.code).toBe('IDENTITY_UNRESOLVED');
    expect(r.next.length).toBeGreaterThan(0);
    expect(w.jde.requests).toEqual([]);
  });

  it('a subject the instance does not know: no token, the orchestration never runs', async () => {
    const w = await world();
    const r = await forgeCode(run(w, CREATE, CREATE_ARGS, STRANGER));
    expect(r.code).toBe('IDENTITY_UNRESOLVED');
    expect(r.next).toMatch(/operator/);
    expect(w.jde.requests.map((q) => [q.kind, q.status])).toEqual([['token', 404]]);
    expect(w.jde.ran()).toEqual([]);
  });

  it("the gateway's client credential is rejected: TARGET_UNAVAILABLE, nothing ran", async () => {
    const w = await world({}, { secret: 'wrong-secret' });
    const r = await forgeCode(run(w, CREATE, CREATE_ARGS, CLERK));
    expect(r.code).toBe('TARGET_UNAVAILABLE');
    expect(r.next).toMatch(/forge secrets status/);
    expect(w.jde.ran()).toEqual([]);
  });

  it('a misconfigured instance that runs as someone else is caught by the echo on a write', async () => {
    const w = await world({ forceExecutingUser: 'JDE_SVC' });
    const r = await forgeCode(run(w, CREATE, CREATE_ARGS, CLERK));
    expect(r.code).toBe('IDENTITY_UNRESOLVED');
    expect(w.jde.ran().map((q) => q.executedAs)).toEqual(['JDE_SVC']);
  });

  it('no execution grant: nothing reaches the mock JDE at all (the W0-P9 guarantee, over HTTP)', async () => {
    const w = await world();
    const r = await forgeCode(
      w.exec.execute(CREATE.descriptor, {
        args: CREATE_ARGS,
        correlationId: 'no-grant',
        validate: CREATE.validate,
        principalSubject: CLERK,
      }),
    );
    expect(r.code).not.toBe('NOT_A_FORGE_ERROR');
    expect(w.jde.requests).toEqual([]);
  });
});

describe('W0-P14 — target errors map as the in-process fake maps them', () => {
  it('a 409 with a message is TARGET_PRECONDITION_FAILED', async () => {
    const w = await world({
      orchestrations: {
        AP_VOUCHER_CREATE: () => ({ status: 409, body: { message: 'Supplier 4242 is on hold.' } }),
      },
    });
    const r = await forgeCode(run(w, CREATE, CREATE_ARGS, CLERK));
    expect(r.code).toBe('TARGET_PRECONDITION_FAILED');
    expect(r.message).toContain('Supplier 4242 is on hold.');
  });

  it('a 500 is TARGET_ERROR', async () => {
    const w = await world({
      orchestrations: { AP_VOUCHER_GET: () => ({ status: 500, body: { message: 'boom' } }) },
    });
    expect((await forgeCode(run(w, GET, GET_ARGS, CLERK))).code).toBe('TARGET_ERROR');
  });

  it('a slow orchestration is cut off by timeoutMs: TARGET_TIMEOUT, and a write is told not to retry', async () => {
    const w = await world({
      orchestrations: {
        AP_VOUCHER_CREATE: () =>
          new Promise((r) => setTimeout(() => r({ body: { status: 'CREATED' } }), 400)),
      },
    });
    const fast = {
      ...CREATE.descriptor,
      execution: { ...CREATE.descriptor.execution, timeoutMs: 100 },
    };
    const r = await forgeCode(run(w, { ...CREATE, descriptor: fast }, CREATE_ARGS, CLERK));
    expect(r.code).toBe('TARGET_TIMEOUT');
    expect(r.next).toMatch(/Do NOT re-issue/);
  });

  it('an unreachable target is TARGET_UNAVAILABLE', async () => {
    const w = await world();
    await w.jde.close();
    open.length = 0;
    expect((await forgeCode(run(w, GET, GET_ARGS, CLERK))).code).toBe('TARGET_UNAVAILABLE');
  });
});

describe('W0-P14 — the local overlay points every Wave 0 server at the mock', () => {
  it('overlays/local/ais-targets.yaml resolves a target, with its own credential, for each server', () => {
    const overlay = loadAisTargetsOverlay(join(REPO_ROOT, 'overlays', 'local', 'ais-targets.yaml'));
    const servers = new Set(
      [CREATE, GET].map((t) => t.manifest.server).concat(['jde-fin-gl', 'jde-scm-po']),
    );
    const refs = new Set<string>();
    for (const serverId of servers) {
      const t = aisTargetForServer(overlay, serverId);
      expect(t.baseUrl).toBe('http://127.0.0.1:4545/jderest');
      expect(t.clientCredentialRef).toBe(`secretRef://binding/${serverId}/token-provider-client`);
      refs.add(t.clientCredentialRef);
    }
    expect(refs.size).toBe(servers.size);
  });
});

describe('W0-P14 — the mock JDE runs as a standalone process', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcpforge-p14-'));
  const clientsFile = join(dir, 'clients.json');
  let child: ReturnType<typeof spawn> | undefined;
  let started: { baseUrl: string; tokenUrl: string; clientSecretsFile: string } | undefined;

  beforeAll(async () => {
    const script = join(HERE, '..', '..', 'scripts', 'mock-jde.ts');
    const tsx = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    child = spawn(process.execPath, [tsx, script, '--port', '0'], {
      env: { ...process.env, MCPFORGE_MOCK_JDE_CLIENTS_FILE: clientsFile },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    started = await new Promise((resolveStart, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`mock-jde did not start: ${out}`)), 30_000);
      child!.stdout!.on('data', (d: Buffer) => {
        out += d.toString();
        const line = out.split('\n').find((l) => l.startsWith('{'));
        if (line !== undefined) {
          clearTimeout(timer);
          resolveStart(JSON.parse(line));
        }
      });
      child!.on('exit', (code) => reject(new Error(`mock-jde exited ${code}: ${out}`)));
    });
  }, 40_000);

  afterAll(() => {
    child?.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  it('prints only the secrets FILE, and a real call runs as the caller through it', async () => {
    expect(started!.clientSecretsFile).toBe(clientsFile);
    const secrets = JSON.parse(readFileSync(clientsFile, 'utf8')) as Record<string, string>;
    expect(JSON.stringify(started)).not.toContain(secrets['mcpforge-local-jde-fin-ap']!);

    const tokens = createHttpAisTokenProvider({
      tokenUrl: started!.tokenUrl,
      clientId: 'mcpforge-local-jde-fin-ap',
      clientCredential: {
        ref: CREDENTIAL_REF,
        secretStore: secretStore(secrets['mcpforge-local-jde-fin-ap']!).store,
      },
    });
    const exec = createFunctionExecutor({
      grants: TEST_GRANTS,
      client: createHttpAisClient({ baseUrl: started!.baseUrl, tokens }),
    });
    const result = await exec.execute(CREATE.descriptor, {
      executionGrant: TEST_EXECUTION_GRANT,
      args: CREATE_ARGS,
      correlationId: 'standalone',
      validate: CREATE.validate,
      principalSubject: CLERK,
    });
    expect(result.identityEcho).toMatchObject({ match: true, observed: CLERK.toUpperCase() });
  });
});
