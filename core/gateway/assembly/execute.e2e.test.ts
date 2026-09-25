// MCPForge — W0-P17. proceed -> dispatcher -> executor -> result -> audit row,
// end to end over real Streamable HTTP.
//
// Real: SDK client, consumer JWT, local bearer, session assembly, runtime
// catalogue, served surface, policy chain with 6d/6f/6g/6h and the execution
// grant keyring, the `function` executor with the real grant check, the write
// and read dispatchers, the SQLite store and its hash-chained audit table. The
// target is a scripted `AisClient` that answers like a composed JDE
// orchestration (business document + the identity echo step). 6c is a
// pass-through here; the overlay-driven `CapsRuntime` is launch wiring (W0-P11).

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  createAlwaysSampler,
  createFunctionExecutor,
  validatePairRegistry,
  type AisClient,
  type AisRequest,
} from '@mcpforge/adapter-function';
import { HARD_CEILINGS } from '../caps/index.js';
import { openRuntimeStore } from '../store/store.js';
import type { RuntimeStore } from '../store/repository.js';
import { approvalGate } from '../policy/approval/index.js';
import {
  confirmWriteGate,
  executionGrantCheck,
  functionDryRunner,
  generateConfirmSigningKey,
  guardrailEvaluator,
  idempotencyGate,
  redactArgsForAudit,
  singleKeyKeyring,
  type PolicyRuntime,
} from '../policy/index.js';
import { MCPFORGE_CONSUMER_ASSERTION_HEADER } from '../transport/index.js';
import { CLERK, removeRepo, startSessionWorld, type SessionWorld } from './session.test-support.js';
import { p2pFunctionRefs, surfaceRepo } from './surface.test-support.js';
import { createServedSurface, type ServedSurface } from './surface.js';
import { createCallExecution } from './execute.js';

const JOURNAL = 'jde.fin.journal.create';
const GET = 'jde.ap.voucher.get';
const SEARCH = 'jde.ap.voucher.search';
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

function parse(result: unknown): Parsed {
  const r = result as { isError?: boolean; content: Array<{ text: string }> };
  return {
    isError: r.isError === true,
    body: JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>,
  };
}

/** A composed orchestration: the business document plus the identity echo step. */
function scriptedTarget(): AisClient & { calls: AisRequest[]; searchRows: number } {
  const calls: AisRequest[] = [];
  let doc = 5000;
  const target = {
    calls,
    searchRows: 2,
    call(request: AisRequest) {
      calls.push(request);
      const echo = { MCPFORGE_EXECUTING_USER: request.principalSubject ?? '' };
      let body: Record<string, unknown>;
      switch (request.orchestration) {
        case 'GL_JE_CREATE':
          doc += 1;
          body = {
            ...echo,
            journal: { batchNumber: '77', docNumber: String(doc), docType: 'JE', docCo: '00001' },
          };
          break;
        case 'GL_JE_CREATE_VALIDATE':
          body = { ...echo, journal: { valid: true } };
          break;
        case 'AP_VOUCHER_GET':
          body = { ...echo, voucher: { docNumber: '9001', docType: 'PV', payStatus: 'A' } };
          break;
        default:
          body = {
            ...echo,
            vouchers: Array.from({ length: target.searchRows }, (_, i) => ({
              docNumber: String(9000 + i),
              docType: 'PV',
            })),
          };
      }
      return Promise.resolve({ status: 200, body: JSON.stringify(body) });
    },
  };
  return target;
}

