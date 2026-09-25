// MCPForge — W0-P16. The served surface, end to end over real Streamable HTTP.
//
// A real MCP SDK client, a real registered consumer (private-key JWT), a real
// human (local IdentityProvider bearer), the real session assembly (W0-P15),
// the real runtime catalogue (W0-P13) and the surface under test. The policy
// runtime is the real stage 6d (compiled Ajv), 6f (guardrail evaluator), 6g
// (confirm gate + approval queue) and 6h (idempotency over a real SQLite
// store). Only 6c's rate limiter is a pass-through here: its overlay-driven
// `CapsRuntime` is launch wiring (W0-P11). Nothing executes: `proceed` goes to
// a recording `execute` handler, which is W0-P17's seam.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildResidentDefinition } from '@mcpforge/codegen/templates';
import { countJsonTokens } from '@mcpforge/shared';
import { openRuntimeStore } from '../store/store.js';
import type { RuntimeStore } from '../store/repository.js';
import { inMemoryRuntimeFlags } from '../scope/index.js';
import { approvalGate } from '../policy/approval/index.js';
import {
  confirmWriteGate,
  generateConfirmSigningKey,
  guardrailEvaluator,
  idempotencyGate,
  singleKeyKeyring,
  type PolicyRuntime,
} from '../policy/index.js';
import { META_TOOL_DEFINITIONS, META_TOOL_IDS } from '../meta/index.js';
import { MCPFORGE_CONSUMER_ASSERTION_HEADER } from '../transport/index.js';
import { STUB_TOOL_ID } from '../transport/stub.test-support.js';
import {
  CLERK,
  NO_ROLE_USER,
  REPO_ROOT,
  removeRepo,
  sessionRepo,
  startSessionWorld,
  type SessionWorld,
} from './session.test-support.js';
import { createServedSurface, type ProceedInput, type ServedSurface } from './surface.js';

const CREATE = 'jde.ap.voucher.create';
const GET = 'jde.ap.voucher.get';
const CREATE_ARGS = { supplier_number: '4242', amount: 18_400, currency: 'GBP', company: '00100' };
const JOURNAL = 'jde.fin.journal.create';
const JOURNAL_ARGS = {
  company: '00001',
  document_type: 'JE',
  gl_date: '2026-09-25',
  account_number: '1.1110',
  amount: 1_200,
  currency: 'GBP',
};
const GET_ARGS = { document_number: '9001', document_type: 'PV', document_company: '00100' };

interface Parsed {
  readonly isError: boolean;
  readonly body: Record<string, unknown>;
}

/**
 * The session repo, plus the discovery artefacts the surface reads. With
 * `grantRealRefs`, the p2p role's `function` grant names the binding refs the
 * p2p tools actually declare. TEST WORLD ONLY: the committed grant names
 * AP_VOUCHER, GL_JOURNAL and PO_ORCHESTRATION, which match no manifest's
 * `binding.ref` (grants match by exact ref), so against the committed
 * artefacts no p2p tool is callable. That is an owner decision, flagged in
 * this task's report and exercised as-is by the second suite below.
 */
function surfaceRepo(grantRealRefs: boolean, refs: readonly string[]): string {
  const root = sessionRepo([{ consumerId: 'test-agent', writeAllowed: true }]);
  for (const rel of ['generated/index', 'generated/cards']) {
    cpSync(join(REPO_ROOT, rel), join(root, rel), { recursive: true });
  }
  if (grantRealRefs) {
    const file = join(root, 'generated', 'roles', 'p2p.scope.json');
    const role = JSON.parse(readFileSync(file, 'utf8')) as {
      bindingGrants: Array<{ names: string[] }>;
    };
    role.bindingGrants[0]!.names = [...refs];
    writeFileSync(file, JSON.stringify(role));
  }
  return root;
}

function parse(result: unknown): Parsed {
  const r = result as { isError?: boolean; content: Array<{ type: string; text: string }> };
  const text = r.content[0]?.text ?? '{}';
  return { isError: r.isError === true, body: JSON.parse(text) as Record<string, unknown> };
}

