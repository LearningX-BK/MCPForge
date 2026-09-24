// MCPForge — W0-P9. Wave 0 exit criterion 5, EGRESS half: "the gateway is the
// only door — a direct module-server call from outside the trust boundary is
// refused" (02 §4.8, 01 §7 row 5, 01 §11.5).
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT (CLAUDE.md §8). 02 §4.8's control is
// network-level: the TARGET accepts connections only from the gateway's egress
// identity. There is no JDE AIS instance at Wave 0, so that half is a recorded
// waiver in TASKS.md's exit-criteria table, owner-accepted on 25 Sep 2026, and
// NOTHING here claims it. What this proves is the in-code half the owner chose
// for Wave 0: the `function` binding executor, which all eleven Wave 0 tools
// use (reads and writes alike), dispatches NOTHING unless the gateway's policy
// chain minted an execution grant for exactly that call. Everything below is
// real: the ten-stage chain, the HMAC grant, the executor, a real manifest
// from `manifests/`, and its generated schema. The target is the in-process
// mock AIS server, which RECORDS what reached it. Its only role is as the
// observable ("did anything get dispatched?"), and no assertion here depends on
// the mock refusing anything.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  buildFunctionBindingDescriptor,
  compileGeneratedSchema,
  createFunctionExecutor,
  type FunctionBindingDescriptor,
} from '../../adapters/function/src/index.js';
import {
  createDryRunDispatcher,
  buildDryRunDescriptor,
} from '../../adapters/function/src/dryrun.js';
import { createMockAisServer } from '../../adapters/function/src/testing/mock-ais-server.js';
import { loadManifestFile } from '../../core/codegen/src/validate/loader.js';
import {
  generateConfirmSigningKey,
  singleKeyKeyring,
} from '../../core/gateway/policy/confirm/token.js';
import { callThroughToolsCall } from '../../core/gateway/policy/entry-points.js';
import {
  executionGrantCheck,
  mintExecutionGrant,
} from '../../core/gateway/policy/execution-grant/grant.js';
import {
  call,
  context,
  defaultRoles,
  entry,
  functionGrant,
  POLICY_CATALOGUE,
  role,
  TOOLS,
} from '../../core/gateway/policy/policy.fixtures.js';
import type { PolicyContext, PolicyRoleView } from '../../core/gateway/policy/types.js';
import type { ToolManifest } from '@mcpforge/shared/manifest';
import { expectProceeds } from './harness.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = TOOLS.voucherCreate; // `jde.ap.voucher.create`: a real `function` write tool

const manifest = loadManifestFile(
  repoRoot,
  join(repoRoot, 'manifests', 'jde', 'fin', 'ap', 'voucher.create.tool.yaml'),
).doc as ToolManifest;
const descriptor: FunctionBindingDescriptor = buildFunctionBindingDescriptor(manifest);
const validate = compileGeneratedSchema(
  JSON.parse(
    readFileSync(join(repoRoot, 'generated', 'tools', TOOL, 'schema.json'), 'utf8'),
  ) as Record<string, unknown>,
);

const ARGS = { supplier_number: '4242', amount: 18400, currency: 'USD', company: '00100' };

/** The gateway's own grant key. An attacker's key is a different key. */
const GATEWAY_KEYRING = singleKeyKeyring(generateConfirmSigningKey('gateway-egress-grant'));

/** p2p holds a live `function` grant naming the REAL manifest's ref, so the chain proceeds. */
function grantedContext(): PolicyContext {
  const roles = new Map<string, PolicyRoleView>(defaultRoles());
  roles.set(
    'p2p',
    role({ roleId: 'p2p', bindingGrants: [functionGrant({ names: [descriptor.ref] })] }),
  );
  return context({
    roles,
    catalogue: POLICY_CATALOGUE.map((e) =>
      e.toolId === TOOL ? { ...entry(TOOL), bindingRef: descriptor.ref } : e,
    ),
    runtime: { executionGrantKeyring: GATEWAY_KEYRING },
  });
}

function world() {
  const ctx = grantedContext();
  const subject = ctx.scope.session.principal.subject;
  const target = createMockAisServer({ executesAs: subject });
  const executor = createFunctionExecutor({
    client: target,
    grants: executionGrantCheck(GATEWAY_KEYRING, () => ctx.scope.now),
  });
  return { ctx, subject, target, executor };
}

async function refusal(p: Promise<unknown>): Promise<{ code: string; next: string }> {
  try {
    await p;
  } catch (err) {
    return err as { code: string; next: string };
  }
  throw new Error('expected the direct call to be REFUSED, but it dispatched');
}

