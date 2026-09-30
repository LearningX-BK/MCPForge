// MCPForge — `forge secrets status | rotate | revoke`, W0-N6, end to end.
//
// Two layers, matching ./kill.test.ts: the command functions against an
// isolated vault and an isolated runtime store, and the real `forge` binary
// spawned as a child process to prove the `program.ts` wiring, the
// positional-argument plumbing and the `--json` contract.
//
// Fixture paths are resolved from `import.meta.url`, never from
// `process.cwd()` — a repo-relative path taken from the working directory is
// the exact bug W0-N3 shipped, and vitest's cwd is not this file's directory.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openRuntimeStore, type RuntimeStore } from '@mcpforge/gateway/store/server';
import { EncryptedFileStore, secretRef } from '@mcpforge/gateway/secrets/server';
import type { KeychainBackend } from '@mcpforge/gateway/secrets/server';
import { runSecretsCommand, type SecretsStatusEnvelope } from './secrets.js';

// age's scrypt KDF runs on every seal and open.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPackageRoot = path.join(here, '..', '..');
const binPath = path.join(cliPackageRoot, 'bin', 'forge.js');

const CONSUMER_REF = secretRef('consumer', 'claude-desktop-coe', 'client');
const BINDING_REF = secretRef('binding', 'ebs-p2p-ap', 'wrapper-schema');
const DAY = 86_400_000;

let repoRoot: string;
let dbDir: string;
let runtime: RuntimeStore;
let vault: EncryptedFileStore;
let stdout: string[];
let stderr: string[];

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

/** A vault whose writes are stamped at a chosen instant, so ages are exact. */
function vaultAt(when: Date, keychain: KeychainBackend): EncryptedFileStore {
  return new EncryptedFileStore({ repoRoot, keychain, env: {}, now: () => when });
}

function writeToolManifest(id: string, credentialRef: string): void {
  const dir = path.join(repoRoot, 'manifests', 'ebs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${id}.tool.yaml`),
    [
      'apiVersion: mcpforge/v1',
      'kind: Tool',
      `id: ${id}`,
      'binding:',
      '  type: plsql',
      '  technology: Oracle EBS wrapper package',
      '  ref: XX_MCPF_AP_WRAP',
      `  credentialRef: ${credentialRef}`,
      '',
    ].join('\n'),
    'utf8',
  );
}

beforeEach(async () => {
  repoRoot = mkdtempSync(path.join(tmpdir(), 'mcpforge-secrets-cli-repo-'));
  dbDir = mkdtempSync(path.join(tmpdir(), 'mcpforge-secrets-cli-db-'));
  runtime = await openRuntimeStore({ kind: 'sqlite', file: path.join(dbDir, 'runtime.db') });
  vault = new EncryptedFileStore({ repoRoot, keychain: memoryKeychain(), env: {} });
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await runtime.close();
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(dbDir, { recursive: true, force: true });
});

/**
 * The shared runtime store, wrapped so the command's own `finally { close() }`
 * does not close the handle this test still needs to assert against. The
 * command genuinely owns the store it opens; a test that lends it one has to
 * lend the lifecycle too.
 */
function borrowedRuntime(): RuntimeStore {
  return { ...runtime, close: () => Promise.resolve() } as RuntimeStore;
}

function jsonOut<T>(): T {
  return JSON.parse(stdout.join('').trim()) as T;
}

