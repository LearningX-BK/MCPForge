// MCPForge — W0-E8 [P5] case 8: a binding declaring `module-scoped-stored`
// that fails any part of the four-part legitimacy test.
//
// CLAUDE.md non-negotiable #8: "A binding may hold a stored credential only
// when all four hold … If any of the four fails, it is a service-account
// fallback and item 1 forbids it." That is the escalation being attempted here:
// a manifest author who wants a shared module credential, and who satisfies
// three of the four parts and hopes the fourth is not checked.
//
// WHICH LAYER ACTUALLY ENFORCES THIS TODAY (CLAUDE.md §8). There is no runtime
// path: `core/gateway/secrets/**`, the `SecretStore` seam and `secretRef://`
// resolution are the Track-N secrets tasks and have not landed — nothing at
// call time reads a `credentialClass` today. What DOES enforce it, and enforces
// it before a manifest can ever become a tool, is `forge validate`'s
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

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRepo } from '@mcpforge/codegen/validate';
import type { ValidationFailure } from '@mcpforge/codegen/validate';

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

  it('flagged for a human: no RUNTIME enforcement of credentialClass exists yet', () => {
    // Recorded as an assertion rather than a comment so it cannot quietly stop
    // being true: when `core/gateway/secrets/**` lands, this fails and this file
    // gains the runtime half of case 8.
    const gatewaySecrets = join(here, '..', '..', 'core', 'gateway', 'secrets');
    expect(
      existsSync(gatewaySecrets),
      'core/gateway/secrets/** now exists — case 8 needs a RUNTIME refusal test alongside the validate-time one.',
    ).toBe(false);
  });
});
