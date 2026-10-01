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
//   1. the SERVED confirm hash (`core/gateway/policy/confirm/hash.ts`) binds
//      the token to a canonical hash that EXCLUDES `confirm` and names the
//      altered field; and (W0-P18) the generated handler, which used to carry
//      its own unserved copy of this check, now carries none;
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
import {
  argsCanonicalHash,
  changedArgumentNames,
} from '../../core/gateway/policy/confirm/hash.js';
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
  // W0-P18 (owner decision of 25 Sep 2026, "Path A only"). This case used to
  // read the GENERATED handler's own canonicaliser and confirm-verify call
  // sites. That handler was never served, and W0-P18 stripped its confirm and
  // audit from codegen. The property is now asserted where it is enforced:
  // the SERVED confirm hash (`core/gateway/policy/confirm/hash.ts`, the one 6g
  // mints and verifies with). And the generated artefact is proven to carry
  // no second copy of it, so there is exactly one implementation to attack.
  it('the SERVED confirm hash binds the business arguments, EXCLUDING confirm, and names the altered field', () => {
    const planned = { supplier_number: '4242', amount: 100, currency: 'GBP', company: '00100' };
    const atPlan = argsCanonicalHash(planned);
    // Plan time (no confirm) and execute time (confirm present) hash equal, so
    // a legitimate confirmation can match at all…
    expect(argsCanonicalHash({ ...planned, confirm: 'plan_token_for_amount_100' })).toBe(atPlan);
    expect(argsCanonicalHash({ ...planned, confirm: null })).toBe(atPlan);
    // …and the altered argument set does NOT, whatever token rides along.
    const altered = { ...planned, amount: 100000, confirm: 'plan_token_for_amount_100' };
    expect(argsCanonicalHash(altered)).not.toBe(atPlan);
    // The refusal can name exactly what changed (non-negotiable #5: no dead end).
    expect(changedArgumentNames(planned, altered)).toEqual(['amount']);
  });

  it('the generated handler carries NO second confirm path to bypass the served one (W0-P18)', async () => {
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
    expect(handler).not.toMatch(/export (async )?function handle\b/);
    expect(handler).not.toContain('confirmTokens');
    expect(handler).not.toContain('customBinding');
    expect(handler).not.toContain('audit.record');
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