describe('forge secrets status', () => {
  it('reports age, interval and next-due for every ref, and exits 0 when nothing is critical', async () => {
    const keychain = memoryKeychain();
    const now = new Date('2026-09-07T00:00:00.000Z');
    // 10 days old: comfortably inside the 90-day consumer interval.
    await vaultAt(new Date(now.getTime() - 10 * DAY), keychain).put(CONSUMER_REF, 'CANARY-a');

    const code = await runSecretsCommand(
      'status',
      { json: true },
      { repoRoot, secretStore: vaultAt(now, keychain), now: () => now },
    );
    expect(code).toBe(0);

    const report = jsonOut<SecretsStatusEnvelope>();
    expect(report.ok).toBe(true);
    expect(report.secrets).toHaveLength(1);
    const [only] = report.secrets;
    expect(only?.ref).toBe(CONSUMER_REF.uri);
    expect(only?.ageDays).toBe(10);
    expect(only?.intervalDays).toBe(90);
    expect(only?.nextDueAt).toBe(new Date(now.getTime() + 80 * DAY).toISOString());
    expect(only?.state).toBe('ok');
    expect(report.anyCritical).toBe(false);
    // Not one credential value anywhere in the output.
    expect(stdout.join('')).not.toContain('CANARY-a');
  });

  it('EXITS NON-ZERO when any ref is past 2x its rotation interval', async () => {
    const keychain = memoryKeychain();
    const now = new Date('2026-09-07T00:00:00.000Z');
    // 200 days on a 90-day consumer interval: past 2x (180).
    await vaultAt(new Date(now.getTime() - 200 * DAY), keychain).put(CONSUMER_REF, 'CANARY-a');
    // 200 days on a 180-day binding interval: overdue, but NOT past 2x.
    await vaultAt(new Date(now.getTime() - 200 * DAY), keychain).put(BINDING_REF, 'CANARY-b');

    const code = await runSecretsCommand(
      'status',
      { json: true },
      { repoRoot, secretStore: vaultAt(now, keychain), now: () => now },
    );
    expect(code).toBe(1);

    const report = jsonOut<SecretsStatusEnvelope>();
    expect(report.counts).toEqual({ ok: 0, overdue: 1, critical: 1 });
    expect(report.anyCritical).toBe(true);
    expect(report.secrets.find((s) => s.ref === CONSUMER_REF.uri)?.state).toBe('critical');
    expect(report.secrets.find((s) => s.ref === BINDING_REF.uri)?.state).toBe('overdue');
  });

  it('exits 0 on an empty store rather than treating "no credentials" as a finding', async () => {
    const code = await runSecretsCommand(
      'status',
      { json: true },
      { repoRoot, secretStore: vault },
    );
    expect(code).toBe(0);
    expect(jsonOut<SecretsStatusEnvelope>().secrets).toEqual([]);
  });

  it('the human rendering names the overdue refs and tells the operator what to do', async () => {
    const keychain = memoryKeychain();
    const now = new Date('2026-09-07T00:00:00.000Z');
    await vaultAt(new Date(now.getTime() - 400 * DAY), keychain).put(CONSUMER_REF, 'CANARY-a');
    const code = await runSecretsCommand(
      'status',
      { json: false },
      { repoRoot, secretStore: vaultAt(now, keychain), now: () => now },
    );
    expect(code).toBe(1);
    const text = stdout.join('');
    expect(text).toContain(CONSUMER_REF.uri);
    expect(text).toContain('forge secrets rotate');
    expect(text).not.toContain('CANARY-a');
  });
});

