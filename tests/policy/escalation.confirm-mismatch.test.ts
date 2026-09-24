// MCPForge — W0-E8 case 4: confirming a plan with ALTERED arguments.
//
// The escalation: a human is shown a plan ("create a voucher for 100"), agrees,
// and the agent then presents that confirmation against different arguments
// ("…for 100,000"). CLAUDE.md non-negotiable #4 makes the defence structural —
// the confirmation is bound to a canonical hash of the business arguments, so a
// token minted for one argument set is worthless against another.
//
// WHAT IS AND IS NOT BUILT (CLAUDE.md §8). The plan/confirm state machine and
// the confirm-token minting/verification service are **W0-F1 and W0-F2**
// (`core/gateway/policy/confirm/**`) and do not exist yet. W0-E3 built stage 6g
// as a named seam (`WriteGate`) with `PLAN_ARGUMENT_MISMATCH` among its four
// verdicts, and W0-B6 built the generated handler that computes the hash. So
// this file tests the three REAL pieces that exist today, and says plainly that
// the fourth — an end-to-end mint-then-confirm round trip — is W0-F2's to add
// here:
//
//   1. the REAL generated handler (produced by running the REAL codegen over
//      the REAL `jde.ap.voucher.create` fixture manifest) binds the confirm
//      token to a canonical hash that EXCLUDES `confirm`, and refuses with
//      PLAN_ARGUMENT_MISMATCH when verification fails — the W0-B7 fix;
//   2. the REAL policy chain fails closed on a `PLAN_ARGUMENT_MISMATCH` verdict
//      at 6g and never reaches the idempotency lookup, so a mismatched confirm
//      can never be replayed into an execution;
//   3. the REAL `idempotencyKeyFor` primitive keys on `argsCanonicalHash`, so
//      altered arguments cannot collide with the original call's key.
//
// Nothing below is a mock returning "as expected": (1) reads a file codegen
// actually wrote, (2) drives the real ten-stage runner, (3) calls the real
// hashing function.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCodegen } from '@mcpforge/codegen/emit';
import { callThroughToolsCall } from '../../core/gateway/policy/entry-points.js';
import {
  call,
  context,
  defaultRoles,
  functionGrant,
  role,
  TOOLS,
} from '../../core/gateway/policy/policy.fixtures.js';
import type { WriteGateVerdict } from '../../core/gateway/policy/types.js';
import { idempotencyKeyFor } from '../../core/gateway/store/runtime/idempotency.js';
import { expectFailsClosed } from './harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const codegenFixtureRepo = join(here, '..', '..', 'core', 'codegen', 'src', 'emit', 'fixtures-custom');

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('W0-E8 case 4 — confirming a plan with altered arguments', () => {
  it('the generated handler binds the confirm token to the business arguments, EXCLUDING confirm', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'mcpforge-w0e8-confirm-'));
    tmpDirs.push(repoRoot);
    cpSync(join(codegenFixtureRepo, 'manifests'), join(repoRoot, 'manifests'), { recursive: true });
    cpSync(join(codegenFixtureRepo, 'roles'), join(repoRoot, 'roles'), { recursive: true });

    const report = await runCodegen(repoRoot);
    expect(report.ok).toBe(true);

    const handler = readFileSync(
      join(repoRoot, 'generated', 'tools', 'jde.ap.voucher.create', 'handler.generated.ts'),
      'utf-8',
    );

    // The W0-B7 fix, read out of the artefact rather than assumed: the
    // canonicaliser strips `confirm` before hashing, so the plan-time hash and
    // the execute-time hash are comparable at all…
    expect(handler).toMatch(/const \{ confirm: _confirm, \.\.\.business \} = args/);
    // …and a token that does not verify against THIS argument set is refused,
    // rather than the arguments being trusted because a token was present.
    // Whitespace-tolerant because the emitted file is prettier-formatted and
    // this call wraps across lines; the ORDERED parts are what is being
    // asserted — the presented token is verified AGAINST the hash of the
    // presented arguments, not merely checked for presence.
    expect(handler).toMatch(
      /ctx\.confirmTokens\.verify\(\{\s*toolId,\s*token:\s*String\(args\.confirm\),\s*argsCanonicalHash,?\s*\}\)/,
    );
    expect(handler).toMatch(/if \(!verified\.ok\) \{[\s\S]*?PLAN_ARGUMENT_MISMATCH/);

    // And the execution branch is downstream of that check — the binding is
    // never reached when the hash does not match.
    const verifyAt = handler.indexOf('confirmTokens.verify');
    const executeAt = handler.indexOf('customBinding.execute');
    expect(verifyAt).toBeGreaterThan(-1);
    expect(executeAt).toBeGreaterThan(verifyAt);
  });

  it('the policy chain FAILS CLOSED on a hash mismatch at 6g, and never reaches the idempotency lookup', async () => {
    const idempotency = { lookup: vi.fn(() => ({ kind: 'proceed' as const })) };
    // The seam W0-F2 will fill, given the verdict a real confirm service
    // produces when the presented arguments do not hash to the plan's. The
    // chain's handling of it — the part under test — is entirely real.
    const writeGate = {
      evaluate: (): WriteGateVerdict => ({
        kind: 'refuse',
        code: 'PLAN_ARGUMENT_MISMATCH',
        message:
          'The confirm token was minted for a different argument set (amount 100, not 100000).',
      }),
    };

    const decision = await callThroughToolsCall(
      call(TOOLS.voucherCreate, { amount: 100000, confirm: 'plan_token_for_amount_100' }),
      context({
        heldRoleIds: ['p2p'],
        runtime: { writeGate, idempotency },
        // A live grant, so 6e′ admits and the call genuinely reaches 6g — this
        // test must fail at the confirm binding, not earlier for another reason.
        roles: rolesWithFunctionGrant(),
      }),
    );

    const refused = expectFailsClosed(decision, { code: 'PLAN_ARGUMENT_MISMATCH', stage: '6g' });
    // The `next` must tell the agent to re-plan, never to retry the same call.
    expect(refused.error.next).toMatch(/without confirm/);
    expect(idempotency.lookup).not.toHaveBeenCalled();
    expect(decision.stagesRun).not.toContain('6h');
  });

  it('altered arguments produce a DIFFERENT idempotency key — a mismatched confirm cannot replay the original', () => {
    const base = {
      callerSubject: 'u-0001',
      toolId: TOOLS.voucherCreate,
      toolVersion: '1.0.0',
      confirmToken: 'plan_token_for_amount_100',
    };
    const original = idempotencyKeyFor({ ...base, argsCanonicalHash: 'hash-of-amount-100' });
    const altered = idempotencyKeyFor({ ...base, argsCanonicalHash: 'hash-of-amount-100000' });

    expect(original).not.toBe(altered);
    // Deterministic, so the original call's own replay still works.
    expect(idempotencyKeyFor({ ...base, argsCanonicalHash: 'hash-of-amount-100' })).toBe(original);
  });
});

// Local to this file: p2p with the live `function` grant `jde.ap.voucher.create`
// needs, so the confirm test's call reaches 6g rather than stopping at 6e′.
function rolesWithFunctionGrant() {
  const roles = new Map(defaultRoles());
  roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
  return roles;
}