describe('W0-P16 — the served surface over /mcp', () => {
  const storeDir = mkdtempSync(join(tmpdir(), 'mcpforge-p16-'));
  let store: RuntimeStore;
  let repo: string;
  let world: SessionWorld;
  let surface: ServedSurface;
  const executed: ProceedInput[] = [];
  const flags = inMemoryRuntimeFlags();
  const clients: Client[] = [];

  beforeAll(async () => {
    store = await openRuntimeStore({ kind: 'sqlite', file: join(storeDir, 'runtime.db') });
    repo = surfaceRepo(true, await p2pFunctionRefs());
    // The world's catalogue is loaded inside `startSessionWorld`; the surface
    // needs it before the transport starts, so the world is built with a
    // factory that defers to the surface built right after it.
    const ref: { surface?: ServedSurface } = {};
    world = await startSessionWorld({
      repoRoot: repo,
      registered: ['test-agent'],
      flags,
      createServer: (handle) => {
        if (ref.surface === undefined) throw new Error('surface not built');
        return ref.surface.createServer(handle);
      },
    });
    const keyring = singleKeyKeyring(generateConfirmSigningKey('kid-p16'));
    const runtime: PolicyRuntime = {
      rateLimiter: { check: () => ({ allowed: true }) },
      argumentValidator: world.catalogue.argumentValidator,
      guardrails: guardrailEvaluator({}),
      writeGate: confirmWriteGate({
        writeSafetyFor: (id) => world.catalogue.writeSafetyFor(id),
        dryRun: { plan: () => ({ warnings: [], planValues: {} }) },
        keyring,
        approval: approvalGate({ queue: store.approvals, keyring }),
      }),
      idempotency: idempotencyGate({ store }),
    };
    ref.surface = createServedSurface({
      repoRoot: repo,
      catalogue: world.catalogue,
      runtime,
      execute: (input) => {
        executed.push(input);
        return Promise.resolve({
          content: [{ type: 'text', text: JSON.stringify({ executed: input.call.toolId }) }],
        });
      },
    });
    surface = ref.surface;
  });

  afterEach(async () => {
    flags.set([]);
    executed.length = 0;
    await Promise.all(clients.splice(0).map((c) => c.close()));
  });

  afterAll(async () => {
    await world.close();
    await store.close();
    removeRepo(repo);
    rmSync(storeDir, { recursive: true, force: true });
  });

  async function connect(subject: string): Promise<{ client: Client; listChanged: () => number }> {
    const token = await world.tokenFor(subject);
    const assertion = await world.assertion('test-agent');
    const client = new Client({ name: 'w0-p16', version: '0.0.0' });
    let changes = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      changes += 1;
    });
    const transport = new StreamableHTTPClientTransport(new URL(world.url), {
      requestInit: {
        headers: {
          [MCPFORGE_CONSUMER_ASSERTION_HEADER]: assertion,
          authorization: `Bearer ${token}`,
        },
      },
    });
    await client.connect(transport as unknown as Transport);
    clients.push(client);
    return { client, listChanged: () => changes };
  }

  async function eventually(check: () => boolean): Promise<void> {
    for (let i = 0; i < 50 && !check(); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(check()).toBe(true);
  }

  it('tools/list: the four meta-tools (≤440 tokens) plus the p2p core set (≤1,300), no stub', async () => {
    const { client } = await connect(CLERK.subject);
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);

    expect(names.slice(0, 4)).toEqual([...META_TOOL_IDS]);
    expect(names).not.toContain(STUB_TOOL_ID);

    const p2p = JSON.parse(
      readFileSync(join(REPO_ROOT, 'generated', 'roles', 'p2p.scope.json'), 'utf8'),
    ) as { coreTools: string[] };
    expect(names.slice(4).sort()).toEqual([...p2p.coreTools].sort());

    // Served verbatim: the resident definitions ARE codegen's builder output.
    for (const tool of list.tools.slice(4)) {
      const view = world.catalogue.tools.get(tool.name)?.view;
      expect(view).toBeDefined();
      expect({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }).toEqual(buildResidentDefinition(view!));
    }
    expect(countJsonTokens(META_TOOL_DEFINITIONS)).toBeLessThanOrEqual(440);
    expect(countJsonTokens(list.tools.slice(4))).toBeLessThanOrEqual(1300);
  });

  it('a human with no role gets the four meta-tools only (02 §5.7 Case B)', async () => {
    const { client } = await connect(NO_ROLE_USER.subject);
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toEqual([...META_TOOL_IDS]);
  });

  it('forge.find ranks the real index and returns cards with an access field', async () => {
    const { client } = await connect(CLERK.subject);
    const found = parse(
      await client.callTool({
        name: 'forge.find',
        arguments: { query: 'create an AP voucher', module: 'ap' },
      }),
    );
    expect(found.isError).toBe(false);
    expect(found.body['result']).toBe('tools');
    const tools = found.body['tools'] as Array<{ card: { id: string }; access: string }>;
    expect(tools.map((t) => t.card.id)).toContain(CREATE);
    expect(tools.every((t) => t.access === 'available')).toBe(true);
  });

  it('forge.describe returns the full description; an out-of-scope id is a tool error with next', async () => {
    const { client } = await connect(CLERK.subject);
    const described = parse(
      await client.callTool({ name: 'forge.describe', arguments: { toolIds: [CREATE] } }),
    );
    expect(described.isError).toBe(false);
    const tools = described.body['tools'] as Array<{ id: string; detail: Record<string, unknown> }>;
    expect(tools[0]?.id).toBe(CREATE);
    expect(tools[0]?.detail['writeSafety']).toBeDefined();

    const refused = parse(
      await client.callTool({ name: 'forge.describe', arguments: { toolIds: ['jde.hr.x.get'] } }),
    );
    expect(refused.isError).toBe(true);
    expect(refused.body['code']).toBe('TOOL_NOT_IN_SCOPE');
    expect(String(refused.body['next']).length).toBeGreaterThan(0);
  });

  it('forge.activate narrows tools/list and emits list_changed', async () => {
    const { client, listChanged } = await connect(CLERK.subject);
    const activated = parse(
      await client.callTool({ name: 'forge.activate', arguments: { toolIds: [GET] } }),
    );
    expect(activated.isError).toBe(false);
    expect(activated.body['toolIds']).toEqual([GET]);
    await eventually(() => listChanged() >= 1);

    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toEqual([...META_TOOL_IDS, GET]);
  });

  it('a meta-tool called with a wrongly typed argument is INPUT_INVALID naming the field', async () => {
    const { client } = await connect(CLERK.subject);
    const refused = parse(
      await client.callTool({ name: 'forge.find', arguments: { limit: 'many' } }),
    );
    expect(refused.isError).toBe(true);
    expect(refused.body['code']).toBe('INPUT_INVALID');
    expect(String(refused.body['next'])).toMatch(/limit/);
  });

  it('a write through tools/call and through forge.invoke is RESPONDED with a plan, as a tool result', async () => {
    // jde.fin.journal.create: a p2p write off the voucher/PO chain, so the real
    // 6f SoD guardrail (p2p also grants purchase_order.approve) does not apply.
    const { client } = await connect(CLERK.subject);
    const direct = parse(await client.callTool({ name: JOURNAL, arguments: JOURNAL_ARGS }));
    const invoked = parse(
      await client.callTool({
        name: 'forge.invoke',
        arguments: { toolId: JOURNAL, arguments: JOURNAL_ARGS },
      }),
    );
    for (const plan of [direct, invoked]) {
      expect(plan.isError).toBe(false);
      expect(typeof plan.body['confirmToken']).toBe('string');
    }
    // The same plan, apart from the per-plan token.
    expect(Object.keys(direct.body).sort()).toEqual(Object.keys(invoked.body).sort());
    expect(direct.body['plan']).toEqual(invoked.body['plan']);
    expect(executed).toEqual([]);
  });

  it('the real 6f SoD guardrail refuses voucher.create for a p2p holder, as a tool error with next', async () => {
    const { client } = await connect(CLERK.subject);
    const refused = parse(await client.callTool({ name: CREATE, arguments: CREATE_ARGS }));
    expect(refused.isError).toBe(true);
    expect(refused.body['code']).toBe('POLICY_GUARDRAIL_BREACH');
    expect(String(refused.body['next'])).toMatch(/purchase_order\.approve/);
    expect(executed).toEqual([]);
  });

  it('invalid arguments are REFUSED identically through both entry points, with the closed code and next', async () => {
    const { client } = await connect(CLERK.subject);
    const bad = { ...CREATE_ARGS, amount: 'lots' };
    const direct = parse(await client.callTool({ name: CREATE, arguments: bad }));
    const invoked = parse(
      await client.callTool({
        name: 'forge.invoke',
        arguments: { toolId: CREATE, arguments: bad },
      }),
    );
    for (const r of [direct, invoked]) {
      expect(r.isError).toBe(true);
      expect(r.body['code']).toBe('INPUT_INVALID');
      expect(String(r.body['next']).length).toBeGreaterThan(0);
    }
    const withoutCorrelation = (body: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'correlationId'));
    expect(withoutCorrelation(direct.body)).toEqual(withoutCorrelation(invoked.body));
  });

  it('an admitted read reaches the execute seam with the real policy context; nothing else does', async () => {
    const { client } = await connect(CLERK.subject);
    const result = parse(await client.callTool({ name: GET, arguments: GET_ARGS }));
    expect(result).toEqual({ isError: false, body: { executed: GET } });
    expect(executed).toHaveLength(1);
    const input = executed[0]!;
    expect(input.decision.outcome).toBe('proceed');
    expect(input.call.entryPoint).toBe('tools/call');
    expect(input.policy.scope.session.principal.subject).toBe(CLERK.subject);
    expect(input.policy.scope.session.consumer.consumerId).toBe('test-agent');
    expect(input.decision.stagesRun).toHaveLength(10);
  });

  it('an unknown tool id is refused at 6a through tools/call', async () => {
    const { client } = await connect(CLERK.subject);
    const refused = parse(await client.callTool({ name: 'jde.hr.employee.get', arguments: {} }));
    expect(refused.isError).toBe(true);
    expect(refused.body['code']).toBe('TOOL_NOT_IN_SCOPE');
    expect(executed).toEqual([]);
  });

  it('a kill switch emits list_changed to the live session, leaves tools/list and refuses the call', async () => {
    const { client, listChanged } = await connect(CLERK.subject);
    const watcher = surface.watchFlags(flags);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain(CREATE);

    flags.set([{ scope: 'tool', target: CREATE, reason: 'W0-P16 test kill' }]);
    expect(await watcher.checkAndNotify()).toBe(true);
    await eventually(() => listChanged() >= 1);

    expect((await client.listTools()).tools.map((t) => t.name)).not.toContain(CREATE);
    const refused = parse(await client.callTool({ name: CREATE, arguments: CREATE_ARGS }));
    expect(refused.isError).toBe(true);
    expect(refused.body['code']).toBe('TOOL_DISABLED');
  });
});

