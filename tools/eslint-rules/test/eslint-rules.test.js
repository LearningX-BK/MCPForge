// MCPForge — W0-A3 proof: each guard rule fires on a crafted violation and
// stays silent on the legitimate near-miss. Every violation below lives only
// as a string inside this test, never as committed source `pnpm lint` would
// itself trip over.

import { RuleTester } from 'eslint';
import { describe, it, expect } from 'vitest';
import { rules } from '../src/index.js';
import { RETIRED_BRAND_STRINGS } from '../src/shared.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2024,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

// ---------------------------------------------------------------- rule 1
ruleTester.run('no-service-account-fallback', rules['no-service-account-fallback'], {
  valid: [
    // The named legitimate near-miss: a documentary URL, not a credential.
    { code: 'const serviceAccountDocsUrl = "https://docs.example/why-no-service-accounts";' },
    { code: 'const url = serviceAccountPolicyUrl;' },
    // The correct shape: unresolved identity is a hard failure.
    {
      code: 'function f(p) { const id = resolveTargetIdentity(p); if (!id) throw new ForgeError("IDENTITY_UNRESOLVED"); return id; }',
    },
    { code: 'const ref = "secretRef://binding/ebs-p2p-ap/wrapper-schema";' },
    { code: 'const LTM = 1; void LTM;' },
  ],
  invalid: [
    {
      code: 'const serviceAccountToken = process.env.SERVICE_ACCOUNT_TOKEN;',
      errors: [{ messageId: 'fallback' }, { messageId: 'fallback' }],
    },
    {
      code: 'const cred = fallbackCredential;',
      errors: [{ messageId: 'fallback' }],
    },
    {
      code: 'const id = resolveTargetIdentity(p) ?? sharedUser;',
      errors: [{ messageId: 'substitution' }, { messageId: 'fallback' }],
    },
  ],
});

// ---------------------------------------------------------------- rule 2
ruleTester.run('no-raw-color', rules['no-raw-color'], {
  valid: [
    // A hex inside tokens.primitives.css is the one legitimate home.
    {
      code: 'const css = "--coral-500: #E8552F;";',
      filename: 'core/portal/src/design/tokens.primitives.css',
    },
    {
      code: 'const bg = "var(--surface-raised)";',
      filename: 'core/portal/src/components/Card.tsx',
    },
  ],
  invalid: [
    {
      code: 'const style = { color: "#E8552F" };',
      filename: 'core/portal/src/components/Card.tsx',
      errors: [{ messageId: 'rawColor' }],
    },
    {
      code: 'const style = { color: "rgb(232, 85, 47)" };',
      filename: 'core/portal/src/components/Card.tsx',
      errors: [{ messageId: 'rawColor' }],
    },
    {
      code: 'const style = { color: `hsl(12 80% 55%)` };',
      filename: 'core/portal/src/components/Card.tsx',
      errors: [{ messageId: 'rawColor' }],
    },
    {
      code: 'const css = "--x: #E8552F;";',
      filename: 'core/portal/src/design/tokens.semantic.css',
      errors: [{ messageId: 'rawColor' }],
    },
  ],
});

// ---------------------------------------------------------------- rule 3
ruleTester.run('no-retired-brand-strings', rules['no-retired-brand-strings'], {
  valid: [
    { code: 'const owner = "LTM";' },
    { code: 'const team = "LTM · BlueVerse ValueMesh · Oracle AI Practice";' },
    { code: 'const product = "MCPForge";' },
    { code: 'const word = "comfort";' },
  ],
  invalid: RETIRED_BRAND_STRINGS.map((term) => ({
    code: `const s = ${JSON.stringify(term)};`,
    errors: [{ messageId: 'retired', data: { term } }],
  })),
});

describe('no-retired-brand-strings covers every named term', () => {
  it('blocks all eight', () => {
    expect(RETIRED_BRAND_STRINGS).toEqual([
      'LTIMindtree',
      'OraAIX',
      'OraFORGE',
      'OMF',
      '#FA5843',
      '#4FC3F7',
      '#B388FF',
      '#4ADE9B',
    ]);
  });
});

// ------------------------------------------------- rule 1, W0-N5 addendum
// W0-N5 — the macOS security(1) subcommand allowlist. Exact strings only.
ruleTester.run(
  'no-service-account-fallback (OS keychain subcommands)',
  rules['no-service-account-fallback'],
  {
    valid: [
      {
        code: "run('security', ['add-generic-password', '-U', '-a', item, '-w']);",
        filename: 'core/gateway/secrets/keychain.ts',
      },
      {
        code: "run('security', ['find-generic-password', '-a', item, '-w']);",
        filename: 'core/gateway/secrets/keychain.ts',
      },
    ],
    invalid: [
      // The allowlist is EXACT STRINGS, so the heuristic keeps its full force on
      // any name a human could actually choose: `genericPassword` still fires
      // even from inside the secrets module.
      {
        code: 'const genericPassword = resolve();',
        filename: 'core/gateway/secrets/keychain.ts',
        errors: [{ messageId: 'fallback' }],
      },
      {
        code: "const s = 'shared-token';",
        filename: 'core/gateway/policy/chain.ts',
        errors: [{ messageId: 'fallback' }],
      },
    ],
  },
);

// ---------------------------------------------------------------- rule 4
ruleTester.run('no-secret-value-escape', rules['no-secret-value-escape'], {
  valid: [
    {
      code: 'export async function run(secretStore, ref) { return secretStore.get(ref); }',
      filename: 'adapters/rest/src/binding.ts',
    },
    {
      code: 'export async function run(deps, ref) { return deps.secretStore.get(ref); }',
      filename: 'core/gateway/identity/src/exchange.ts',
    },
    // Reference-only members are safe everywhere.
    {
      code: 'export async function meta(secretStore, ref) { return secretStore.metadata(ref); }',
      filename: 'core/gateway/policy/src/chain.ts',
    },
    {
      code: 'export function pick(map, ref) { return map.get(ref); }',
      filename: 'core/gateway/policy/src/chain.ts',
    },
    // W0-N5 gate 2 — revealing is fine inside the two sanctioned trees.
    {
      code: 'export async function run(secretStore, ref) { const v = await secretStore.get(ref); return v.revealSecretValue(); }',
      filename: 'adapters/vendor/src/binding.ts',
    },
    // Holding and PASSING a SecretValue is safe anywhere — it redacts itself.
    {
      code: 'export function forward(secretValue) { log.info({ credential: secretValue }); return secretValue; }',
      filename: 'core/gateway/policy/src/chain.ts',
    },
  ],
  invalid: [
    {
      code: 'export async function leak(secretStore, ref) { return secretStore.get(ref); }',
      filename: 'core/gateway/policy/src/chain.ts',
      errors: [{ messageId: 'escape' }],
    },
    {
      code: 'class P { async run(ref) { return this.secretStore.get(ref); } }',
      filename: 'core/portal/src/server/secrets.ts',
      errors: [{ messageId: 'escape' }],
    },
    // W0-N5 gate 2. Matched by METHOD NAME on any receiver, so renaming the
    // variable — the loophole receiver-name detection always has — does not
    // evade it.
    {
      code: 'export function leak(v) { console.log(v.revealSecretValue()); }',
      filename: 'core/gateway/policy/src/chain.ts',
      errors: [{ messageId: 'reveal' }],
    },
    {
      code: 'export function leak(anything) { return anything.revealSecretValue(); }',
      filename: 'core/portal/src/app/page.tsx',
      errors: [{ messageId: 'reveal' }],
    },
  ],
});
