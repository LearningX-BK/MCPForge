// MCPForge — W0-F1's proofs. 02 §3.1.1, 03 §7.1.
//
// The three the `done:` clause names, plus the three the OPUS_GUARDED_PATHS
// review demands:
//
//   1. `confirm` absent/null returns `status: confirm_required` with plan,
//      effects, warnings, confirmToken, expiresAt, reversal and next.
//   2. **And makes no change** — the mock target records every call it receives
//      and is asserted to have received no mutating one.
//   3. `confirm` present executes (the chain proceeds to the binding).
//   4. The token is not forgeable and not usable for a different tool, tool
//      version, caller or argument set.
//   5. The whole thing runs through the REAL policy chain at stage 6g's existing
//      `WriteGate` seam — there is no second mechanism.
//   6. Ordinary tool arguments only: no elicitation, no sampling, no second
//      tool, no out-of-band channel.

import { describe, expect, it } from 'vitest';
import { runPolicyChain } from '../chain.js';
import {
  call,
  context,
  defaultRoles,
  entry,
  functionGrant,
  role,
  TOOLS,
} from '../policy.fixtures.js';
import type { PolicyCall, PolicyCatalogueEntry, PolicyContext } from '../types.js';
import { argsCanonicalHash, argumentWitness, canonicalJson, changedArgumentNames } from './hash.js';
import { confirmWriteGate, type DryRunner, type WriteSafetyView } from './gate.js';
import {
  CONFIRM_TOKEN_PREFIX,
  DEFAULT_CONFIRM_TTL_SECONDS,
  generateConfirmSigningKey,
  mintConfirmToken,
  singleKeyKeyring,
  verifyConfirmToken,
} from './token.js';

// --- the mock target -------------------------------------------------------
//
// It records EVERY call, tagged mutating or not. W0-H6 builds the shared
// harness; this is the same idea, local to the one assertion W0-F1 must make.

interface TargetCall {
  readonly kind: 'dry-run' | 'mutating';
  readonly toolId: string;
}

function mockTarget() {
  const calls: TargetCall[] = [];
  const dryRun: DryRunner = {
    plan(input) {
      calls.push({ kind: 'dry-run', toolId: input.call.toolId });
      return {
        warnings: ['PO 0000451 is only 60% receipted.'],
        planValues: { supplier_name: 'ACME LTD' },
      };
    },
  };
  return {
    calls,
    dryRun,
    /** What the binding executor would do at step [7]. Never called by 6g. */
    execute(toolId: string): void {
      calls.push({ kind: 'mutating', toolId });
    },
    mutatingCalls(): TargetCall[] {
      return calls.filter((c) => c.kind === 'mutating');
    },
  };
}

// --- the tool under test ---------------------------------------------------

const VOUCHER_CREATE: WriteSafetyView = {
  toolId: TOOLS.voucherCreate,
  toolVersion: '1.0.0',
  planTemplate:
    'Create an AP voucher for supplier {supplier_number} ({supplier_name}) for {amount} {currency}, company {company}. This creates an OPEN PAYABLE in JD Edwards.',
  tokenTtlSeconds: 300,
  humanApprovalRequired: false,
  reversal: {
    class: 'compensating-tool',
    tool: TOOLS.voucherCancel,
    windowHours: 720,
    preconditions: 'Voucher must be unpaid and not yet posted to a closed period.',
  },
  dryRunStrategy: 'validate-pair',
  entity: 'voucher',
  verb: 'create',
};

const NOW = new Date('2026-09-03T12:00:00.000Z');

const BUSINESS_ARGS = {
  supplier_number: 4242,
  amount: 18400,
  currency: 'GBP',
  company: '00100',
} as const;

const KEYRING = singleKeyKeyring(generateConfirmSigningKey('kid-test'));

function gateFor(target: ReturnType<typeof mockTarget>, view: WriteSafetyView = VOUCHER_CREATE) {
  return confirmWriteGate({
    writeSafetyFor: (toolId) => (toolId === view.toolId ? view : undefined),
    dryRun: target.dryRun,
    keyring: KEYRING,
    now: () => NOW,
    nonce: () => 'nonce-fixed-0001',
  });
}

/** p2p with the live `function` grant, so the call genuinely reaches 6g. */
function ctxFor(target: ReturnType<typeof mockTarget>, view?: WriteSafetyView): PolicyContext {
  const roles = new Map(defaultRoles());
  roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
  return context({
    heldRoleIds: ['p2p'],
    roles,
    runtime: { writeGate: gateFor(target, view) },
  });
}

function policyCall(args: Record<string, unknown>): PolicyCall {
  return { ...call(TOOLS.voucherCreate, args), entryPoint: 'tools/call' as const };
}

