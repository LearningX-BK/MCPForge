// MCPForge — W0-H3, the half of its done criterion that lives in the audit row:
// "a mismatch ... is written to `target_identity_observed` / `identity_match`
// in the audit row" (02 §3.5's "Audit shape").
//
// It sits here rather than in `adapters/function` for a dependency reason:
// `core/gateway` depends on `@mcpforge/adapter-function`, and the reverse edge
// would be a cycle. Same arrangement as `core/gateway/errors/enumeration.test.ts`,
// which drives the same real executor against the same in-process AIS fake.
//
// Both columns already existed from W0-C2 (`schema/spec.ts`, this directory's
// `types.ts` and `repository.ts`), so W0-H3 makes NO schema change and no
// migration was regenerated. This file is the evidence that the runtime echo
// and those columns actually meet.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FunctionIdentityEchoError,
  buildFunctionBindingDescriptor,
  compileGeneratedSchema,
  createFunctionExecutor,
} from '@mcpforge/adapter-function';
import { createMockAisServer } from '@mcpforge/adapter-function/testing';
import type { ToolManifest } from '@mcpforge/shared/manifest';
import { openRuntimeStore } from '../store.js';
import type { RuntimeStore } from '../repository.js';
import type { AppendAuditCallInput } from './types.js';

const tempDir = mkdtempSync(join(tmpdir(), 'mcpforge-echo-audit-'));
let store: RuntimeStore;

beforeAll(async () => {
  store = await openRuntimeStore({ kind: 'sqlite', file: join(tempDir, 'runtime.db') });
});

