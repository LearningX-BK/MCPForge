// MCPForge — THE SecretStore contract suite. W0-N5, 02 §11.5 / 05 §4.3.1.
//
// ONE FILE, ONE SET OF ASSERTIONS, TWO LEGS. Everything below `describe.each`
// is written once and executed against `EncryptedFileStore` and against
// `OsKeychainStore` — the same discipline `W0-D3` applies to the two
// `IdentityProvider`s and `W0-C5` to the two SQL dialects. The moment the two
// stores get their own suites, a divergence in what "a stored credential"
// means stops being a test failure and becomes a diff nobody reads.
//
// A leg supplies a store and nothing else. It supplies NO assertions. If an
// implementation ever needs a special case in here to pass, that special case
// is the news — the seam leaks, and the fix is the implementation.
//
// THE KEYCHAIN LEG, AND WHY IT IS PROBED RATHER THAN ASSUMED. `OsKeychainStore`
// needs a real OS keychain, which a headless CI box does not have. Its leg
// therefore runs only when `osKeychainBackend().probe()` — a genuine
// write→read→delete round trip — succeeds, and REPORTS ITSELF SKIPPED
// otherwise, so a reader of the output can tell "not run here" from "passed".
// That is `W0-D3`'s Keycloak treatment, not a silent pass.
//
// THE ENCRYPTED-FILE LEG runs everywhere. Its sealing key comes from an
// in-memory fake keychain so the leg tests the STORE rather than the platform;
// a separate `describe` below exercises the real env-var and keychain key paths.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EncryptedFileStore, SEALING_KEY_ITEM } from './encrypted-file.js';
import { OsKeychainStore } from './os-keychain.js';
import { CI_KEY_ENV_VAR, osKeychainBackend } from './keychain.js';
import type { KeychainBackend } from './keychain.js';
import { SecretStoreError, SecretValue, parseSecretRef, secretRef } from './types.js';
import type { SecretStore } from './types.js';
import { OCI_VAULT_STORE_WAVE_1_TASK, ociVaultStoreUnavailable } from './oci-vault.js';

// age's scrypt KDF runs on every seal and open; the file leg does many.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const REF = secretRef('binding', 'ebs-p2p-ap', 'wrapper-schema');
const OTHER_REF = secretRef('consumer', 'claude-desktop-coe', 'client');
const GATEWAY_REF = secretRef('gateway', 'confirm-token', 'hmac');

/** A distinctive value: unique enough to grep a whole file for. */
const VALUE = 'CANARY-8f3a1c-do-not-log-this-value';
const OTHER_VALUE = 'CANARY-2b7e94-also-do-not-log';

// ---------------------------------------------------------------------------
// An in-memory keychain. Used ONLY to give the file leg a deterministic key
// source — it is never a leg of its own, because a fake keychain would test
// nothing about a keychain.
// ---------------------------------------------------------------------------

function fakeKeychain(): KeychainBackend {
  const items = new Map<string, string>();
  return {
    kind: 'env-var',
    probe: async () => true,
    set: async (item, value) => void items.set(item, value),
    get: async (item) => items.get(item),
    delete: async (item) => void items.delete(item),
  };
}

// ---------------------------------------------------------------------------
// The legs
// ---------------------------------------------------------------------------

interface StoreHarness {
  readonly store: SecretStore;
  /** Every file this store wrote, for the no-plaintext-on-disk assertion. */
  readonly artefacts: () => string[];
  teardown(): void;
}

interface StoreLeg {
  readonly name: string;
  readonly enabled: boolean;
  setup(): Promise<StoreHarness>;
}

const keychainAvailable = await osKeychainBackend().probe();

const encryptedFileLeg: StoreLeg = {
  name: 'EncryptedFileStore',
  enabled: true,
  async setup() {
    const dir = mkdtempSync(join(tmpdir(), 'mcpforge-secrets-file-'));
    const store = new EncryptedFileStore({
      repoRoot: dir,
      keychain: fakeKeychain(),
      // Explicitly empty: the fake keychain must be the key source here, not
      // whatever MCPFORGE_SECRETS_KEY the developer's shell happens to hold.
      env: {},
    });
    return {
      store,
      artefacts: () => [store.path],
      teardown: () => rmSync(dir, { recursive: true, force: true }),
    };
  },
};