function voucherEntry(): PolicyCatalogueEntry {
  return entry(TOOLS.voucherCreate);
}

// --- 1 + 2: the plan phase -------------------------------------------------

describe('W0-F1 plan phase — confirm absent or null', () => {
  it('returns confirm_required with every field 02 §3.1.1 names, through the real chain', async () => {
    const target = mockTarget();
    const decision = await runPolicyChain(policyCall({ ...BUSINESS_ARGS }), ctxFor(target));

    expect(decision.outcome).toBe('responded');
    if (decision.outcome !== 'responded') throw new Error('unreachable');
    expect(decision.stage).toBe('6g');

    const body = decision.response;
    expect(body['status']).toBe('confirm_required');
    expect(body['plan']).toBe(
      'Create an AP voucher for supplier 4242 (ACME LTD) for 18400 GBP, company 00100. This creates an OPEN PAYABLE in JD Edwards.',
    );
    expect(body['effects']).toEqual([
      { system: 'jde-ap', object: 'voucher', action: 'create', reversible: true },
    ]);
    expect(body['warnings']).toEqual(['PO 0000451 is only 60% receipted.']);
    expect(String(body['confirmToken'])).toMatch(/^cnf_/);
    expect(String(body['expiresAt'])).toBe('2026-09-03T12:05:00.000Z');
    expect(body['reversal']).toEqual({
      class: 'compensating-tool',
      tool: TOOLS.voucherCancel,
      windowHours: 720,
      preconditions: 'Voucher must be unpaid and not yet posted to a closed period.',
    });
    expect(String(body['next'])).toContain('identical arguments plus confirm');
    expect(String(body['next']).length).toBeGreaterThan(0);
  });

  it('treats an explicit confirm: null exactly as an absent confirm', async () => {
    const target = mockTarget();
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS, confirm: null }),
      ctxFor(target),
    );
    expect(decision.outcome).toBe('responded');
  });

  it('MAKES NO CHANGE: the mock target receives no mutating call', async () => {
    const target = mockTarget();
    await runPolicyChain(policyCall({ ...BUSINESS_ARGS }), ctxFor(target));
    await runPolicyChain(policyCall({ ...BUSINESS_ARGS, confirm: null }), ctxFor(target));

    expect(target.mutatingCalls()).toEqual([]);
    expect(target.calls.map((c) => c.kind)).toEqual(['dry-run', 'dry-run']);
  });

  it('stops the chain at 6g, so stage 6h and the binding executor are never reached', async () => {
    const target = mockTarget();
    const decision = await runPolicyChain(policyCall({ ...BUSINESS_ARGS }), ctxFor(target));
    expect(decision.stagesRun).not.toContain('6h');
    expect(decision.outcome).not.toBe('proceed');
  });

  it('uses ORDINARY TOOL ARGUMENTS ONLY — the plan response is data, not a protocol feature', async () => {
    const target = mockTarget();
    const decision = await runPolicyChain(policyCall({ ...BUSINESS_ARGS }), ctxFor(target));
    if (decision.outcome !== 'responded') throw new Error('unreachable');
    const serialised = JSON.stringify(decision.response);
    for (const forbidden of ['elicit', 'sampling', 'createMessage', 'roots/']) {
      expect(serialised).not.toContain(forbidden);
    }
    // The whole round trip is one field on the tool's own schema.
    expect(Object.keys(decision.response)).toContain('confirmToken');
  });
});

// --- 3: the execute phase --------------------------------------------------

async function planThen(args: Record<string, unknown>): Promise<string> {
  const target = mockTarget();
  const decision = await runPolicyChain(policyCall(args), ctxFor(target));
  if (decision.outcome !== 'responded') throw new Error('plan did not respond');
  return String(decision.response['confirmToken']);
}

