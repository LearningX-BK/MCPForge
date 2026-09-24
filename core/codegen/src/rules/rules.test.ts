// MCPForge — W0-B3. One fixture manifest per policy rule, proving each fires.
// Run this file alone with `pnpm test -- rules`.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateRepo } from '../validate/engine.js';
import type { ValidationFailure } from '../validate/types.js';
import { POLICY_RULES } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');

function report(set: string): readonly ValidationFailure[] {
  return validateRepo(join(fixtures, 'broken', set)).failures;
}

/** The failures a given policy rule produced for a fixture set. */
function firedBy(set: string, ruleId: string): readonly ValidationFailure[] {
  return report(set).filter((f) => f.ruleId === ruleId);
}

function expectFires(
  set: string,
  ruleId: string,
  path: string,
  messageMatch: RegExp,
): ValidationFailure {
  const failures = firedBy(set, ruleId);
  expect(failures.length, `${ruleId} did not fire for fixture "${set}"`).toBeGreaterThan(0);
  const failure = failures.find((f) => f.path === path) ?? failures[0]!;
  expect(failure.path).toBe(path);
  expect(failure.message).toMatch(messageMatch);
  expect(failure.file.length).toBeGreaterThan(0);
  expect(failure.fix.length).toBeGreaterThan(0);
  return failure;
}

describe('rules — write safety (CLAUDE.md #4)', () => {
  it('write: true with no writeSafety block fires policy.write-safety-incomplete', () => {
    expectFires(
      'write-safety-incomplete',
      'policy.write-safety-incomplete',
      '/writeSafety',
      /write: true with no writeSafety block/,
    );
  });

  // W0-F5, 02 §3.1.4: "codegen refuses a write tool without one". A complete
  // writeSafety block whose reversal block simply omits `class` is the case
  // that would otherwise slip through — the block is present, so nothing looks
  // missing, and the tool would reach the gateway with no declared way back.
  it('write: true whose reversal block declares no class fires policy.write-safety-incomplete', () => {
    expectFires(
      'reversal-class-missing',
      'policy.write-safety-incomplete',
      '/writeSafety/reversal/class',
      /no reversal\.class/,
    );
  });

  it('reversal.class: irreversible without humanApprovalRequired and standard review fires policy.irreversible-approval', () => {
    expectFires(
      'irreversible-approval',
      'policy.irreversible-approval',
      '/writeSafety/humanApprovalRequired',
      /irreversible without humanApprovalRequired: true/,
    );
    expectFires(
      'irreversible-approval',
      'policy.irreversible-approval',
      '/governance/reviewPath',
      /Expedited review is structurally unavailable for irreversible writes/,
    );
  });
});

describe('rules — binding type and identity (CLAUDE.md #2, #3)', () => {
  it('expedited review on a function binding fires policy.expedited-review-elevated-binding', () => {
    expectFires(
      'expedited-review',
      'policy.expedited-review-elevated-binding',
      '/governance/reviewPath',
      /Expedited review is structurally unavailable for plsql and function bindings/,
    );
  });

  it('identity.carries: verified in a hand-authored manifest fires policy.identity-verified-asserted', () => {
    expectFires(
      'identity-verified',
      'policy.identity-verified-asserted',
      '/binding/identity/carries',
      /Only the capability probe may ever write "verified"/,
    );
  });

  it('write: true + binding.type: database fires policy.database-write', () => {
    expectFires(
      'database-write',
      'policy.database-write',
      '/binding/type',
      /Database bindings are read-only by policy/,
    );
  });

  it('a plsql binding.ref naming an APPS package fires policy.plsql-wrapper-ref', () => {
    expectFires(
      'plsql-wrapper-ref',
      'policy.plsql-wrapper-ref',
      '/binding/ref',
      /does not match \^MCPFORGE_WRAP/,
    );
  });

  it('a function write tool without echoOn: write fires policy.function-write-echo', () => {
    expectFires(
      'function-write-echo',
      'policy.function-write-echo',
      '/binding/identity/echoOn',
      /echoOn: write is mandatory/,
    );
  });
});

describe('rules — agent-facing copy and token budgets (03 §10.3, 02 §5.3)', () => {
  it('a sibling without disambiguation fires policy.sibling-disambiguation', () => {
    const failure = expectFires(
      'sibling-disambiguation',
      'policy.sibling-disambiguation',
      '/disambiguation',
      /shares the jde\.ap\.voucher prefix/,
    );
    // Mutual: the sibling that DOES carry one is not reported.
    expect(failure.file).toContain('voucher.cancel.tool.yaml');
    expect(firedBy('sibling-disambiguation', 'policy.sibling-disambiguation')).toHaveLength(1);
  });

  it('a purpose over 14 words fires policy.purpose-word-budget', () => {
    expectFires(
      'purpose-word-budget',
      'policy.purpose-word-budget',
      '/purpose',
      /the budget is 14/,
    );
  });

  it('a parameter desc over 12 words fires policy.param-desc-word-budget', () => {
    expectFires(
      'param-desc-word-budget',
      'policy.param-desc-word-budget',
      '/input/0/desc',
      /the budget is 12/,
    );
  });

  it('an inline enum over 12 values fires policy.inline-enum-too-long', () => {
    expectFires(
      'inline-enum-too-long',
      'policy.inline-enum-too-long',
      '/input/3/enum',
      /must use enumRef/,
    );
  });

  it('a calls field anywhere fires policy.calls-field', () => {
    expectFires('calls-field', 'policy.calls-field', '/calls', /illustrative demo data/);
  });
});

