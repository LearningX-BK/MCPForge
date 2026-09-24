// MCPForge — the secret-value REACHABILITY proof. W0-N5, 02 §11.5 rule 2,
// CLAUDE.md non-negotiable #8.
//
// "SecretStore.get() may only be called inside adapters/** and
//  core/gateway/identity/** (lint rule: no-secret-value-escape)."
//
// The lint rule is the enforcement in the editor and in CI. THIS is the proof,
// and the two are not the same thing: a lint rule can be disabled per-file with
// a comment, scoped away in a config override, or simply not run. This test
// walks the repository's actual TypeScript source and asserts the boundary from
// the outside, the way `W0-D1`/`W0-D2`'s credential-leak tests do — it does not
// import the lint rule and cannot be silenced by an eslint-disable.
//
// THERE ARE TWO GATES ON THE VALUE, AND BOTH ARE CHECKED:
//   1. `SecretStore.get()` — returns a `SecretValue`, which is opaque.
//   2. `SecretValue.revealSecretValue()` — the ONLY way to the raw string.
// Gate 2 is the one that actually matters. Code outside the sanctioned trees
// may hold a `SecretValue` all day and cannot log it, serialise it, or
// interpolate it into anything; it can only pass it along. So the real
// question this file answers is: WHO CALLS revealSecretValue?
//
// THE POSITIVE CONTROL IS NOT OPTIONAL. Each scan asserts it found the call
// sites it is SUPPOSED to find before asserting it found none elsewhere. A
// regex that silently stopped matching would otherwise make this file pass
// forever while asserting nothing — the exact failure mode `W0-D3`'s comment
// on `tamper()` records from a real bug.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo-relative paths resolve from THIS FILE, never process.cwd(). Vitest's
// cwd depends on whether the run was launched from the repo root, from
// core/gateway, or by an editor — a cwd-relative fixture path is a test that
// passes on one developer's machine and not another's. (This exact bug shipped
// in W0-N3.)
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.git',
  '.forge-build',
  '.mcpforge',
  'generated', // codegen output, CI-verified byte-identical; never hand-written.
]);

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs'];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

/** POSIX-normalised, repo-relative. Windows separators would break every check. */
function repoPath(file: string): string {
  return relative(REPO_ROOT, file).replace(/\\/g, '/');
}

// 02 §11.5 rule 2's two trees, verbatim — plus the store's own implementation,
// which is where the value necessarily exists at all. The third entry is a
// structural fact (something has to read the vault), not a widening of the
// rule: everything under it is reviewed as OPUS_GUARDED_PATHS.
const SANCTIONED = [
  'adapters/',
  'core/gateway/identity/',
  'core/gateway/secrets/', // the seam itself
];

// The guard rule must NAME the pattern it forbids, so it is allowed to contain
// the string without calling it.
const RULE_SOURCES = ['tools/eslint-rules/'];

// EXACT top-level prefixes only. An earlier draft also matched `/${prefix}`
// anywhere in the path, which would have quietly sanctioned any nested
// directory that happened to be called `adapters/` — for instance
// `core/portal/src/adapters/`. A boundary check that can be widened by
// creating a directory with the right name is not a boundary check.
function isSanctioned(path: string): boolean {
  return SANCTIONED.some((prefix) => path.startsWith(prefix));
}

function isRuleSource(path: string): boolean {
  return RULE_SOURCES.some((prefix) => path.startsWith(prefix));
}

const ALL_SOURCES = sourceFiles(REPO_ROOT).map((file) => ({
  path: repoPath(file),
  text: readFileSync(file, 'utf8'),
}));