describe('W0-F1 execute phase — confirm present', () => {
  it('a valid token proceeds past 6g and the chain reaches the binding executor', async () => {
    const token = await planThen({ ...BUSINESS_ARGS });
    const target = mockTarget();
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS, confirm: token }),
      ctxFor(target),
    );

    expect(decision.outcome).toBe('proceed');
    if (decision.outcome !== 'proceed') throw new Error('unreachable');
    expect(decision.stagesRun).toContain('6h');
    expect(decision.confirmed?.confirmToken).toBe(token);
    expect(decision.confirmed?.argsCanonicalHash).toBe(argsCanonicalHash(BUSINESS_ARGS));
    // The execute phase re-plans nothing: the dry run ran once, at plan time.
    expect(target.calls).toEqual([]);
  });

  it('refuses PLAN_ARGUMENT_MISMATCH when an argument changed after the plan', async () => {
    const token = await planThen({ ...BUSINESS_ARGS, amount: 100 });
    const target = mockTarget();
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS, amount: 100000, confirm: token }),
      ctxFor(target),
    );

    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.stage).toBe('6g');
    expect(decision.error.code).toBe('PLAN_ARGUMENT_MISMATCH');
    expect(decision.error.next).toMatch(/without confirm/);
    expect(target.mutatingCalls()).toEqual([]);
    expect(decision.stagesRun).not.toContain('6h');
  });

  it('refuses a confirm value that is not a token this gateway minted', async () => {
    const target = mockTarget();
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS, confirm: 'cnf_not.a.token' }),
      ctxFor(target),
    );
    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.error.code).toBe('PLAN_ARGUMENT_MISMATCH');
    expect(decision.error.next.length).toBeGreaterThan(0);
  });

  it('refuses PLAN_EXPIRED once the TTL has elapsed, distinctly from a mismatch', async () => {
    const token = await planThen({ ...BUSINESS_ARGS });
    const target = mockTarget();
    const late = confirmWriteGate({
      writeSafetyFor: () => VOUCHER_CREATE,
      dryRun: target.dryRun,
      keyring: KEYRING,
      now: () => new Date(NOW.getTime() + 301_000),
    });
    const roles = new Map(defaultRoles());
    roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS, confirm: token }),
      context({ heldRoleIds: ['p2p'], roles, runtime: { writeGate: late } }),
    );

    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.error.code).toBe('PLAN_EXPIRED');
  });
});

// --- the human-approval fork (W0-F6 owns the queue; F1 must mint nothing) ---

describe('W0-F1 and humanApprovalRequired', () => {
  it('mints NO token and refuses APPROVAL_REQUIRED', async () => {
    const target = mockTarget();
    const view: WriteSafetyView = { ...VOUCHER_CREATE, humanApprovalRequired: true };
    const decision = await runPolicyChain(policyCall({ ...BUSINESS_ARGS }), ctxFor(target, view));

    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.error.code).toBe('APPROVAL_REQUIRED');
    expect(JSON.stringify(decision.error)).not.toContain(CONFIRM_TOKEN_PREFIX);
    expect(target.calls).toEqual([]);
    expect(target.mutatingCalls()).toEqual([]);
  });
});

// --- fail-closed configuration cases ---------------------------------------

describe('W0-F1 fail-closed configuration', () => {
  it('refuses a write tool the gateway holds no writeSafety view for', async () => {
    const target = mockTarget();
    const orphan = confirmWriteGate({
      writeSafetyFor: () => undefined,
      dryRun: target.dryRun,
      keyring: KEYRING,
      now: () => NOW,
    });
    const roles = new Map(defaultRoles());
    roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS }),
      context({ heldRoleIds: ['p2p'], roles, runtime: { writeGate: orphan } }),
    );
    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.error.code).toBe('PLAN_REQUIRED');
    expect(target.mutatingCalls()).toEqual([]);
  });

  it('says not-a-write for a read tool, whatever confirm it was handed', async () => {
    const target = mockTarget();
    const gate = gateFor(target);
    const readEntry = entry(TOOLS.voucherSearch);
    const verdict = await gate.evaluate(
      { ...call(TOOLS.voucherSearch, { confirm: 'cnf_anything' }), entryPoint: 'tools/call' },
      readEntry,
      ctxFor(target),
    );
    expect(verdict.kind).toBe('not-a-write');
  });

  it('refuses a non-string confirm rather than treating it as a plan request', async () => {
    const target = mockTarget();
    const gate = gateFor(target);
    const verdict = await gate.evaluate(
      policyCall({ ...BUSINESS_ARGS, confirm: 42 }),
      voucherEntry(),
      ctxFor(target),
    );
    expect(verdict.kind).toBe('refuse');
    if (verdict.kind !== 'refuse') throw new Error('unreachable');
    expect(verdict.code).toBe('PLAN_REQUIRED');
    // Crucially it did NOT dry-run and mint a token for a call that named one.
    expect(target.calls).toEqual([]);
  });
});

// --- 4: the token is the security control ----------------------------------

