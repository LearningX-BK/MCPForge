// MCPForge — one-act revocation, proved. W0-N6, 02 §11.5 rule 6.
//
// The `done:` criterion: revoke "invalidates the value **and** kill-switches
// every dependent in the same operation, proved by asserting the dependents
// refuse rather than fail obscurely."
//
// "Refuse rather than fail obscurely" is the clause with teeth, and it is
// asserted here against the REAL kill-switch check (`killSwitchRefusalError`,
// which delegates to the one `notKillSwitchedPredicate` that owns the rule) —
// not against a boolean this test invented. A dependent must come back with a
// closed-taxonomy code, the revocation's own reason text, and a non-empty
// `next` (CLAUDE.md non-negotiable 5).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openRuntimeStore, type RuntimeStore } from '../store/server.js';
import { killSwitchRefusalError } from '../flags/checks.js';
import type { ScopeCatalogueEntry, ScopeContext } from '../scope/types.js';
import { EncryptedFileStore } from './encrypted-file.js';
import type { KeychainBackend } from './keychain.js';
import { secretRef, SecretStoreError } from './types.js';
import { findSecretDependents } from './dependents.js';
import { revokeSecret, SecretRevocationError } from './revocation.js';

// age's scrypt KDF runs on every seal and open.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const BINDING_REF = secretRef('binding', 'ebs-p2p-ap', 'wrapper-schema');
const CONSUMER_REF = secretRef('consumer', 'claude-desktop-coe', 'client');
const UNUSED_REF = secretRef('gateway', 'confirm-token', 'hmac');

const ACTOR = 'local:bikash';
const REASON = 'leaked in a support bundle';

let repoRoot: string;
let dbDir: string;
let runtime: RuntimeStore;
let vault: EncryptedFileStore;

/** In-memory keychain, so the vault tests the STORE and not the platform. */
function memoryKeychain(): KeychainBackend {
  const items = new Map<string, string>();
  return {
    kind: 'memory-test-double',
    get: (item: string) => Promise.resolve(items.get(item)),
    set: (item: string, value: string) => {
      items.set(item, value);
      return Promise.resolve();
    },
    delete: (item: string) => {
      items.delete(item);
      return Promise.resolve();
    },
    probe: () => Promise.resolve(true),
  } as unknown as KeychainBackend;
}

function writeToolManifest(id: string, credentialRef: string | null): void {
  const dir = join(repoRoot, 'manifests', 'ebs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.tool.yaml`),
    [
      'apiVersion: mcpforge/v1',
      'kind: Tool',
      `id: ${id}`,
      'binding:',
      '  type: plsql',
      '  technology: Oracle EBS wrapper package',
      '  ref: XX_MCPF_AP_WRAP',
      ...(credentialRef === null ? [] : [`  credentialRef: ${credentialRef}`]),
      '',
    ].join('\n'),
    'utf8',
  );
}