describe('secret-value reachability (02 §11.5 rule 2, CLAUDE.md #8)', () => {
  it('the scan actually walked the repository', () => {
    // If the walk broke, every assertion below would vacuously pass.
    expect(ALL_SOURCES.length).toBeGreaterThan(100);
    expect(ALL_SOURCES.map((s) => s.path)).toContain('core/gateway/secrets/types.ts');
    expect(ALL_SOURCES.map((s) => s.path)).toContain('core/gateway/identity/local.ts');
  });

  it('revealSecretValue() — the only path to a raw credential — is called nowhere outside the sanctioned trees', () => {
    const CALL = /\.revealSecretValue\s*\(/;
    const callers = ALL_SOURCES.filter((s) => CALL.test(s.text)).map((s) => s.path);

    // POSITIVE CONTROL: the scan must find the sanctioned call sites first.
    expect(callers).toContain('core/gateway/secrets/secrets.contract.test.ts');

    const offenders = callers.filter((p) => !isSanctioned(p) && !isRuleSource(p));
    expect(
      offenders,
      `revealSecretValue() returns a raw credential and may only be called inside ${SANCTIONED.join(
        ', ',
      )} (02 §11.5 rule 2). Offending files: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('SecretStore.get() is called nowhere outside the sanctioned trees', () => {
    // The lint rule's own detection shape: a `.get()` on a receiver whose name
    // ends in `secretStore` / `secret_store`, in any casing.
    const CALL = /(?:^|[\s.([{=,])[A-Za-z0-9_$.]*secret_?store\s*\.\s*get\s*\(/i;
    const callers = ALL_SOURCES.filter((s) => CALL.test(s.text)).map((s) => s.path);
    const offenders = callers.filter((p) => !isSanctioned(p) && !isRuleSource(p));
    expect(
      offenders,
      `SecretStore.get() may only be called inside ${SANCTIONED.join(', ')}. Offending files: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('the regex used above actually matches the shape it claims to (control)', () => {
    const CALL = /(?:^|[\s.([{=,])[A-Za-z0-9_$.]*secret_?store\s*\.\s*get\s*\(/i;
    // If this stops matching, the assertion above becomes decorative.
    expect(CALL.test('const v = await secretStore.get(ref);')).toBe(true);
    expect(CALL.test('await this.secretStore.get(ref)')).toBe(true);
    expect(CALL.test('deps.secrets.secretStore.get(ref)')).toBe(true);
    expect(CALL.test('await SecretStore.get(ref)')).toBe(true);
    // And does not fire on the things it must not.
    expect(CALL.test('await store.metadata(ref)')).toBe(false);
    expect(CALL.test('runtimeStore.get(key)')).toBe(false);
  });

  it('no source file outside the seam reads the vault or the keychain directly', () => {
    // Bypassing SecretStore entirely — reading .mcpforge/secrets.age, or
    // shelling out to the platform keychain tools — would route around every
    // gate above. The seam is the only door.
    const BYPASS = [
      /secrets\.age/,
      /\bsecret-tool\b/,
      /add-generic-password|find-generic-password/,
      /CredReadW|CredWriteW/,
    ];
    const offenders = ALL_SOURCES.filter(
      (s) =>
        BYPASS.some((re) => re.test(s.text)) &&
        !isSanctioned(s.path) &&
        // Only the guard rules themselves may name these patterns without
        // using them. `tools/` as a whole is NOT exempt — a build-lane script
        // reading the vault would be exactly the bypass this asserts against.
        !isRuleSource(s.path),
    ).map((s) => s.path);
    expect(
      offenders,
      `The vault and the OS keychain are reachable only through core/gateway/secrets/**. Offending files: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('the SecretValue class exposes exactly one way out, and it is the named one', async () => {
    const { SecretValue, secretRef } = await import('./types.js');
    const value = new SecretValue(secretRef('gateway', 'confirm-token', 'hmac'), 1, 'CANARY-xyz');

    // Every own and inherited property, walked. Anything that hands back the
    // raw string other than revealSecretValue() is a second door.
    const names = new Set<string>();
    for (
      let o: object | null = value;
      o !== null && o !== Object.prototype;
      o = Object.getPrototypeOf(o) as object | null
    ) {
      for (const name of Object.getOwnPropertyNames(o)) names.add(name);
    }

    const leaks: string[] = [];
    for (const name of names) {
      if (name === 'constructor' || name === 'revealSecretValue') continue;
      let observed: unknown;
      try {
        const member = (value as unknown as Record<string, unknown>)[name];
        observed = typeof member === 'function' ? (member as () => unknown).call(value) : member;
      } catch {
        continue;
      }
      if (typeof observed === 'string' && observed.includes('CANARY-xyz')) leaks.push(name);
    }
    expect(leaks, `These members return the raw credential: ${leaks.join(', ')}`).toEqual([]);

    // #value is a true private field: not enumerable, not reachable by name.
    expect(Object.keys(value)).not.toContain('value');
    expect((value as unknown as Record<string, unknown>)['value']).toBeUndefined();
    expect(value.revealSecretValue()).toBe('CANARY-xyz');
  });

  it('the lint rule agrees with this file about which trees are sanctioned', async () => {
    const shared: { isSecretValueAllowedPath(f: string): boolean } =
      await import('../../../tools/eslint-rules/src/shared.js');
    // CLAUDE.md #8 names exactly two trees; the rule must still say so.
    expect(shared.isSecretValueAllowedPath('adapters/rest/binding.ts')).toBe(true);
    expect(shared.isSecretValueAllowedPath('core/gateway/identity/local.ts')).toBe(true);
    expect(shared.isSecretValueAllowedPath('core/gateway/policy/chain.ts')).toBe(false);
    expect(shared.isSecretValueAllowedPath('core/portal/src/app/page.tsx')).toBe(false);
  });
});