describe('W0-F1 confirm token binding', () => {
  const binding = {
    callerSubject: 'u-0001',
    toolId: TOOLS.voucherCreate,
    toolVersion: '1.0.0',
    argsCanonicalHash: argsCanonicalHash(BUSINESS_ARGS),
  };
  const payload = { ...binding, planHash: 'plan-hash', nonce: 'n1', exp: 4_000_000_000 };

  it('verifies against the call it was minted for', () => {
    const token = mintConfirmToken(payload, KEYRING);
    expect(verifyConfirmToken(token, binding, KEYRING, NOW).ok).toBe(true);
  });

  it.each([
    ['a different caller', { callerSubject: 'u-9999' }],
    ['a different tool', { toolId: TOOLS.journalCreate }],
    ['a different tool version', { toolVersion: '2.0.0' }],
    ['a different argument set', { argsCanonicalHash: argsCanonicalHash({ amount: 100000 }) }],
  ])('is refused for %s', (_label, override) => {
    const token = mintConfirmToken(payload, KEYRING);
    const result = verifyConfirmToken(token, { ...binding, ...override }, KEYRING, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failure).toBe('not-bound-to-this-call');
  });

  it('cannot be forged: an edited payload no longer verifies', () => {
    const token = mintConfirmToken(payload, KEYRING);
    const [header, body, wit, signature] = token.slice(CONFIRM_TOKEN_PREFIX.length).split('.') as [
      string,
      string,
      string,
      string,
    ];
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    decoded['callerSubject'] = 'u-9999';
    const tampered = `${CONFIRM_TOKEN_PREFIX}${header}.${Buffer.from(
      JSON.stringify(decoded),
    ).toString('base64url')}.${wit}.${signature}`;

    const result = verifyConfirmToken(
      tampered,
      { ...binding, callerSubject: 'u-9999' },
      KEYRING,
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failure).toBe('bad-signature');
  });

  it('cannot be signed by a key the keyring does not accept', () => {
    const attacker = singleKeyKeyring(generateConfirmSigningKey('kid-test'));
    const token = mintConfirmToken(payload, attacker);
    const result = verifyConfirmToken(token, binding, KEYRING, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failure).toBe('bad-signature');
  });

  it('carries no business argument VALUE — the payload is signed, not encrypted', () => {
    const token = mintConfirmToken(payload, KEYRING);
    const body = token.slice(CONFIRM_TOKEN_PREFIX.length).split('.')[1] as string;
    const decoded = Buffer.from(body, 'base64url').toString('utf8');
    expect(decoded).not.toContain('18400');
    expect(decoded).not.toContain('ACME');
    expect(Object.keys(JSON.parse(decoded) as object).sort()).toEqual([
      'argsCanonicalHash',
      'callerSubject',
      'exp',
      'nonce',
      'planHash',
      'toolId',
      'toolVersion',
    ]);
  });

  it('survives a key rotation while the old key is still in the overlap window', () => {
    const oldKey = generateConfirmSigningKey('kid-old');
    const newKey = generateConfirmSigningKey('kid-new');
    const before = singleKeyKeyring(oldKey);
    const during = { active: newKey, accepted: [newKey, oldKey] };
    const after = singleKeyKeyring(newKey);

    const inFlight = mintConfirmToken(payload, before);
    expect(verifyConfirmToken(inFlight, binding, during, NOW).ok).toBe(true);
    expect(verifyConfirmToken(inFlight, binding, after, NOW).ok).toBe(false);
  });
});

// --- the canonicaliser (minimal here; W0-F2 hardens it) --------------------

describe('argsCanonicalHash (W0-F2 will harden this)', () => {
  it('ignores key order at every depth', () => {
    const a = { z: 1, a: { y: 2, b: [1, 2] } };
    const b = { a: { b: [1, 2], y: 2 }, z: 1 };
    expect(argsCanonicalHash(a)).toBe(argsCanonicalHash(b));
  });

  it('excludes confirm, so the plan-time and execute-time hashes can ever match', () => {
    expect(argsCanonicalHash({ ...BUSINESS_ARGS })).toBe(
      argsCanonicalHash({ ...BUSINESS_ARGS, confirm: 'cnf_whatever' }),
    );
  });

  it('normalises -0 to 0 and treats array order as significant', () => {
    expect(canonicalJson(-0)).toBe('0');
    expect(argsCanonicalHash({ v: [1, 2] })).not.toBe(argsCanonicalHash({ v: [2, 1] }));
  });

  it('changes when any value changes', () => {
    expect(argsCanonicalHash({ amount: 100 })).not.toBe(argsCanonicalHash({ amount: 100000 }));
    expect(argsCanonicalHash({ amount: 100 })).not.toBe(argsCanonicalHash({ amount: '100' }));
  });

  it('names the fields that changed, for PLAN_ARGUMENT_MISMATCH copy', () => {
    expect(
      changedArgumentNames({ amount: 100, currency: 'GBP' }, { amount: 100000, currency: 'GBP' }),
    ).toEqual(['amount']);
  });
});

// ===========================================================================
// W0-F2 — the four properties its `done:` clause names, each proved separately.
// ===========================================================================

