// MCPForge — W0-E8 [P5] case 8: a binding declaring `module-scoped-stored`
// that fails any part of the four-part legitimacy test.
//
// CLAUDE.md non-negotiable #8: "A binding may hold a stored credential only
// when all four hold … If any of the four fails, it is a service-account
// fallback and item 1 forbids it." That is the escalation being attempted here:
// a manifest author who wants a shared module credential, and who satisfies
// three of the four parts and hopes the fourth is not checked.
//
// TWO LAYERS ENFORCE THIS. At RUNTIME (W0-P12, bottom of this file), stage 6e′
// refuses every call to a `module-scoped-stored` binding, because no executor
// this gateway builds can prove the four parts at call time. At AUTHORING
// time, and before a manifest can ever become a tool, `forge validate`'s
// `policy.stored-credential-four-part-test` rule (W0-B3,
// `core/codegen/src/rules/credentials.ts`, an OPUS_GUARDED_PATH). So this case
// is tested where the enforcement is: a manifest that fails the test is
// REJECTED, by name of the failing part, and therefore never reaches codegen,
// never becomes a handler, and never reaches a gateway to be called at all.
//
// This test runs the REAL rule set through the REAL `validateRepo` engine over
// a fixture repository under ./fixtures/. It is a second, independent caller of
// the same rules `core/codegen/src/rules/rules.test.ts` exercises — deliberately,
// because that suite proves the rule fires and this one proves the escalation
// path is closed, and a rule silently dropped from `POLICY_RULES` would fail
// here as well as there.

import { describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRepo } from '@mcpforge/codegen/validate';
import type { ValidationFailure } from '@mcpforge/codegen/validate';
import { loadRuntimeCatalogue } from '../../core/gateway/assembly/catalogue.js';
import {
  callThroughToolsCall,
  invokeThroughForgeInvoke,
} from '../../core/gateway/policy/entry-points.js';
import {
  call,
  context,
  defaultRoles,
  functionGrant,
  POLICY_CATALOGUE,
  role,
  TOOLS,
} from '../../core/gateway/policy/policy.fixtures.js';
import type { PolicyCatalogueEntry } from '../../core/gateway/policy/types.js';
import { consumer } from '../../core/gateway/scope/scope.fixtures.js';
import { expectFailsClosed, expectProceeds } from './harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const escalationRepo = join(here, 'fixtures', 'stored-credential-escalation');
// The repo's own known-good fixture set, used as the contrast: the rule must be
// capable of passing something, or "it rejects" would prove nothing.
const validRepo = join(here, '..', '..', 'core', 'codegen', 'src', 'rules', 'fixtures', 'valid');

const RULE_ID = 'policy.stored-credential-four-part-test';

function failures(repo: string, ruleId: string): readonly ValidationFailure[] {
  return validateRepo(repo).failures.filter((f) => f.ruleId === ruleId);
}

describe('W0-E8 [P5] case 8 — module-scoped-stored failing the four-part legitimacy test', () => {
  it('the manifest is REJECTED — forge validate does not accept it', () => {
    const report = validateRepo(escalationRepo);
    expect(report.ok).toBe(false);
    expect(failures(escalationRepo, RULE_ID).length).toBeGreaterThan(0);
  });

  it('it is rejected by NAME of each part that failed, not with one vague message', () => {
    const fired = failures(escalationRepo, RULE_ID);
    const messages = fired.map((f) => f.message).join('\n');

    // The fixture is the repo's own four-part-test fixture: a `function`
    // binding (part 1 — the type HAS a per-user identity path, so a stored
    // module credential there is substitution), `onServiceAccount:
    // readonly-lowsens` on a write tool (part 2 — it degrades instead of
    // failing closed), and `echoOn: never` (part 3 — nothing proves the
    // identity reached the target).
    expect(messages).toMatch(/part 1 FAILED/);
    expect(messages).toMatch(/part 2 FAILED/);
    expect(messages).toMatch(/part 3 FAILED/);

    // Every failure names its file, its JSON pointer and a real fix — a
    // rejection an author cannot act on is its own dead end (#5).
    for (const failure of fired) {
      expect(failure.file.length).toBeGreaterThan(0);
      expect(failure.path.startsWith('/')).toBe(true);
      expect(failure.fix.trim().length).toBeGreaterThan(0);
    }
  });

  it('the rejection says what it is: substitution, which #1 forbids', () => {
    const messages = failures(escalationRepo, RULE_ID)
      .map((f) => `${f.message} ${f.fix}`)
      .join('\n');
    expect(messages).toMatch(/substitution|per-user/i);
  });

  it('the rule is in the DEFAULT rule set — an escalating author cannot get past it by not opting in', () => {
    // `validateRepo` is called above with no rule argument at all, which is how
    // `forge validate` calls it. If the rule were opt-in, the assertions above
    // would report zero failures rather than failing loudly, so this asserts the
    // fail-closed direction explicitly.
    const withDefaults = validateRepo(escalationRepo).failures.map((f) => f.ruleId);
    expect(withDefaults).toContain(RULE_ID);
  });

  it('a compliant repository passes the same rule — the rejection is the four-part test, not a broken fixture', () => {
    expect(failures(validRepo, RULE_ID)).toEqual([]);
  });
});

