// MCPForge — `forge kill`, W0-E5, end to end.
//
// Two layers, matching audit.test.ts and identity.test.ts: the command
// function against an isolated temp-file store, and the real `forge` binary
// spawned as a child process to prove the `program.ts` wiring, the
// positional-argument plumbing, and the `--json` contract.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRuntimeStore, type RuntimeStore } from '@mcpforge/gateway/store/server';
import { runKillCommand, type KillReport } from './kill.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(here, '..', '..', 'bin', 'forge.js');

let tempDir: string;
let dbFile: string;
let store: RuntimeStore;

function forge(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    encoding: 'utf-8',
    cwd: path.join(here, '..', '..'),
    env: { ...process.env, MCPFORGE_STORE_KIND: 'sqlite', MCPFORGE_STORE_FILE: dbFile },
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

beforeEach(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'mcpforge-kill-cli-'));
  dbFile = path.join(tempDir, 'runtime.db');
  store = await openRuntimeStore({ kind: 'sqlite', file: dbFile });
});

afterEach(async () => {
  await store.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('runKillCommand (in-process, isolated store)', () => {
  it('writes a runtime_flags row and an audit record for a bare tool id (tool scope)', async () => {
    let out = '';
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      out += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    let code: number;
    try {
      code = await runKillCommand(
        'jde.ap.voucher.create',
        { json: true, reason: 'binding regression', by: 'ops-bikash' },
        { openStore: () => openRuntimeStore({ kind: 'sqlite', file: dbFile }) },
      );
    } finally {
      process.stdout.write = original;
    }
    expect(code).toBe(0);
    const report = JSON.parse(out) as KillReport;
    expect(report.ok).toBe(true);
    expect(report.scope).toBe('tool');
    expect(report.resolvedTarget).toBe('jde.ap.voucher.create');

    const flags = await store.runtimeFlags.listActive();
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ scope: 'tool', target: 'jde.ap.voucher.create' });

    const auditRow = await store.audit.get(report.auditCallId);
    expect(auditRow).toMatchObject({ callerSubject: 'ops-bikash', outcome: 'ok' });
  });

  it('rejects a missing --reason with INPUT_INVALID (exit 64)', async () => {
    const code = await runKillCommand(
      'jde.ap.voucher.create',
      { json: true, by: 'ops-bikash' },
      { openStore: () => openRuntimeStore({ kind: 'sqlite', file: dbFile }) },
    );
    expect(code).toBe(64);
  });

  it('rejects a missing --by with INPUT_INVALID (exit 64) — no default acting identity', async () => {
    const code = await runKillCommand(
      'jde.ap.voucher.create',
      { json: true, reason: 'r' },
      { openStore: () => openRuntimeStore({ kind: 'sqlite', file: dbFile }) },
    );
    expect(code).toBe(64);
  });

  it('rejects an unparseable --until', async () => {
    const code = await runKillCommand(
      'jde.ap.voucher.create',
      { json: true, reason: 'r', by: 'ops-bikash', until: 'not-a-date' },
      { openStore: () => openRuntimeStore({ kind: 'sqlite', file: dbFile }) },
    );
    expect(code).toBe(64);
  });

  it('consumer:<id> kills at consumer scope', async () => {
    const code = await runKillCommand(
      'consumer:agent-x',
      { json: true, reason: 'burst-write anomaly', by: 'ops-bikash' },
      { openStore: () => openRuntimeStore({ kind: 'sqlite', file: dbFile }) },
    );
    expect(code).toBe(0);
    const flags = await store.runtimeFlags.listActive();
    expect(flags).toEqual(
      expect.arrayContaining([expect.objectContaining({ scope: 'consumer', target: 'agent-x' })]),
    );
  });
});

describe('forge kill (real binary, subprocess)', () => {
  it('kills a tool via the real CLI and reports OK', () => {
    const result = forge([
      'kill',
      'jde.ap.voucher.create',
      '--reason',
      'binding regression',
      '--by',
      'ops-bikash',
      '--json',
    ]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as KillReport;
    expect(report.ok).toBe(true);
    expect(report.scope).toBe('tool');
  });

  // The remaining four granularities' scope-parsing is proven in-process
  // above (`consumer:<id>`) and in `./kill.test.ts`'s sibling suite for
  // `parseKillTarget` in `../../gateway/flags/kill.test.ts` — one real-binary
  // spawn per granularity is deliberately NOT repeated here to avoid piling
  // subprocess spawns onto an already subprocess-heavy suite (this package's
  // known flake category).
  it('one non-tool granularity (server:) is reachable through the real CLI', () => {
    const result = forge([
      'kill',
      'server:ebs-p2p-ap',
      '--reason',
      'test',
      '--by',
      'ops-bikash',
      '--json',
    ]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as KillReport;
    expect(report.scope).toBe('moduleServer');
  });

  it('--until is accepted and recorded', () => {
    const result = forge([
      'kill',
      'jde.ap.voucher.create',
      '--reason',
      'temporary freeze',
      '--by',
      'ops-bikash',
      '--until',
      '2099-01-01T00:00:00.000Z',
      '--json',
    ]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as KillReport;
    expect(report.until).toBe('2099-01-01T00:00:00.000Z');
  });

  it('fails usage (64) with a next when --reason is missing', () => {
    const result = forge(['kill', 'jde.ap.voucher.create', '--by', 'ops-bikash', '--json']);
    expect(result.status).toBe(64);
    const error = JSON.parse(result.stdout) as { code: string; next: string };
    expect(error.code).toBe('INPUT_INVALID');
    expect(error.next.trim().length).toBeGreaterThan(0);
  });
});