// --- a tiny deterministic generator ----------------------------------------
//
// No property-testing dependency is added. The build must work from a clean
// clone with no new package, and what this needs is small enough to be obvious:
// a seeded PRNG, a random-JSON generator, a recursive key shuffler. Seeded, so
// a failure is reproducible from the seed printed in the assertion.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEY_POOL = ['amount', 'currency', 'company', 'supplier_number', 'lines', 'memo', 'gl_date'];

function randomJson(rnd: () => number, depth: number): unknown {
  const pick = Math.floor(rnd() * (depth <= 0 ? 5 : 7));
  switch (pick) {
    case 0:
      return null;
    case 1:
      return rnd() < 0.5;
    case 2:
      // Numbers that exercise the normalisation rules: integers, decimals with
      // trailing zeros the parser has already collapsed, and negative zero.
      return [0, -0, 1.1, 1.1, 100, 100000, -42.5, 1e21, 1e-7][Math.floor(rnd() * 9)];
    case 3:
      return ['GBP', 'USD', '', 'ACME LTD', '00100', 'quote"and\\slash', 'héllo'][
        Math.floor(rnd() * 7)
      ];
    case 4:
      return Math.floor(rnd() * 1000);
    case 5: {
      const n = Math.floor(rnd() * 3);
      return Array.from({ length: n }, () => randomJson(rnd, depth - 1));
    }
    default: {
      const n = Math.floor(rnd() * 4);
      const out: Record<string, unknown> = {};
      for (let i = 0; i < n; i += 1) {
        out[KEY_POOL[Math.floor(rnd() * KEY_POOL.length)] as string] = randomJson(rnd, depth - 1);
      }
      return out;
    }
  }
}

/** Rebuild every object with its keys in a different insertion order, at every depth. */
function shuffleKeys(value: unknown, rnd: () => number): unknown {
  if (Array.isArray(value)) return value.map((v) => shuffleKeys(v, rnd));
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([k, v]) => [k, shuffleKeys(v, rnd)] as const,
  );
  for (let i = entries.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    const a = entries[i] as (typeof entries)[number];
    const b = entries[j] as (typeof entries)[number];
    entries[i] = b;
    entries[j] = a;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) out[k] = v;
  return out;
}

/** What a JSON round trip through the wire does to a value. */
function reserialise(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

describe('W0-F2 property 1 — the canonicaliser is stable', () => {
  it('is unchanged by key order and by re-serialisation, over 500 generated inputs', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const rnd = mulberry32(seed);
      const original = randomJson(rnd, 3) as Record<string, unknown>;
      const args = typeof original === 'object' && original !== null ? original : { v: original };

      const shuffled = shuffleKeys(args, mulberry32(seed * 7919)) as Record<string, unknown>;
      const roundTripped = reserialise(args) as Record<string, unknown>;
      const both = shuffleKeys(reserialise(args), mulberry32(seed * 104729)) as Record<
        string,
        unknown
      >;

      const expected = argsCanonicalHash(args);
      expect({ seed, hash: argsCanonicalHash(shuffled) }).toEqual({ seed, hash: expected });
      expect({ seed, hash: argsCanonicalHash(roundTripped) }).toEqual({ seed, hash: expected });
      expect({ seed, hash: argsCanonicalHash(both) }).toEqual({ seed, hash: expected });
    }
  });

  it('sorts keys at every depth, in the serialisation itself and not only in the hash', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  it('normalises numbers: 1.10 ≡ 1.1 and -0 ≡ 0', () => {
    expect(canonicalJson(1.1)).toBe('1.1');
    expect(canonicalJson(1.1)).toBe(canonicalJson(1.1));
    expect(argsCanonicalHash({ amount: 1.1 })).toBe(argsCanonicalHash({ amount: 1.1 }));
    expect(argsCanonicalHash({ amount: 100 })).toBe(argsCanonicalHash({ amount: 100 }));
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson(0)).toBe('0');
    expect(argsCanonicalHash({ amount: -0 })).toBe(argsCanonicalHash({ amount: 0 }));
  });

  it('excludes confirm at the TOP LEVEL only — a nested "confirm" is a business value', () => {
    expect(argsCanonicalHash({ amount: 1, confirm: 'cnf_x' })).toBe(
      argsCanonicalHash({ amount: 1 }),
    );
    expect(argsCanonicalHash({ nested: { confirm: 'a' } })).not.toBe(
      argsCanonicalHash({ nested: {} }),
    );
  });

  it('REFUSES values it cannot canonicalise unambiguously, rather than colliding', () => {
    // Each of these would become `null` or `{}` under JSON.stringify and collide
    // with a genuinely different argument set.
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    expect(() => canonicalJson(new Date(0))).toThrow(/non-plain/);
    expect(() => canonicalJson(new Map())).toThrow(/non-plain/);
    expect(() => canonicalJson(10n)).toThrow(/type bigint/);
  });

  it('distinguishes a missing key from an explicit null', () => {
    expect(argsCanonicalHash({ memo: null })).not.toBe(argsCanonicalHash({}));
  });
});