describe('forge secrets rotate', () => {
  it('rotates the value, bumps the version, and never prints it', async () => {
    await vault.put(BINDING_REF, 'CANARY-original');
    const code = await runSecretsCommand(
      'rotate',
      { json: true, target: BINDING_REF.uri },
      { repoRoot, secretStore: vault },
    );
    expect(code).toBe(0);
    const out = jsonOut<{ version: number; ref: string; overlapNote: string | null }>();
    expect(out.ref).toBe(BINDING_REF.uri);
    expect(out.version).toBe(2);
    expect(out.overlapNote).toBeNull(); // not a gateway signing key
    expect(stdout.join('')).not.toContain('CANARY-original');
    expect((await vault.metadata(BINDING_REF)).version).toBe(2);
  });

  it('names the dual-key overlap window when rotating a gateway signing key', async () => {
    const hmac = secretRef('gateway', 'confirm-token', 'hmac');
    await vault.put(hmac, 'CANARY-hmac');
    await runSecretsCommand(
      'rotate',
      { json: true, target: hmac.uri },
      { repoRoot, secretStore: vault },
    );
    const note = jsonOut<{ overlapNote: string | null }>().overlapNote ?? '';
    expect(note).toContain('VERIFIES');
    expect(note).toContain('no longer SIGNS');
  });

  it('refuses a malformed ref with INPUT_INVALID and an actionable next, exit 64', async () => {
    const code = await runSecretsCommand(
      'rotate',
      { json: true, target: 'not-a-ref' },
      { repoRoot, secretStore: vault },
    );
    expect(code).toBe(64);
    const err = jsonOut<{ ok: boolean; code: string; next: string }>();
    expect(err.ok).toBe(false);
    expect(err.code).toBe('INPUT_INVALID');
    expect(err.next.length).toBeGreaterThan(0);
    expect(err.next).not.toMatch(/try again/i);
  });

  it('refuses a missing ref rather than rotating something arbitrary', async () => {
    const code = await runSecretsCommand(
      'rotate',
      { json: true },
      { repoRoot, secretStore: vault },
    );
    expect(code).toBe(64);
    expect(jsonOut<{ code: string }>().code).toBe('INPUT_INVALID');
  });

  it("refuses to rotate a ref the store does not hold, with the store's own next", async () => {
    const code = await runSecretsCommand(
      'rotate',
      { json: true, target: BINDING_REF.uri },
      { repoRoot, secretStore: vault },
    );
    expect(code).toBe(64);
    expect(jsonOut<{ next: string }>().next).toContain('forge');
  });
});

describe('forge secrets revoke', () => {
  it('invalidates the value AND kill-switches every dependent, in one call', async () => {
    writeToolManifest('ebs.ap.voucher.create', BINDING_REF.uri);
    await vault.put(BINDING_REF, 'CANARY-do-not-log');

    const code = await runSecretsCommand(
      'revoke',
      { json: true, target: BINDING_REF.uri, reason: 'leaked', by: 'local:bikash' },
      { repoRoot, secretStore: vault, openStore: () => Promise.resolve(borrowedRuntime()) },
    );
    expect(code).toBe(0);

    const out = jsonOut<{
      valueInvalidated: boolean;
      killed: readonly { killTarget: string; flagId: string }[];
    }>();
    expect(out.valueInvalidated).toBe(true);
    expect(out.killed.map((k) => k.killTarget)).toEqual(['ebs.ap.voucher.create']);
    expect(out.killed[0]?.flagId).toBeTruthy();
    expect((await runtime.runtimeFlags.listActive()).length).toBe(1);
    expect((await vault.list()).map((r) => r.uri)).not.toContain(BINDING_REF.uri);
    expect(stdout.join('')).not.toContain('CANARY-do-not-log');
  });

  it('requires --reason and --by, exit 64, before touching the vault', async () => {
    await vault.put(BINDING_REF, 'CANARY-do-not-log');
    const deps = {
      repoRoot,
      secretStore: vault,
      openStore: () => Promise.resolve(borrowedRuntime()),
    };

    expect(
      await runSecretsCommand('revoke', { json: true, target: BINDING_REF.uri, by: 'x' }, deps),
    ).toBe(64);
    stdout = [];
    expect(
      await runSecretsCommand(
        'revoke',
        { json: true, target: BINDING_REF.uri, reason: 'leaked' },
        deps,
      ),
    ).toBe(64);
    // Nothing destroyed, nothing kill-switched.
    expect((await vault.metadata(BINDING_REF)).version).toBe(1);
    expect((await runtime.runtimeFlags.listActive()).length).toBe(0);
  });

  it('refuses cleanly (REVOCATION_REFUSED + next) when a manifest cannot be read', async () => {
    writeToolManifest('ebs.ap.voucher.create', BINDING_REF.uri);
    writeFileSync(path.join(repoRoot, 'manifests', 'broken.yaml'), 'a: [unclosed\n', 'utf8');
    await vault.put(BINDING_REF, 'CANARY-do-not-log');

    const code = await runSecretsCommand(
      'revoke',
      { json: true, target: BINDING_REF.uri, reason: 'leaked', by: 'local:bikash' },
      { repoRoot, secretStore: vault, openStore: () => Promise.resolve(borrowedRuntime()) },
    );
    expect(code).toBe(64);
    const err = jsonOut<{ code: string; next: string; valueInvalidated: boolean }>();
    expect(err.code).toBe('REVOCATION_REFUSED');
    expect(err.valueInvalidated).toBe(false);
    expect(err.next.length).toBeGreaterThan(0);
    // The value survives an incomplete scan, deliberately.
    expect((await vault.metadata(BINDING_REF)).version).toBe(1);
    expect((await runtime.runtimeFlags.listActive()).length).toBe(0);
  });
});