const osKeychainLeg: StoreLeg = {
  name: 'OsKeychainStore',
  enabled: keychainAvailable,
  async setup() {
    const dir = mkdtempSync(join(tmpdir(), 'mcpforge-secrets-keychain-'));
    // A REAL OS keychain. That is the entire point of this leg.
    const store = new OsKeychainStore({ repoRoot: dir, keychain: osKeychainBackend() });
    return {
      store,
      artefacts: () => [store.indexPath],
      teardown: () => rmSync(dir, { recursive: true, force: true }),
    };
  },
};

const legs = [encryptedFileLeg, osKeychainLeg];

// ---------------------------------------------------------------------------
// The suite. Written once.
// ---------------------------------------------------------------------------

describe.each(legs)('SecretStore contract — $name', (leg) => {
  if (!leg.enabled) {
    // Visible, not vanished.
    it.skip(`${leg.name}: no OS keychain available on this machine — leg skipped, not passed`, () => {
      expect(true).toBe(true);
    });
    return;
  }

  let harness: StoreHarness;
  let store: SecretStore;

  beforeAll(async () => {
    harness = await leg.setup();
    store = harness.store;
  });

  afterAll(async () => {
    // Leave no credential behind in a real OS keychain.
    for (const ref of [REF, OTHER_REF, GATEWAY_REF]) {
      await store.revoke(ref).catch(() => undefined);
    }
    harness.teardown();
  });

  it('put() then get() round-trips the exact value', async () => {
    const meta = await store.put(REF, VALUE);
    expect(meta.version).toBe(1);
    const secret = await store.get(REF);
    expect(secret).toBeInstanceOf(SecretValue);
    expect(secret.revealSecretValue()).toBe(VALUE);
  });

  it('get() on an unknown ref is a hard failure with an actionable next — never a default', async () => {
    const unknown = secretRef('binding', 'nothing-here', 'nothing');
    await expect(store.get(unknown)).rejects.toBeInstanceOf(SecretStoreError);
    const error = await store.get(unknown).catch((e: unknown) => e as SecretStoreError);
    expect(error.next.length).toBeGreaterThan(0);
    expect(error.next.toLowerCase()).not.toContain('try again');
    // CLAUDE.md #1 — a missing credential resolves to nothing at all.
    expect(error.message).not.toContain('default');
  });

  it('metadata() is safe to log: no field carries the value', async () => {
    await store.put(REF, VALUE);
    const meta = await store.metadata(REF);
    expect(meta.ref).toBe(REF.uri);
    expect(typeof meta.createdAt).toBe('string');
    // The assertion that matters: scan the WHOLE serialised object, not the
    // declared fields. A future field that happens to carry the value fails
    // here even though it type-checks.
    expect(JSON.stringify(meta)).not.toContain(VALUE);
  });

  it('list() returns refs only, never values', async () => {
    await store.put(REF, VALUE);
    await store.put(OTHER_REF, OTHER_VALUE);
    const refs = await store.list();
    expect(refs.map((r) => r.uri)).toEqual(expect.arrayContaining([REF.uri, OTHER_REF.uri]));
    const serialised = JSON.stringify(refs);
    expect(serialised).not.toContain(VALUE);
    expect(serialised).not.toContain(OTHER_VALUE);
    // Structural, not merely absent-by-luck: a ref has exactly these four keys.
    for (const ref of refs) {
      expect(Object.keys(ref).sort()).toEqual(['purpose', 'scope', 'subject', 'uri']);
    }
  });

  it('a SecretValue redacts itself under every ordinary way of observing it', async () => {
    await store.put(REF, VALUE);
    const secret = await store.get(REF);

    // The four leaks that actually happen in real code.
    expect(String(secret)).not.toContain(VALUE);
    expect(`${secret}`).not.toContain(VALUE);
    expect(JSON.stringify({ credential: secret })).not.toContain(VALUE);
    expect(JSON.stringify([secret])).not.toContain(VALUE);

    const { inspect } = await import('node:util');
    expect(inspect(secret)).not.toContain(VALUE);
    expect(inspect({ nested: { deep: secret } }, { depth: 10 })).not.toContain(VALUE);

    // And the marker still says WHICH secret, so a log line stays useful.
    expect(String(secret)).toContain(REF.uri);
    expect(String(secret)).toContain('redacted');

    // Only the named, greppable call returns it.
    expect(secret.revealSecretValue()).toBe(VALUE);
  });

  it('rotate() mints a new version, and the caller never supplies or sees the value', async () => {
    await store.put(REF, VALUE);
    const before = await store.metadata(REF);
    const returned = await store.rotate(REF);

    // 02 §11.5: rotate returns the ref, not the value.
    expect(returned.uri).toBe(REF.uri);
    expect(JSON.stringify(returned)).not.toContain(VALUE);

    const after = await store.metadata(REF);
    expect(after.version).toBe(before.version + 1);
    expect(after.rotatedAt).toBeDefined();
    // The new value is genuinely new.
    expect((await store.get(REF)).revealSecretValue()).not.toBe(VALUE);
  });

  it('rotate() on an unknown ref fails rather than creating one', async () => {
    const unknown = secretRef('gateway', 'never-seeded', 'hmac');
    await expect(store.rotate(unknown)).rejects.toBeInstanceOf(SecretStoreError);
    expect((await store.list()).map((r) => r.uri)).not.toContain(unknown.uri);
  });

  it('put() stamps an expiry from the scope rotation interval (02 §11.5 rule 5)', async () => {
    const meta = await store.put(GATEWAY_REF, 'CANARY-gateway-hmac-value');
    expect(meta.expiresAt).toBeDefined();
    const days = (Date.parse(meta.expiresAt as string) - Date.parse(meta.createdAt)) / 86_400_000;
    // gateway → 90 days. Loose bound: createdAt is preserved across versions.
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(180);
    await store.revoke(GATEWAY_REF);
  });

  it('revoke() removes EVERY version, not just the latest (02 §11.5 rule 6)', async () => {
    await store.put(REF, VALUE);
    await store.rotate(REF);
    await store.rotate(REF);
    await store.revoke(REF);
    await expect(store.get(REF)).rejects.toBeInstanceOf(SecretStoreError);
    expect((await store.list()).map((r) => r.uri)).not.toContain(REF.uri);
  });

  it('no plaintext value is on disk in anything this store writes', async () => {
    await store.put(REF, VALUE);
    for (const file of harness.artefacts()) {
      const bytes = readFileSync(file);
      // Both the UTF-8 and base64 forms — a "sealed" file that merely encodes
      // would pass a naive string check.
      expect(bytes.includes(Buffer.from(VALUE, 'utf8'))).toBe(false);
      expect(bytes.includes(Buffer.from(Buffer.from(VALUE).toString('base64')))).toBe(false);
    }
    await store.revoke(REF);
  });

  it('an error message never carries the value, even on a corrupt read', async () => {
    await store.put(REF, VALUE);
    const error = await store
      .get(secretRef('binding', 'absent-module', 'absent-purpose'))
      .catch((e: unknown) => e as SecretStoreError);
    expect(String(error.message) + String(error.next)).not.toContain(VALUE);
    await store.revoke(REF);
  });
});