// --- W0-P12: the RUNTIME half, replacing the tripwire that stood here ----------
//
// The tripwire asserted `core/gateway/secrets/**` did not exist and fired once
// it did. It is REPLACED by the runtime refusal it was waiting for, never
// loosened. Owner decision, 30 Sep 2026: fail closed until built. No executor
// this gateway builds can present a stored credential while proving the
// four-part test at call time, so stage 6e′ refuses EVERY call to a
// `module-scoped-stored` binding, through both entry points, before a plan
// can be minted. Each variant below fails a different part; the last one fails
// none, and is refused anyway, which is the point of "until built".

const STORED = TOOLS.voucherCreate;

/** The fixture catalogue with `STORED` redeclared under a given credential class and binding. */
function catalogueWith(overrides: Partial<PolicyCatalogueEntry>): readonly PolicyCatalogueEntry[] {
  return POLICY_CATALOGUE.map((e) => (e.toolId === STORED ? { ...e, ...overrides } : e));
}

/** Everything else says yes: the caller holds the tool AND a live grant for its binding. */
function permissiveContext(catalogue: readonly PolicyCatalogueEntry[], extra: object = {}) {
  const roles = new Map(defaultRoles());
  roles.set(
    'p2p',
    role({
      roleId: 'p2p',
      bindingGrants: [functionGrant(), functionGrant({ bindingType: 'plsql', names: ['PKG_AP'] })],
    }),
  );
  // The consumer may use plsql too, so for the plsql variants 6a′ says yes and
  // the ONLY thing refusing is the stored-credential rule at 6e′.
  const consumerOk = consumer({ authorizations: { bindingTypes: ['rest', 'function', 'plsql'] } });
  return context({ catalogue, roles, consumer: consumerOk, ...extra });
}

const VARIANTS: readonly { part: string; overrides: Partial<PolicyCatalogueEntry> }[] = [
  {
    part: 'part 1 fails: a function binding HAS a per-user path, so storage is substitution',
    overrides: { credentialClass: 'module-scoped-stored' },
  },
  {
    part: 'part 2 fails: a write that would degrade to a service account',
    overrides: {
      credentialClass: 'module-scoped-stored',
      bindingType: 'plsql',
      bindingRef: 'PKG_AP',
    },
  },
  {
    part: 'part 3 fails: nothing echoes the compensating control into audit',
    overrides: {
      credentialClass: 'module-scoped-stored',
      bindingType: 'plsql',
      bindingRef: 'PKG_AP',
    },
  },
  {
    part: 'part 4 fails: the credential is not scoped to one module and environment',
    overrides: {
      credentialClass: 'module-scoped-stored',
      bindingType: 'plsql',
      bindingRef: 'PKG_AP',
    },
  },
  {
    part: 'no part fails on paper, and it is STILL refused: nothing here can prove the four parts at call time',
    overrides: {
      credentialClass: 'module-scoped-stored',
      bindingType: 'plsql',
      bindingRef: 'PKG_AP',
    },
  },
];

describe('W0-P12 case 8 — the RUNTIME refusal, through BOTH entry points', () => {
  for (const { part, overrides } of VARIANTS) {
    it(`${part}: refused at 6e′ with TOOL_DISABLED and a next, identically through both`, async () => {
      const ctx = permissiveContext(catalogueWith(overrides));
      const viaToolsCall = await callThroughToolsCall(call(STORED, { amount: 100 }), ctx);
      const viaForgeInvoke = await invokeThroughForgeInvoke(call(STORED, { amount: 100 }), ctx);

      const refused = expectFailsClosed(viaToolsCall, { code: 'TOOL_DISABLED', stage: '6e′' });
      expect(refused.error.next).toMatch(/per-user-exchanged/);
      expect(refused.error.next.toLowerCase()).not.toContain('try again');
      expect(refused.error.message).toMatch(/service-account fallback/);
      expectFailsClosed(viaForgeInvoke, { code: 'TOOL_DISABLED', stage: '6e′' });
      expect(viaForgeInvoke).toEqual(viaToolsCall);
    });
  }

  it('no plan is made and no token minted: 6g and 6h are never reached, through either entry point', async () => {
    for (const entryPoint of [callThroughToolsCall, invokeThroughForgeInvoke]) {
      const writeGate = { evaluate: vi.fn(() => ({ kind: 'not-a-write' as const })) };
      const idempotency = { lookup: vi.fn(() => ({ kind: 'proceed' as const })) };
      const ctx = permissiveContext(catalogueWith({ credentialClass: 'module-scoped-stored' }), {
        runtime: { writeGate, idempotency },
      });
      expectFailsClosed(await entryPoint(call(STORED, { amount: 100 }), ctx), {
        code: 'TOOL_DISABLED',
        stage: '6e′',
      });
      expect(writeGate.evaluate).not.toHaveBeenCalled();
      expect(idempotency.lookup).not.toHaveBeenCalled();
    }
  });

  it('the refusal is the credential class and nothing else: per-user-exchanged proceeds past 6e′', async () => {
    const ctx = permissiveContext(catalogueWith({ credentialClass: 'per-user-exchanged' }));
    expectProceeds(await callThroughToolsCall(call(STORED, { amount: 100 }), ctx));
    expectProceeds(await invokeThroughForgeInvoke(call(STORED, { amount: 100 }), ctx));
  });

  it('the runtime catalogue carries credentialClass, and no committed tool is caught by this refusal', async () => {
    const catalogue = await loadRuntimeCatalogue({ repoRoot: join(here, '..', '..') });
    expect(catalogue.entries.length).toBeGreaterThan(0);
    expect(catalogue.entries.filter((e) => e.credentialClass === 'module-scoped-stored')).toEqual(
      [],
    );
  });
});