describe('forge secrets put (W0-P26)', () => {
  const VALUE = 'client-secret-value-p26-do-not-print';

  function writeOverlay(ref: string): void {
    const dir = path.join(repoRoot, 'overlays', 'local');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'ais-targets.yaml'),
      `targets:\n  - clientCredentialRef: ${ref}\n`,
      'utf8',
    );
  }

  /** A store double that records what `put` was handed; no value is read back. */
  function recordingStore(): { store: EncryptedFileStore; puts: { uri: string; value: string }[] } {
    const puts: { uri: string; value: string }[] = [];
    const store = new Proxy(vault, {
      get(target, prop, receiver) {
        if (prop === 'put') {
          return async (ref: { uri: string }, value: string) => {
            puts.push({ uri: ref.uri, value });
            return target.put(ref as never, value);
          };
        }
        const v = Reflect.get(target, prop, receiver) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    return { store, puts };
  }

  function put(
    opts: Record<string, unknown>,
    deps: { value?: string; env?: Record<string, string>; store?: EncryptedFileStore } = {},
  ): Promise<number> {
    return runSecretsCommand(
      'put',
      { json: true, target: BINDING_REF.uri, ...opts },
      {
        secretStore: deps.store ?? vault,
        repoRoot,
        env: deps.env ?? {},
        readValue: () => Promise.resolve(deps.value ?? VALUE),
      },
    );
  }

  function allOutput(): string {
    return stdout.join('') + stderr.join('');
  }

  it('stores a binding credential the overlay names, from stdin, and prints no value', async () => {
    writeOverlay(BINDING_REF.uri);
    const { store, puts } = recordingStore();
    expect(await put({}, { store })).toBe(0);
    const out = jsonOut<{ ok: boolean; version: number; replaced: boolean; next: string }>();
    expect(out.ok).toBe(true);
    expect(out.version).toBe(1);
    expect(out.replaced).toBe(false);
    expect(out.next).toContain('overlays/local/ais-targets.yaml');
    expect(puts).toEqual([{ uri: BINDING_REF.uri, value: VALUE }]);
    expect(allOutput()).not.toContain(VALUE);
  });

  it('reads --from-file, dropping one trailing newline', async () => {
    writeOverlay(BINDING_REF.uri);
    const file = path.join(dbDir, 'value.txt');
    writeFileSync(file, `${VALUE}\n`, 'utf8');
    const { store, puts } = recordingStore();
    expect(await put({ fromFile: file }, { store })).toBe(0);
    expect(puts[0]!.value).toBe(VALUE);
    expect(allOutput()).not.toContain(VALUE);
  });

  it('refuses when CI=true, before reading anything', async () => {
    writeOverlay(BINDING_REF.uri);
    const readValue = vi.fn(() => Promise.resolve(VALUE));
    const code = await runSecretsCommand(
      'put',
      { json: true, target: BINDING_REF.uri },
      { secretStore: vault, repoRoot, env: { CI: 'true' }, readValue },
    );
    expect(code).toBe(1);
    expect(jsonOut<{ code: string }>().code).toBe('POLICY_GUARDRAIL_BREACH');
    expect(readValue).not.toHaveBeenCalled();
    expect(await vault.list()).toEqual([]);
  });

  it('refuses a malformed ref with INPUT_INVALID and a next', async () => {
    expect(await put({ target: 'binding/not-a-ref' })).toBe(64);
    const err = jsonOut<{ code: string; next: string }>();
    expect(err.code).toBe('INPUT_INVALID');
    expect(err.next.length).toBeGreaterThan(0);
  });

  it('refuses a consumer or gateway ref, naming the command that does mint it', async () => {
    writeOverlay(CONSUMER_REF.uri);
    expect(await put({ target: CONSUMER_REF.uri })).toBe(1);
    expect(jsonOut<{ next: string }>().next).toContain('issue-credential');
    expect(await vault.list()).toEqual([]);
  });

  it('refuses a ref the overlay does not name, including a longer look-alike', async () => {
    writeOverlay(`${BINDING_REF.uri}-2`);
    expect(await put({})).toBe(1);
    expect(jsonOut<{ message: string }>().message).toContain('names');
    expect(await vault.list()).toEqual([]);
  });

  it('refuses to replace an existing value without --replace, and makes version 2 with it', async () => {
    writeOverlay(BINDING_REF.uri);
    expect(await put({})).toBe(0);
    stdout.length = 0;
    expect(await put({})).toBe(1);
    expect(jsonOut<{ next: string }>().next).toContain('--replace');
    expect((await vault.metadata(BINDING_REF)).version).toBe(1);
    stdout.length = 0;
    expect(await put({ replace: true })).toBe(0);
    expect(jsonOut<{ version: number; replaced: boolean }>()).toMatchObject({
      version: 2,
      replaced: true,
    });
  });

  it('refuses an empty value and stores nothing', async () => {
    writeOverlay(BINDING_REF.uri);
    expect(await put({}, { value: '' })).toBe(64);
    expect(await vault.list()).toEqual([]);
  });

  it('refuses an unreadable --from-file without a stack trace', async () => {
    writeOverlay(BINDING_REF.uri);
    expect(await put({ fromFile: path.join(dbDir, 'missing.txt') })).toBe(64);
    expect(jsonOut<{ message: string }>().message).toContain('ENOENT');
  });
});

describe('the wired binary', () => {
  function forge(args: string[]): { stdout: string; stderr: string; status: number | null } {
    const result = spawnSync(process.execPath, [binPath, ...args], {
      encoding: 'utf-8',
      cwd: cliPackageRoot,
      env: {
        ...process.env,
        MCPFORGE_STORE_KIND: 'sqlite',
        MCPFORGE_STORE_FILE: path.join(dbDir, 'runtime.db'),
      },
    });
    return { stdout: result.stdout, stderr: result.stderr, status: result.status };
  }

  it('exposes secrets status | rotate | revoke in the help tree', () => {
    const help = forge(['secrets', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('status');
    expect(help.stdout).toContain('rotate');
    expect(help.stdout).toContain('revoke');
  });

  it('runs `secrets status --json` against a real (empty) repo root and exits 0', () => {
    const run = forge(['secrets', 'status', '--json', '--root', repoRoot]);
    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout.trim()) as SecretsStatusEnvelope;
    expect(parsed.ok).toBe(true);
    expect(parsed.secrets).toEqual([]);
  });

  it('`secrets revoke` without --reason exits 64 with a JSON INPUT_INVALID envelope', () => {
    const run = forge([
      'secrets',
      'revoke',
      'secretRef://binding/ebs-p2p-ap/wrapper-schema',
      '--json',
      '--root',
      repoRoot,
    ]);
    expect(run.status).toBe(64);
    const parsed = JSON.parse(run.stdout.trim()) as { code: string; next: string };
    expect(parsed.code).toBe('INPUT_INVALID');
    expect(parsed.next).toContain('--reason');
  });
});