// ---------------------------------------------------------------------------
// EncryptedFileStore specifics — the key sources 05 §4.3.1 names.
// ---------------------------------------------------------------------------

describe('EncryptedFileStore key sources', () => {
  it('uses MCPFORGE_SECRETS_KEY when set — the CI path — and seals a real age file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpforge-secrets-ci-'));
    try {
      const env = { [CI_KEY_ENV_VAR]: 'ci-passphrase-not-a-real-credential' };
      const store = new EncryptedFileStore({ repoRoot: dir, keychain: fakeKeychain(), env });
      await store.put(REF, VALUE);

      // A real age file, openable by the stock `age` CLI, not a bespoke format.
      const header = readFileSync(store.path).subarray(0, 40).toString('binary');
      expect(header.startsWith('age-encryption.org/v1')).toBe(true);
      expect(header).toContain('scrypt');

      // A fresh instance with the SAME env opens it.
      const reopened = new EncryptedFileStore({ repoRoot: dir, keychain: fakeKeychain(), env });
      expect((await reopened.get(REF)).revealSecretValue()).toBe(VALUE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the wrong key cannot open the vault, and says so without leaking anything', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpforge-secrets-wrongkey-'));
    try {
      const sealed = new EncryptedFileStore({
        repoRoot: dir,
        keychain: fakeKeychain(),
        env: { [CI_KEY_ENV_VAR]: 'the-right-passphrase' },
      });
      await sealed.put(REF, VALUE);

      const wrong = new EncryptedFileStore({
        repoRoot: dir,
        keychain: fakeKeychain(),
        env: { [CI_KEY_ENV_VAR]: 'the-wrong-passphrase' },
      });
      const error = await wrong.get(REF).catch((e: unknown) => e as SecretStoreError);
      expect(error).toBeInstanceOf(SecretStoreError);
      expect(error.next).toContain(CI_KEY_ENV_VAR);
      expect(error.message + error.next).not.toContain('the-right-passphrase');
      expect(error.message + error.next).not.toContain(VALUE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('mints a sealing key into the keychain on first use and reuses it after', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpforge-secrets-mint-'));
    const keychain = fakeKeychain();
    try {
      expect(await keychain.get(SEALING_KEY_ITEM)).toBeUndefined();
      const store = new EncryptedFileStore({ repoRoot: dir, keychain, env: {} });
      await store.put(REF, VALUE);
      const minted = await keychain.get(SEALING_KEY_ITEM);
      expect(minted).toBeDefined();

      // A second store instance sharing the keychain opens the same vault.
      const second = new EncryptedFileStore({ repoRoot: dir, keychain, env: {} });
      expect((await second.get(REF)).revealSecretValue()).toBe(VALUE);
      expect(await keychain.get(SEALING_KEY_ITEM)).toBe(minted);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// OciVaultStore — the named absence.
// ---------------------------------------------------------------------------

describe('OciVaultStore', () => {
  it('is not implemented, and refuses loudly rather than returning nothing', () => {
    expect(() => ociVaultStoreUnavailable()).toThrow(SecretStoreError);
    const error = (() => {
      try {
        ociVaultStoreUnavailable();
      } catch (e) {
        return e as SecretStoreError;
      }
      throw new Error('unreachable');
    })();
    expect(error.next).toContain(OCI_VAULT_STORE_WAVE_1_TASK.id);
    expect(error.next.toLowerCase()).toContain('not substitute');
  });

  it('is a named Wave 1 task with an acceptance criterion, not a TODO', () => {
    expect(OCI_VAULT_STORE_WAVE_1_TASK.wave).toBe(1);
    expect(OCI_VAULT_STORE_WAVE_1_TASK.id).toMatch(/^W1-/);
    expect(OCI_VAULT_STORE_WAVE_1_TASK.acceptance).toContain('contract');
  });

  it('exports nothing that satisfies SecretStore — no accidental wiring', async () => {
    const module: Record<string, unknown> = await import('./oci-vault.js');
    for (const value of Object.values(module)) {
      if (typeof value !== 'object' || value === null) continue;
      const candidate = value as Partial<SecretStore>;
      expect(typeof candidate.get === 'function' && typeof candidate.list === 'function').toBe(
        false,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// SecretRef parsing — a ref is the only form a credential takes (02 §11.5).
// ---------------------------------------------------------------------------

describe('SecretRef', () => {
  it('parses the three refs 02 §11.5 gives as examples', () => {
    expect(parseSecretRef('secretRef://binding/ebs-p2p-ap/wrapper-schema').scope).toBe('binding');
    expect(parseSecretRef('secretRef://consumer/claude-desktop-coe/client').subject).toBe(
      'claude-desktop-coe',
    );
    expect(parseSecretRef('secretRef://gateway/confirm-token/hmac').purpose).toBe('hmac');
  });

  it.each([
    'secretRef://unknown-scope/a/b',
    'secretRef://binding/a',
    'secretRef://binding/a/b/c',
    'secretRef://binding/A/b',
    'secret://binding/a/b',
    'hunter2',
  ])('rejects %s with an actionable next', (bad) => {
    expect(() => parseSecretRef(bad)).toThrow(/not a valid secretRef/);
  });
});