function writeConsumerRecord(id: string, credentialRef: string): void {
  const dir = join(repoRoot, 'consumers');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.consumer.yaml`),
    [
      'apiVersion: mcpforge/v1',
      'kind: Consumer',
      `id: ${id}`,
      'credential:',
      `  ref: ${credentialRef}`,
      '',
    ].join('\n'),
    'utf8',
  );
}

beforeEach(async () => {
  repoRoot = mkdtempSync(join(tmpdir(), 'mcpforge-revoke-repo-'));
  dbDir = mkdtempSync(join(tmpdir(), 'mcpforge-revoke-db-'));
  runtime = await openRuntimeStore({ kind: 'sqlite', file: join(dbDir, 'runtime.db') });
  vault = new EncryptedFileStore({ repoRoot, keychain: memoryKeychain(), env: {} });
});

afterEach(async () => {
  await runtime.close();
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(dbDir, { recursive: true, force: true });
});

describe('findSecretDependents — the exhaustive definition of "referencing it"', () => {
  it('finds a tool by binding.credentialRef and a consumer by credential.ref', () => {
    writeToolManifest('ebs.ap.voucher.create', BINDING_REF.uri);
    writeToolManifest('ebs.ap.voucher.cancel', BINDING_REF.uri);
    writeToolManifest('ebs.ap.invoice.search', null);
    writeConsumerRecord('claude-desktop-coe', CONSUMER_REF.uri);

    const scan = findSecretDependents(repoRoot, BINDING_REF.uri);
    expect(scan.failures).toEqual([]);
    expect(scan.dependents.map((d) => d.killTarget)).toEqual([
      'ebs.ap.voucher.cancel',
      'ebs.ap.voucher.create',
    ]);
    expect(scan.dependents.every((d) => d.kind === 'tool')).toBe(true);

    const consumerScan = findSecretDependents(repoRoot, CONSUMER_REF.uri);
    expect(consumerScan.dependents.map((d) => d.killTarget)).toEqual([
      'consumer:claude-desktop-coe',
    ]);
  });

  it('matches the WHOLE ref — a longer ref sharing a prefix is a different credential', () => {
    writeToolManifest('ebs.ap.voucher.create', `${BINDING_REF.uri}-readonly`);
    expect(findSecretDependents(repoRoot, BINDING_REF.uri).dependents).toEqual([]);
  });

  it('reports an unparseable artefact as a FAILURE and never as "no dependents"', () => {
    mkdirSync(join(repoRoot, 'manifests'), { recursive: true });
    writeFileSync(join(repoRoot, 'manifests', 'broken.tool.yaml'), 'id: [unclosed\n', 'utf8');
    const scan = findSecretDependents(repoRoot, BINDING_REF.uri);
    expect(scan.failures).toHaveLength(1);
    expect(scan.failures[0]?.file).toBe('manifests/broken.tool.yaml');
  });
});

describe('revokeSecret — kill switches FIRST, value destroyed second', () => {
  it('kill-switches every dependent and invalidates the value, in one call', async () => {
    writeToolManifest('ebs.ap.voucher.create', BINDING_REF.uri);
    writeConsumerRecord('claude-desktop-coe', BINDING_REF.uri);
    await vault.put(BINDING_REF, 'CANARY-do-not-log');

    const result = await revokeSecret({
      store: vault,
      ref: BINDING_REF,
      reason: REASON,
      actorSubject: ACTOR,
      repoRoot,
      flags: runtime.runtimeFlags,
      audit: runtime.audit,
      deploymentId: 'default',
    });

    expect(result.valueInvalidated).toBe(true);
    expect(result.killed.map((k) => k.dependent.killTarget)).toEqual([
      'consumer:claude-desktop-coe',
      'ebs.ap.voucher.create',
    ]);
    // Every kill wrote a real flag row AND a real audit row.
    for (const k of result.killed) {
      expect(k.flagId).toBeTruthy();
      expect(k.auditCallId).toBeTruthy();
    }

    // The value is gone: no path resolves it, and the ref is no longer listed.
    await expect(vault.get(BINDING_REF)).rejects.toBeInstanceOf(SecretStoreError);
    await expect(vault.metadata(BINDING_REF)).rejects.toBeInstanceOf(SecretStoreError);
    expect((await vault.list()).map((r) => r.uri)).not.toContain(BINDING_REF.uri);
  });

  it('the dependents REFUSE cleanly — a closed-taxonomy code, the reason, and a non-empty next', async () => {
    writeToolManifest('ebs.ap.voucher.create', BINDING_REF.uri);
    await vault.put(BINDING_REF, 'CANARY-do-not-log');

    await revokeSecret({
      store: vault,
      ref: BINDING_REF,
      reason: REASON,
      actorSubject: ACTOR,
      repoRoot,
      flags: runtime.runtimeFlags,
      audit: runtime.audit,
      deploymentId: 'default',
    });

    const flags = await runtime.runtimeFlags.listActive();
    const entry = {
      toolId: 'ebs.ap.voucher.create',
      serverId: 'ebs-p2p-ap',
      bindingType: 'plsql',
    } as unknown as ScopeCatalogueEntry;
    const ctx = {
      // The REAL flag rows, straight out of the store the revocation wrote to.
      flags: { activeFlags: () => flags },
      now: new Date(),
      session: { consumer: { consumerId: 'claude-desktop-coe' } },
      deployment: { deploymentId: 'default' },
    } as unknown as ScopeContext;

    const refusal = killSwitchRefusalError(entry, ctx, 'corr-revoke-1');
    expect(refusal).not.toBeNull();
    // Not a stack trace, not a generic failure: a named code, the revocation's
    // own words, and something the agent can DO.
    expect(refusal?.code).toBe('TOOL_DISABLED');
    expect(refusal?.message ?? '').toContain(REASON);
    expect(refusal?.message ?? '').toContain(BINDING_REF.uri);
    expect((refusal?.next ?? '').length).toBeGreaterThan(0);
    expect(refusal?.next).not.toMatch(/try again/i);
  });

  it('a ref with no dependents is revoked without ceremony and kills nothing', async () => {
    writeToolManifest('ebs.ap.voucher.create', BINDING_REF.uri);
    await vault.put(UNUSED_REF, 'CANARY-unused');

    const result = await revokeSecret({
      store: vault,
      ref: UNUSED_REF,
      reason: 'scheduled destruction',
      actorSubject: ACTOR,
      repoRoot,
      flags: runtime.runtimeFlags,
      audit: runtime.audit,
      deploymentId: 'default',
    });
    expect(result.killed).toEqual([]);
    expect(result.valueInvalidated).toBe(true);
    // And the unrelated tool was NOT kill-switched.
    const flags = await runtime.runtimeFlags.listActive();
    expect(flags.length).toBe(0);
  });
});

describe('revokeSecret — the refusals, each of which leaves the value alive', () => {
  it('refuses when a manifest could not be read, and kill-switches NOTHING', async () => {
    writeToolManifest('ebs.ap.voucher.create', BINDING_REF.uri);
    writeFileSync(join(repoRoot, 'manifests', 'broken.yaml'), 'a: [unclosed\n', 'utf8');
    await vault.put(BINDING_REF, 'CANARY-do-not-log');

    await expect(
      revokeSecret({
        store: vault,
        ref: BINDING_REF,
        reason: REASON,
        actorSubject: ACTOR,
        repoRoot,
        flags: runtime.runtimeFlags,
        audit: runtime.audit,
        deploymentId: 'default',
      }),
    ).rejects.toBeInstanceOf(SecretRevocationError);

    // Nothing killed, value intact: an incomplete dependent list must not
    // produce a partially-restricted system with a dead credential.
    expect((await runtime.runtimeFlags.listActive()).length).toBe(0);
    expect((await vault.metadata(BINDING_REF)).version).toBe(1);
  });

  it('refuses a ref the store does not hold, without kill-switching anything', async () => {
    writeToolManifest('ebs.ap.voucher.create', BINDING_REF.uri);
    let caught: SecretRevocationError | undefined;
    try {
      await revokeSecret({
        store: vault,
        ref: BINDING_REF,
        reason: REASON,
        actorSubject: ACTOR,
        repoRoot,
        flags: runtime.runtimeFlags,
        audit: runtime.audit,
        deploymentId: 'default',
      });
    } catch (err) {
      caught = err as SecretRevocationError;
    }
    expect(caught).toBeInstanceOf(SecretRevocationError);
    expect(caught?.next.length ?? 0).toBeGreaterThan(0);
    expect((await runtime.runtimeFlags.listActive()).length).toBe(0);
  });

  it('refuses an empty reason and an empty actor before touching anything', async () => {
    await vault.put(BINDING_REF, 'CANARY-do-not-log');
    const base = {
      store: vault,
      ref: BINDING_REF,
      repoRoot,
      flags: runtime.runtimeFlags,
      audit: runtime.audit,
      deploymentId: 'default',
    };
    await expect(
      revokeSecret({ ...base, reason: '   ', actorSubject: ACTOR }),
    ).rejects.toBeInstanceOf(SecretRevocationError);
    await expect(
      revokeSecret({ ...base, reason: REASON, actorSubject: '  ' }),
    ).rejects.toBeInstanceOf(SecretRevocationError);
    expect((await vault.metadata(BINDING_REF)).version).toBe(1);
  });

  it('when a kill fails part way, the value is NOT destroyed and the error names what was killed', async () => {
    writeToolManifest('ebs.ap.voucher.create', BINDING_REF.uri);
    writeToolManifest('ebs.ap.voucher.cancel', BINDING_REF.uri);
    await vault.put(BINDING_REF, 'CANARY-do-not-log');

    // The second kill throws. This is the half-state the ordering exists for.
    let calls = 0;
    const real = runtime.runtimeFlags;
    const flakyFlags: typeof real = {
      create: (input) => {
        calls += 1;
        if (calls === 2) return Promise.reject(new Error('simulated store outage'));
        return real.create(input);
      },
      get: (id) => real.get(id),
      listActive: () => real.listActive(),
      clear: (id, now) => real.clear(id, now),
    };

    let caught: SecretRevocationError | undefined;
    try {
      await revokeSecret({
        store: vault,
        ref: BINDING_REF,
        reason: REASON,
        actorSubject: ACTOR,
        repoRoot,
        flags: flakyFlags,
        audit: runtime.audit,
        deploymentId: 'default',
      });
    } catch (err) {
      caught = err as SecretRevocationError;
    }

    expect(caught).toBeInstanceOf(SecretRevocationError);
    expect(caught?.valueInvalidated).toBe(false);
    expect(caught?.killed.map((k) => k.dependent.killTarget)).toEqual(['ebs.ap.voucher.cancel']);
    expect(caught?.next).toContain('STILL WORKS');
    // The credential survives on purpose: restrictive-but-functional beats an
    // outage with a stack trace.
    expect((await vault.metadata(BINDING_REF)).version).toBe(1);
    // And the kill that DID land stays in force.
    expect((await runtime.runtimeFlags.listActive()).length).toBe(1);
  });
});