describe('W0-P17 — execute, shape and audit over /mcp', () => {
  const storeDir = mkdtempSync(join(tmpdir(), 'mcpforge-p17-'));
  let store: RuntimeStore;
  let repo: string;
  let world: SessionWorld;
  let client: Client;
  const target = scriptedTarget();
  /** Probe evidence for `_VALIDATE` siblings; mutated per test. */
  const validatePairs = new Map<string, boolean>();

  beforeAll(async () => {
    store = await openRuntimeStore({ kind: 'sqlite', file: join(storeDir, 'runtime.db') });
    repo = surfaceRepo(true, await p2pFunctionRefs());
    const ref: { surface?: ServedSurface } = {};
    world = await startSessionWorld({
      repoRoot: repo,
      registered: ['test-agent'],
      createServer: (handle) => ref.surface!.createServer(handle),
    });

    const confirmKeyring = singleKeyKeyring(generateConfirmSigningKey('kid-confirm-p17'));
    const grantKeyring = singleKeyKeyring(generateConfirmSigningKey('kid-grant-p17'));
    const executor = createFunctionExecutor({
      client: target,
      grants: executionGrantCheck(grantKeyring),
      echoSampler: createAlwaysSampler(),
    });
    const catalogue = world.catalogue;
    const runtime: PolicyRuntime = {
      rateLimiter: { check: () => ({ allowed: true }) },
      argumentValidator: catalogue.argumentValidator,
      guardrails: guardrailEvaluator({}),
      writeGate: confirmWriteGate({
        writeSafetyFor: (id) => catalogue.writeSafetyFor(id),
        dryRun: functionDryRunner({
          executor,
          keyring: grantKeyring,
          descriptorFor: (id) => catalogue.dryRunDescriptorFor(id),
          validatorFor: (id) => catalogue.schemaValidatorFor(id),
          registry: validatePairRegistry(validatePairs),
        }),
        keyring: confirmKeyring,
        approval: approvalGate({ queue: store.approvals, keyring: confirmKeyring }),
      }),
      idempotency: idempotencyGate({ store }),
      executionGrantKeyring: grantKeyring,
    };
    const calls = createCallExecution({
      store,
      catalogue,
      executor,
      caps: { ...HARD_CEILINGS, rowCap: 1 },
    });
    ref.surface = createServedSurface({
      repoRoot: repo,
      catalogue,
      runtime,
      execute: calls.execute,
      record: calls.record,
    });

    client = new Client({ name: 'w0-p17', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(world.url), {
        requestInit: {
          headers: {
            [MCPFORGE_CONSUMER_ASSERTION_HEADER]: await world.assertion('test-agent'),
            authorization: `Bearer ${await world.tokenFor(CLERK.subject)}`,
          },
        },
      }) as unknown as Transport,
    );
  });

  afterEach(() => {
    validatePairs.clear();
    target.calls.length = 0;
  });

  afterAll(async () => {
    await client.close();
    await world.close();
    await store.close();
    removeRepo(repo);
    rmSync(storeDir, { recursive: true, force: true });
  });

  async function lastRow() {
    const rows = await store.audit.listChain('local');
    return rows.at(-1)!;
  }

  it('a read executes through the grant-checked executor and leaves one audited row', async () => {
    const result = parse(await client.callTool({ name: GET, arguments: GET_ARGS }));
    expect(result.isError).toBe(false);
    expect((result.body['voucher'] as { docNumber: string }).docNumber).toBe('9001');
    expect(target.calls.map((c) => c.orchestration)).toEqual(['AP_VOUCHER_GET']);
    expect(target.calls[0]?.principalSubject).toBe(CLERK.subject);

    const row = await lastRow();
    expect(row).toMatchObject({
      toolId: GET,
      phase: 'execute',
      outcome: 'ok',
      isWrite: false,
      callerSubject: CLERK.subject,
      consumerId: 'test-agent',
      bytesOut: expect.any(Number),
    });
    expect(row.resultKeys).toContainEqual({ keyName: 'document_number', keyValue: '9001' });
  });

  it('a read over the row cap is refused ROW_CAP_EXCEEDED naming narrowing inputs, and audited as denied', async () => {
    const refused = parse(
      await client.callTool({ name: SEARCH, arguments: { supplier_number: '4242' } }),
    );
    expect(refused.isError).toBe(true);
    expect(refused.body['code']).toBe('ROW_CAP_EXCEEDED');
    expect(String(refused.body['next'])).toMatch(/gl_date_from/);
    expect(await lastRow()).toMatchObject({
      toolId: SEARCH,
      outcome: 'policy_denied',
      deniedByRule: 'row-cap',
      errorCode: 'ROW_CAP_EXCEEDED',
    });
  });

  it('with no probe evidence, a financial validate-pair write degrades and FORCES approval (02 §3.5)', async () => {
    const plan = parse(await client.callTool({ name: JOURNAL, arguments: JOURNAL_ARGS }));
    expect(plan.isError).toBe(false);
    expect(plan.body['status']).toBe('awaiting_human_approval');
    expect(plan.body['confirmToken']).toBeUndefined();
    expect((plan.body['warnings'] as string[]).join(' ')).toMatch(/degrades/);
    expect(target.calls).toEqual([]);
    expect(await lastRow()).toMatchObject({ toolId: JOURNAL, phase: 'plan', isWrite: true });
  });

  it('plan (dry-run grant) -> confirm -> execute once -> replay: every step audited, chain intact', async () => {
    validatePairs.set('GL_JE_CREATE_VALIDATE', true);

    const plan = parse(await client.callTool({ name: JOURNAL, arguments: JOURNAL_ARGS }));
    expect(plan.body['status']).toBe('confirm_required');
    // The dry run dispatched the SIBLING, under a dry-run grant the executor accepted.
    expect(target.calls.map((c) => c.orchestration)).toEqual(['GL_JE_CREATE_VALIDATE']);
    expect(await lastRow()).toMatchObject({ phase: 'plan', outcome: 'ok' });

    const confirm = String(plan.body['confirmToken']);
    const executed = parse(
      await client.callTool({ name: JOURNAL, arguments: { ...JOURNAL_ARGS, confirm } }),
    );
    expect(executed.isError).toBe(false);
    const docNumber = (executed.body['journal'] as { docNumber: string }).docNumber;
    const execRow = await lastRow();
    expect(execRow).toMatchObject({
      toolId: JOURNAL,
      phase: 'execute',
      outcome: 'ok',
      isWrite: true,
      replayed: false,
      callerSubject: CLERK.subject,
      consumerId: 'test-agent',
    });
    expect(execRow.resultKeys).toContainEqual({ keyName: 'document_number', keyValue: docNumber });
    expect(execRow.confirmTokenHash).not.toContain(confirm);

    const replay = parse(
      await client.callTool({ name: JOURNAL, arguments: { ...JOURNAL_ARGS, confirm } }),
    );
    expect(replay.isError).toBe(false);
    expect(replay.body['replayed']).toBe(true);
    expect(await lastRow()).toMatchObject({ phase: 'execute', replayed: true });

    // One validate, one execute: the replay never reached the target.
    expect(target.calls.map((c) => c.orchestration)).toEqual([
      'GL_JE_CREATE_VALIDATE',
      'GL_JE_CREATE',
    ]);
  });

  it('a chain refusal is audited as reject / policy_denied with the refusing stage', async () => {
    const refused = parse(
      await client.callTool({ name: JOURNAL, arguments: { ...JOURNAL_ARGS, amount: 'lots' } }),
    );
    expect(refused.body['code']).toBe('INPUT_INVALID');
    expect(await lastRow()).toMatchObject({
      toolId: JOURNAL,
      phase: 'reject',
      outcome: 'policy_denied',
      deniedByRule: 'stage 6d',
      errorCode: 'INPUT_INVALID',
      consumerId: 'test-agent',
      callerSubject: CLERK.subject,
    });
  });

  it('every call above left a row, and the hash chain verifies (forge audit verify)', async () => {
    const rows = await store.audit.listChain('local');
    // read · row-cap refusal · degraded plan · plan · execute · replay · refusal
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.consumerId === 'test-agent')).toBe(true);
    const verification = await store.audit.verifyChain('local');
    expect(verification.status).toBe('intact');
  });
});

describe('W0-P17 — audit redaction by sensitivity (owner rule, 25 Sep 2026)', () => {
  it('a personal tool records sha256[:12] per value; every other class records verbatim', () => {
    const args = { employee_id: 'E123', note: 'x' };
    const redacted = redactArgsForAudit(args, 'personal');
    expect(Object.keys(redacted)).toEqual(['employee_id', 'note']);
    for (const v of Object.values(redacted)) expect(v).toMatch(/^[0-9a-f]{12}$/);
    expect(redactArgsForAudit(args, 'financial')).toEqual(args);
  });
});