describe('W0-F2 property 2 — the token payload binds exactly the seven fields', () => {
  it('carries {callerSubject, toolId, toolVersion, argsCanonicalHash, planHash, nonce, exp}', async () => {
    const token = await planThen({ ...BUSINESS_ARGS });
    const body = token.slice(CONFIRM_TOKEN_PREFIX.length).split('.')[1] as string;
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(decoded).sort()).toEqual([
      'argsCanonicalHash',
      'callerSubject',
      'exp',
      'nonce',
      'planHash',
      'toolId',
      'toolVersion',
    ]);
    expect(decoded['argsCanonicalHash']).toBe(argsCanonicalHash(BUSINESS_ARGS));
    expect(decoded['toolVersion']).toBe(VOUCHER_CREATE.toolVersion);
    expect(decoded['nonce']).toBe('nonce-fixed-0001');
  });

  it('discloses no business value ANYWHERE in the token, witness segment included', async () => {
    const token = await planThen({ ...BUSINESS_ARGS, supplier_name: 'ACME LTD' });
    const decoded = token
      .slice(CONFIRM_TOKEN_PREFIX.length)
      .split('.')
      .map((seg) => Buffer.from(seg, 'base64url').toString('utf8'))
      .join('|');
    // Field NAMES may appear (the witness is keyed by name); values may not.
    expect(decoded).toContain('amount');
    expect(decoded).not.toContain('18400');
    expect(decoded).not.toContain('ACME');
    expect(decoded).not.toContain('GBP');
    expect(decoded).not.toContain('00100');
  });

  it('binds the witness under the signature: swapping it invalidates the token', async () => {
    const token = await planThen({ ...BUSINESS_ARGS });
    const other = await planThen({ ...BUSINESS_ARGS, amount: 999 });
    const [h, p, , s] = token.slice(CONFIRM_TOKEN_PREFIX.length).split('.') as [
      string,
      string,
      string,
      string,
    ];
    const foreignWitness = other.slice(CONFIRM_TOKEN_PREFIX.length).split('.')[2] as string;
    const spliced = `${CONFIRM_TOKEN_PREFIX}${h}.${p}.${foreignWitness}.${s}`;
    const result = verifyConfirmToken(
      spliced,
      {
        callerSubject: 'u-0001',
        toolId: TOOLS.voucherCreate,
        toolVersion: '1.0.0',
        argsCanonicalHash: argsCanonicalHash(BUSINESS_ARGS),
      },
      KEYRING,
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failure).toBe('bad-signature');
  });
});