afterAll(async () => {
  await store?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

const CALLER = 'bikash';

/** A `function` write tool with 02 §3.5's mandatory `echoOn: write`. */
const manifest = {
  apiVersion: 'mcpforge/v1',
  kind: 'Tool',
  id: 'jde.ap.voucher.create',
  version: '1.0.0',
  server: 'jde-ap',
  title: 'Create AP voucher',
  purpose: 'Create an AP voucher matched to a purchase order',
  archetype: 'transactional',
  verb: 'create',
  entity: 'voucher',
  app: 'jde',
  module: 'ap',
  functionalArea: 'Accounts Payable',
  sensitivity: 'financial',
  write: true,
  binding: {
    type: 'function',
    technology: 'JDE AIS Orchestration',
    ref: 'MCPFORGE_AP_VOUCHER_CREATE_EXECUTE',
    refVersion: '3',
    identity: {
      carries: 'unverified',
      probe: 'MCPFORGE_PROBE_WHOAMI',
      // eslint-disable-next-line mcpforge/no-service-account-fallback -- spec-fixed manifest field name (02 §2.2); `block` is DETECTION, never substitution.
      onServiceAccount: 'block',
      echoOn: 'write',
    },
    execution: { timeoutMs: 2000, maxConcurrency: 4, responseBytesMax: 4096 },
    credentialClass: 'per-user-exchanged',
  },
  input: [
    { name: 'supplier', type: 'string', required: true, desc: 'Supplier address book number' },
    { name: 'amount', type: 'number', required: true, desc: 'Gross voucher amount' },
  ],
  output: {
    summaryTemplate: 'Created voucher {documentNumber} for {supplier}.',
    resultKeys: [{ name: 'documentNumber', path: '$.voucher.docNumber' }],
  },
  governance: { reviewPath: 'standard', owner: 'Finance Systems', steward: 'A. Steward' },
  eval: { intentsFile: 'evals/jde-ap.yaml', minIntents: 5 },
} as unknown as ToolManifest;

const descriptor = buildFunctionBindingDescriptor(manifest);
const validate = compileGeneratedSchema({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['supplier', 'amount'],
  properties: { supplier: { type: 'string' }, amount: { type: 'number' } },
});
const args = { supplier: '4242', amount: 18400 };

function base(overrides: Partial<AppendAuditCallInput>): AppendAuditCallInput {
  return {
    callerSubject: CALLER,
    consumerId: 'portal-local',
    humanInTheLoop: true,
    toolId: descriptor.toolId,
    toolVersion: descriptor.toolVersion,
    bindingType: 'function',
    isWrite: true,
    targetSystem: 'jde',
    targetEnv: 'py920',
    deploymentId: 'local',
    phase: 'execute',
    outcome: 'ok',
    ...overrides,
  } as AppendAuditCallInput;
}

describe('the runtime identity echo reaches the real audit row (02 §3.5, W0-H3)', () => {
  it('a match is recorded as a success with the observed identity and identity_match true', async () => {
    const client = createMockAisServer({
      executesAs: 'BIKASH',
      echoStep: 'MCPFORGE_PROBE_WHOAMI',
    });
    const exec = createFunctionExecutor({ client });

    const result = await exec.execute(descriptor, {
      args,
      correlationId: 'audit-echo-ok',
      validate,
      principalSubject: CALLER,
    });
    expect(result.identityEcho.match).toBe(true);

    const row = await store.audit.append(
      base({
        correlationId: 'audit-echo-ok',
        outcome: 'ok',
        identityCarrying: true,
        targetIdentityObserved: result.identityEcho.observed ?? '',
        identityMatch: result.identityEcho.match ?? false,
      }),
    );

    const read = await store.audit.get(row.id);
    expect(read?.outcome).toBe('ok');
    expect(read?.targetIdentityObserved).toBe('BIKASH');
    expect(read?.identityMatch).toBe(true);
    // `Principal.subject` is the only identity value written as the caller.
    expect(read?.callerSubject).toBe(CALLER);
  });

  it('a mismatch is a failure row: identity_match false, observed populated, outcome never ok', async () => {
    const client = createMockAisServer({
      executesAs: 'JDE_SVC',
      echoStep: 'MCPFORGE_PROBE_WHOAMI',
      body: JSON.stringify({
        voucher: { docNumber: '77123' },
        MCPFORGE_PROBE_WHOAMI: { MCPFORGE_EXECUTING_USER: 'JDE_SVC' },
      }),
    });
    const exec = createFunctionExecutor({ client });

    let succeeded = false;
    let caught: unknown;
    try {
      await exec.execute(descriptor, {
        args,
        correlationId: 'audit-echo-bad',
        validate,
        principalSubject: CALLER,
      });
      succeeded = true;
    } catch (err) {
      caught = err;
    }

    // The safety property: the executor NEVER hands back a result for a call
    // the target ran as someone else, so nothing downstream can record the
    // business record as successfully completed — even though the target did
    // return a document number.
    expect(succeeded).toBe(false);
    expect(caught).toBeInstanceOf(FunctionIdentityEchoError);
    const echo = caught as FunctionIdentityEchoError;

    const row = await store.audit.append(
      base({
        correlationId: 'audit-echo-bad',
        // `binding_error` is the taxonomy's outcome for a failure raised while
        // executing the binding — the mismatch is detected on the response,
        // after dispatch. It is emphatically not `ok`.
        outcome: 'binding_error',
        errorCode: echo.code,
        errorMessageAgent: echo.next,
        identityCarrying: false,
        targetIdentityObserved: echo.targetIdentityObserved ?? '',
        identityMatch: echo.identityMatch,
      }),
    );

    const read = await store.audit.get(row.id);
    expect(read?.targetIdentityObserved).toBe('JDE_SVC');
    expect(read?.identityMatch).toBe(false);
    expect(read?.outcome).not.toBe('ok');
    expect(read?.errorCode).toBe('IDENTITY_UNRESOLVED');
    expect(read?.resultKeys ?? []).toEqual([]);

    // And the chain still verifies with both rows in it.
    const verified = await store.audit.verifyChain('local');
    expect(verified.status).toBe('intact');
    expect(verified.firstBreak).toBeNull();
  });
});