/** The `binding.ref` of every `function` tool the committed p2p role grants. */
async function p2pFunctionRefs(): Promise<readonly string[]> {
  const { loadRuntimeCatalogue } = await import('./catalogue.js');
  const catalogue = await loadRuntimeCatalogue({ repoRoot: REPO_ROOT });
  const p2p = JSON.parse(
    readFileSync(join(REPO_ROOT, 'generated', 'roles', 'p2p.scope.json'), 'utf8'),
  ) as { toolIds: string[] };
  return p2p.toolIds
    .map((id) => catalogue.entryFor(id))
    .filter((e) => e !== undefined && e.bindingType === 'function')
    .map((e) => e!.bindingRef);
}

describe('W0-P16 — the COMMITTED p2p grant, served as-is', () => {
  let repo: string;
  let world: SessionWorld;

  beforeAll(async () => {
    repo = surfaceRepo(false, []);
    const ref: { surface?: ServedSurface } = {};
    world = await startSessionWorld({
      repoRoot: repo,
      registered: ['test-agent'],
      createServer: (handle) => ref.surface!.createServer(handle),
    });
    ref.surface = createServedSurface({
      repoRoot: repo,
      catalogue: world.catalogue,
      runtime: {
        rateLimiter: { check: () => ({ allowed: true }) },
        argumentValidator: world.catalogue.argumentValidator,
        guardrails: guardrailEvaluator({}),
        writeGate: { evaluate: () => ({ kind: 'not-a-write' }) },
        idempotency: { lookup: () => ({ kind: 'proceed' }) },
      },
      execute: () => Promise.reject(new Error('nothing may execute in this world')),
    });
  });

  afterAll(async () => {
    await world.close();
    removeRepo(repo);
  });

  it('no p2p tool is listed; forge.find still finds them as requires_grant, and a call refuses at 6e′', async () => {
    const token = await world.tokenFor(CLERK.subject);
    const client = new Client({ name: 'w0-p16-committed', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(world.url), {
        requestInit: {
          headers: {
            [MCPFORGE_CONSUMER_ASSERTION_HEADER]: await world.assertion('test-agent'),
            authorization: `Bearer ${token}`,
          },
        },
      }) as unknown as Transport,
    );
    try {
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual([...META_TOOL_IDS]);

      const found = parse(
        await client.callTool({ name: 'forge.find', arguments: { query: 'create a voucher' } }),
      );
      const tools = found.body['tools'] as Array<{ access: string; agentMessage?: string }>;
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.every((t) => t.access === 'requires_grant')).toBe(true);
      expect(tools[0]?.agentMessage).toMatch(/bindingGrant/);

      const refused = parse(await client.callTool({ name: GET, arguments: GET_ARGS }));
      expect(refused.isError).toBe(true);
      expect(refused.body['code']).toBe('ELEVATED_GRANT_REQUIRED');
    } finally {
      await client.close();
    }
  });
});