describe('W0-F2 property 3 — the 100.00 → 100000.00 refusal names the amount field', () => {
  it('refuses PLAN_ARGUMENT_MISMATCH and NAMES amount, having executed nothing', async () => {
    const token = await planThen({ ...BUSINESS_ARGS, amount: 100.0 });
    const target = mockTarget();
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS, amount: 100000.0, confirm: token }),
      ctxFor(target),
    );

    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.stage).toBe('6g');
    expect(decision.error.code).toBe('PLAN_ARGUMENT_MISMATCH');
    // The point of the whole task: the field is NAMED.
    expect(decision.error.message).toContain('amount');
    expect(decision.error.next.length).toBeGreaterThan(0);
    expect(decision.error.next).toContain('amount');
    // …and only that field, so the message is usable rather than a wall.
    expect(decision.error.message).not.toContain('currency');
    // The value the human did NOT approve is never echoed back into the message.
    expect(decision.error.message).not.toContain('100000');
    // Nothing was executed and nothing was re-planned.
    expect(target.calls).toEqual([]);
    expect(decision.stagesRun).not.toContain('6h');
  });

  it('names every changed field when more than one changed', async () => {
    const token = await planThen({ ...BUSINESS_ARGS, amount: 100.0 });
    const target = mockTarget();
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS, amount: 100000.0, currency: 'USD', confirm: token }),
      ctxFor(target),
    );
    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.error.message).toContain('amount');
    expect(decision.error.message).toContain('currency');
  });

  it('names an argument that was ADDED or REMOVED since the plan', async () => {
    const token = await planThen({ ...BUSINESS_ARGS });
    const target = mockTarget();
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS, memo: 'urgent', confirm: token }),
      ctxFor(target),
    );
    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.error.message).toContain('memo');
  });

  it('does NOT refuse when only key ORDER differs — the plan is the same plan', async () => {
    const token = await planThen({ ...BUSINESS_ARGS });
    const target = mockTarget();
    const reordered = {
      company: BUSINESS_ARGS.company,
      currency: BUSINESS_ARGS.currency,
      amount: BUSINESS_ARGS.amount,
      supplier_number: BUSINESS_ARGS.supplier_number,
      confirm: token,
    };
    const decision = await runPolicyChain(policyCall(reordered), ctxFor(target));
    expect(decision.outcome).toBe('proceed');
  });

  it('names no field for a wrong-caller or wrong-version token — those are not "changed args"', () => {
    const witnessedArgs = { ...BUSINESS_ARGS };
    const token = mintConfirmToken(
      {
        callerSubject: 'u-0001',
        toolId: TOOLS.voucherCreate,
        toolVersion: '1.0.0',
        argsCanonicalHash: argsCanonicalHash(witnessedArgs),
        planHash: 'plan-hash',
        nonce: 'n1',
        exp: 4_000_000_000,
      },
      KEYRING,
      argumentWitness(witnessedArgs, KEYRING.active.key),
    );
    const result = verifyConfirmToken(
      token,
      {
        callerSubject: 'u-9999',
        toolId: TOOLS.voucherCreate,
        toolVersion: '1.0.0',
        argsCanonicalHash: argsCanonicalHash(witnessedArgs),
        args: witnessedArgs,
      },
      KEYRING,
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.mismatchedField).toBe('callerSubject');
    expect(result.changedArguments).toBeUndefined();
  });

  it('keeps the witness digests unguessable: they are keyed, not bare hashes', () => {
    const a = argumentWitness({ amount: 100 }, KEYRING.active.key);
    const b = argumentWitness(
      { amount: 100 },
      generateConfirmSigningKey('other').key as unknown as Uint8Array,
    );
    // Same value, different key, different digest — so an observer without the
    // gateway's key cannot brute-force a low-entropy amount out of a token.
    expect(a['amount']).not.toBe(b['amount']);
  });
});

describe('W0-F2 property 4a — tokens are TTL-bounded, 300 s by default', () => {
  const noDeclaredTtl: WriteSafetyView = { ...VOUCHER_CREATE, tokenTtlSeconds: 0 };

  it('expires 300 s after the plan when the manifest declares no TTL', async () => {
    const target = mockTarget();
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS }),
      ctxFor(target, noDeclaredTtl),
    );
    if (decision.outcome !== 'responded') throw new Error('unreachable');
    expect(DEFAULT_CONFIRM_TTL_SECONDS).toBe(300);
    expect(decision.response['expiresAt']).toBe(
      new Date(NOW.getTime() + DEFAULT_CONFIRM_TTL_SECONDS * 1000).toISOString(),
    );
  });

  it('is still valid one second BEFORE the default TTL elapses', async () => {
    const token = await planThen({ ...BUSINESS_ARGS });
    const result = verifyConfirmToken(
      token,
      {
        callerSubject: 'u-0001',
        toolId: TOOLS.voucherCreate,
        toolVersion: '1.0.0',
        argsCanonicalHash: argsCanonicalHash(BUSINESS_ARGS),
      },
      KEYRING,
      new Date(NOW.getTime() + 299_000),
    );
    expect(result.ok).toBe(true);
  });

  it('is refused as EXPIRED — not as a mismatch — once the TTL has elapsed', async () => {
    const token = await planThen({ ...BUSINESS_ARGS });
    const result = verifyConfirmToken(
      token,
      {
        callerSubject: 'u-0001',
        toolId: TOOLS.voucherCreate,
        toolVersion: '1.0.0',
        argsCanonicalHash: argsCanonicalHash(BUSINESS_ARGS),
      },
      KEYRING,
      new Date(NOW.getTime() + 300_001),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failure).toBe('expired');
  });
});

describe('W0-F2 property 4b — tokens are invalid across callers', () => {
  it('a token minted for one caller does not verify for another', async () => {
    const token = await planThen({ ...BUSINESS_ARGS });
    const binding = {
      toolId: TOOLS.voucherCreate,
      toolVersion: '1.0.0',
      argsCanonicalHash: argsCanonicalHash(BUSINESS_ARGS),
    };
    expect(
      verifyConfirmToken(token, { ...binding, callerSubject: 'u-0001' }, KEYRING, NOW).ok,
    ).toBe(true);
    const stolen = verifyConfirmToken(token, { ...binding, callerSubject: 'u-9999' }, KEYRING, NOW);
    expect(stolen.ok).toBe(false);
    if (stolen.ok) throw new Error('unreachable');
    expect(stolen.mismatchedField).toBe('callerSubject');
  });
});