describe('W0-P9 — exit criterion 5, egress half: the executor refuses anything the chain did not grant', () => {
  it('BASELINE — through the policy chain, the call is granted and reaches the target exactly once', async () => {
    const { ctx, subject, target, executor } = world();
    const c = call(TOOL, ARGS);
    const decision = await callThroughToolsCall(c, ctx);
    expectProceeds(decision);
    if (decision.outcome !== 'proceed') return;

    const result = await executor.execute(descriptor, {
      args: c.args,
      correlationId: c.correlationId,
      principalSubject: subject,
      validate,
      ...(decision.executionGrant === null ? {} : { executionGrant: decision.executionGrant }),
    });
    expect(result.dispatched.orchestration).toBe(descriptor.ref);
    expect(target.calls).toHaveLength(1);
  });

  it('a DIRECT call around the gateway — no grant — is refused and nothing reaches the target', async () => {
    const { subject, target, executor } = world();
    const e = await refusal(
      executor.execute(descriptor, {
        args: ARGS,
        correlationId: 'req_bypass_1',
        principalSubject: subject,
        validate,
      }),
    );
    expect(e.code).toBe('INTERNAL');
    expect(e.next.trim().length).toBeGreaterThan(0);
    expect(target.calls).toHaveLength(0);
  });

  it("a grant the caller minted with its OWN key is refused — the key is the gateway's", async () => {
    const { ctx, subject, target, executor } = world();
    const forged = mintExecutionGrant(
      {
        purpose: 'execute',
        toolId: TOOL,
        bindingRef: descriptor.ref,
        args: ARGS,
        callerSubject: subject,
        consumerId: ctx.scope.session.consumer.consumerId,
        correlationId: 'req_forged',
        now: ctx.scope.now,
      },
      singleKeyKeyring(generateConfirmSigningKey('attacker')),
    );
    await refusal(
      executor.execute(descriptor, {
        args: ARGS,
        correlationId: 'req_forged',
        principalSubject: subject,
        validate,
        executionGrant: forged,
      }),
    );
    expect(target.calls).toHaveLength(0);
  });

  it.each([
    ['different arguments (a larger amount)', { args: { ...ARGS, amount: 999999 } }],
    ['a different human', { principalSubject: 'user:someone.else' }],
    ['a different call', { correlationId: 'req_other_call' }],
  ])('a REAL chain grant replayed for %s is refused', async (_label, change) => {
    const { ctx, subject, target, executor } = world();
    const c = call(TOOL, ARGS);
    const decision = await callThroughToolsCall(c, ctx);
    expectProceeds(decision);
    if (decision.outcome !== 'proceed') return;

    await refusal(
      executor.execute(descriptor, {
        args: c.args,
        correlationId: c.correlationId,
        principalSubject: subject,
        validate,
        ...(decision.executionGrant === null ? {} : { executionGrant: decision.executionGrant }),
        ...change,
      }),
    );
    expect(target.calls).toHaveLength(0);
  });

  it("an EXECUTE grant cannot drive the dry run's _VALIDATE sibling — the grant names its binding ref", async () => {
    const { ctx, subject, target, executor } = world();
    const c = call(TOOL, ARGS);
    const decision = await callThroughToolsCall(c, ctx);
    expectProceeds(decision);
    if (decision.outcome !== 'proceed') return;

    // Probe evidence says the `_VALIDATE` sibling exists, so the dry run really
    // does try to dispatch it, and the only thing that can stop it is the grant.
    const dryRuns = createDryRunDispatcher({
      executor,
      registry: { isRegistered: () => true },
    });
    await refusal(
      dryRuns.dryRun(buildDryRunDescriptor(manifest), {
        args: c.args,
        correlationId: c.correlationId,
        principalSubject: subject,
        validate,
        ...(decision.executionGrant === null ? {} : { executionGrant: decision.executionGrant }),
      }),
    );
    expect(target.calls).toHaveLength(0);
  });

  it('a chain with NO grant keyring proceeds with a null grant, and the executor still refuses', async () => {
    const { subject, target, executor } = world();
    const granted = grantedContext();
    // Omit the key entirely: a runtime assembled without a grant keyring.
    const runtimeWithoutKeyring = { ...granted.runtime };
    delete (runtimeWithoutKeyring as { executionGrantKeyring?: unknown }).executionGrantKeyring;
    const ctx: PolicyContext = { ...granted, runtime: runtimeWithoutKeyring };
    expect('executionGrantKeyring' in ctx.runtime).toBe(false);
    const c = call(TOOL, ARGS);
    const decision = await callThroughToolsCall(c, ctx);
    expectProceeds(decision);
    if (decision.outcome !== 'proceed') return;
    expect(decision.executionGrant).toBeNull();

    await refusal(
      executor.execute(descriptor, {
        args: c.args,
        correlationId: c.correlationId,
        principalSubject: subject,
        validate,
      }),
    );
    expect(target.calls).toHaveLength(0);
  });
});