describe('rules — benchmark integrity (02 §5.4.1)', () => {
  it('an alias copied verbatim from evals/** fires policy.eval-alias-leak', () => {
    const failure = expectFires(
      'eval-alias-leak',
      'policy.eval-alias-leak',
      '/aliases/3',
      /appears verbatim in evals\/jde-fin-ap\/intents\.yaml/,
    );
    expect(failure.message).toContain('book a payable');
  });
});

describe('rules — [P5] credentials (CLAUDE.md #1, #8; 02 §11.5.1)', () => {
  it('module-scoped-stored where identity is reported verified fires policy.stored-credential-on-verified-identity', () => {
    expectFires(
      'stored-credential-verified',
      'policy.stored-credential-on-verified-identity',
      '/binding/credentialClass',
      /may not fall back to a stored module credential/,
    );
  });

  it('per-user-exchanged on plsql fires policy.per-user-exchanged-on-plsql', () => {
    expectFires(
      'per-user-exchanged-plsql',
      'policy.per-user-exchanged-on-plsql',
      '/binding/credentialClass',
      /no per-user session inside the database/,
    );
  });

  it('the four-part stored-credential test fails NAMING each part that failed', () => {
    const failures = firedBy('four-part-test', 'policy.stored-credential-four-part-test');
    const parts = failures.map((f) => /part (\d) FAILED/.exec(f.message)?.[1]).sort();
    expect(parts).toEqual(['1', '2', '3', '4']);
    for (const f of failures) {
      expect(f.message).toMatch(/part \d FAILED \(/);
      expect(f.fix.length).toBeGreaterThan(0);
    }
    expect(failures.map((f) => f.path)).toEqual(
      expect.arrayContaining([
        '/binding/type',
        '/binding/identity/onServiceAccount',
        '/binding/identity/echoOn',
        '/binding/credentialRef',
      ]),
    );
  });
});

describe('rules — [P5] grants and consumers (CLAUDE.md #6, #7, #8)', () => {
  it('a plsql bindingGrant naming an APPS package fires policy.plsql-grant-wrapper-package', () => {
    expectFires(
      'plsql-grant-wrapper-package',
      'policy.plsql-grant-wrapper-package',
      '/bindingGrants/0/names/0',
      /must name a wrapper package, never an APPS-owned package/,
    );
  });

  it('a standingAuthorization with an unresolvable approvalRef and no expiresAt fires policy.standing-authorization', () => {
    expectFires(
      'standing-authorization',
      'policy.standing-authorization',
      '/bindingGrants/0/standingAuthorization',
      /does not resolve to a committed approval record/,
    );
    expectFires(
      'standing-authorization',
      'policy.standing-authorization',
      '/bindingGrants/0/expiresAt',
      /Grants expire/,
    );
  });

  it('a Consumer credential.ref that is not a secretRef:// URI fires policy.consumer-credential-ref', () => {
    expectFires(
      'consumer-credential-ref',
      'policy.consumer-credential-ref',
      '/credential/ref',
      /not a secretRef:\/\/ URI/,
    );
  });
});

describe('rules — the passing counterexample', () => {
  it('the valid fixture set raises no policy failure at all', () => {
    const failures = validateRepo(join(fixtures, 'valid')).failures;
    expect(failures).toEqual([]);
  });

  it('every policy rule id is distinct and every rule is exercised by a fixture', () => {
    const ids = POLICY_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 19 W0-B3 policy rules + the 2 W0-B8 segregation-of-duties rules
    // (sod.declared-conflict, sod.implicit-create-approve), which join the
    // same default set so `forge validate` runs them without opting in.
    expect(ids).toHaveLength(21);
    expect(ids).toContain('sod.declared-conflict');
    expect(ids).toContain('sod.implicit-create-approve');
  });

  it('every policy failure across every fixture carries the full quartet', () => {
    const sets = [
      'write-safety-incomplete',
      'irreversible-approval',
      'expedited-review',
      'identity-verified',
      'database-write',
      'plsql-wrapper-ref',
      'function-write-echo',
      'sibling-disambiguation',
      'purpose-word-budget',
      'param-desc-word-budget',
      'inline-enum-too-long',
      'calls-field',
      'eval-alias-leak',
      'stored-credential-verified',
      'per-user-exchanged-plsql',
      'four-part-test',
      'plsql-grant-wrapper-package',
      'standing-authorization',
      'consumer-credential-ref',
    ];
    for (const set of sets) {
      const failures = report(set).filter((f) => f.ruleId.startsWith('policy.'));
      expect(failures.length, `no policy failure at all for fixture "${set}"`).toBeGreaterThan(0);
      for (const f of failures) {
        expect(f.ruleId.length).toBeGreaterThan(0);
        expect(f.file.length).toBeGreaterThan(0);
        expect(f.path.length).toBeGreaterThan(0);
        expect(f.message.length).toBeGreaterThan(0);
        expect(f.fix.length).toBeGreaterThan(0);
        expect(f.fix).not.toMatch(/try again/i);
      }
    }
  });
});