describe('W0-F2 property 4c — tokens are invalid across tool versions', () => {
  it('a token minted against 1.0.0 is refused by 1.0.1 and by 2.0.0', async () => {
    const token = await planThen({ ...BUSINESS_ARGS });
    for (const version of ['1.0.1', '2.0.0']) {
      const target = mockTarget();
      const bumped: WriteSafetyView = { ...VOUCHER_CREATE, toolVersion: version };
      const decision = await runPolicyChain(
        policyCall({ ...BUSINESS_ARGS, confirm: token }),
        ctxFor(target, bumped),
      );
      expect(decision.outcome).toBe('refused');
      if (decision.outcome !== 'refused') throw new Error('unreachable');
      expect(decision.error.code).toBe('PLAN_ARGUMENT_MISMATCH');
      expect(decision.error.message).toMatch(/different version/);
      expect(target.mutatingCalls()).toEqual([]);
    }
  });
});

describe('W0-F2 property 4d — the single-use handle', () => {
  // SCOPE, stated in the test file so a reader cannot miss it. Single-use has
  // two halves and this task owns one. **Minting** — a fresh, unique,
  // unpredictable nonce, signed into the token and surfaced explicitly at
  // verification — is proved here. **Consuming** — the `confirm_nonce` INSERT
  // inside the execute transaction, which is what makes a SECOND presentation
  // of one token fail — is W0-F3's, because that INSERT must be atomic with the
  // execute and stage 6g runs before the executor. Nothing below claims a token
  // has already been rejected for reuse, because nothing yet can.

  function realNonceGate(target: ReturnType<typeof mockTarget>) {
    return confirmWriteGate({
      writeSafetyFor: (id) => (id === VOUCHER_CREATE.toolId ? VOUCHER_CREATE : undefined),
      dryRun: target.dryRun,
      keyring: KEYRING,
      now: () => NOW,
      // deliberately no `nonce` override: the production generator.
    });
  }

  async function mintWithRealNonce(): Promise<string> {
    const target = mockTarget();
    const roles = new Map(defaultRoles());
    roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
    const decision = await runPolicyChain(
      policyCall({ ...BUSINESS_ARGS }),
      context({ heldRoleIds: ['p2p'], roles, runtime: { writeGate: realNonceGate(target) } }),
    );
    if (decision.outcome !== 'responded') throw new Error('plan did not respond');
    return String(decision.response['confirmToken']);
  }

  function nonceOf(token: string): string {
    const body = token.slice(CONFIRM_TOKEN_PREFIX.length).split('.')[1] as string;
    return (JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { nonce: string }).nonce;
  }

  it('mints a UNIQUE nonce every time, even for byte-identical plans', async () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 50; i += 1) nonces.add(nonceOf(await mintWithRealNonce()));
    expect(nonces.size).toBe(50);
  });

  it('mints an UNPREDICTABLE nonce — a v4 UUID, not a counter', async () => {
    const nonce = nonceOf(await mintWithRealNonce());
    expect(nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('surfaces the nonce explicitly at verification, so W0-F3 consumes a field not a token', async () => {
    const token = await mintWithRealNonce();
    const result = verifyConfirmToken(
      token,
      {
        callerSubject: 'u-0001',
        toolId: TOOLS.voucherCreate,
        toolVersion: '1.0.0',
        argsCanonicalHash: argsCanonicalHash(BUSINESS_ARGS),
      },
      KEYRING,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.nonce).toBe(nonceOf(token));
    expect(result.nonce).toBe(result.payload.nonce);
  });

  it('signs the nonce: it cannot be swapped for another token’s', async () => {
    const a = await mintWithRealNonce();
    const b = await mintWithRealNonce();
    const [h, pa, w, s] = a.slice(CONFIRM_TOKEN_PREFIX.length).split('.') as [
      string,
      string,
      string,
      string,
    ];
    const decoded = JSON.parse(Buffer.from(pa, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    decoded['nonce'] = nonceOf(b);
    const spliced = `${CONFIRM_TOKEN_PREFIX}${h}.${Buffer.from(JSON.stringify(decoded)).toString(
      'base64url',
    )}.${w}.${s}`;
    const result = verifyConfirmToken(
      spliced,
      {
        callerSubject: 'u-0001',
        toolId: TOOLS.voucherCreate,
        toolVersion: '1.0.0',
        argsCanonicalHash: argsCanonicalHash(BUSINESS_ARGS),
      },
      KEYRING,
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.failure).toBe('bad-signature');
  });
});
