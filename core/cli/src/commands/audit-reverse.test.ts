// MCPForge — `forge audit reverse`, W0-F5, end to end.
//
// Same two layers as ./audit.test.ts: the command function against an isolated
// temp-file store, and the real `forge` binary spawned against the same file
// through MCPFORGE_STORE_FILE, which is what proves `program.ts`'s wiring and
// the `--json` contract hold for a human typing the command.
//
// The reversal MECHANISM — construction, execution through the full plan ->
// confirm sequence, and the two-way link — is proved against the real policy
// chain in core/gateway/reversal/reversal.test.ts. What is proved here is the
// command: that it reads the frozen audit row, applies `argMap` to the recorded
// business keys, refuses with an actionable `next` when it cannot, and never
// executes a write from a process that holds no session.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRuntimeStore, type RuntimeStore } from '@mcpforge/gateway/store/server';
import { reversalRegistry } from '@mcpforge/gateway/reversal';
import { runAuditReverseCommand } from './audit-reverse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(here, '..', '..', 'bin', 'forge.js');

const CREATE = 'jde.ap.voucher.create';
const CANCEL = 'jde.ap.voucher.cancel';

const REGISTRY = reversalRegistry({
  [CREATE]: {
    class: 'compensating-tool',
    tool: CANCEL,
    argMap: {
      document_number: '$.result.document_number',
      document_company: '$.result.document_company',
    },
    windowHours: 720,
  },
});

let tempDir: string;
let dbFile: string;
let store: RuntimeStore;
let writeCallId: string;
let readCallId: string;

function forge(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    encoding: 'utf-8',
    cwd: path.join(here, '..', '..'),
    env: { ...process.env, MCPFORGE_STORE_KIND: 'sqlite', MCPFORGE_STORE_FILE: dbFile },
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

async function capture(run: () => Promise<number>): Promise<{ out: string; code: number }> {
  const original = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    out += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await run();
    return { out, code };
  } finally {
    process.stdout.write = original;
  }
}

const openIsolated = (): Promise<RuntimeStore> =>
  openRuntimeStore({ kind: 'sqlite', file: dbFile });

beforeEach(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'mcpforge-cli-reverse-'));
  dbFile = path.join(tempDir, 'runtime.db');
  store = await openRuntimeStore({ kind: 'sqlite', file: dbFile });

  // Timestamps are relative to now: the reversal window is judged against the
  // real clock, so fixed dates rot into `window_expired`.
  // A completed write, with the reversal contract and the business keys frozen
  // into it exactly as the write dispatcher freezes them at execute time.
  const write = await store.audit.append({
    ts: new Date(Date.now() - 60_000).toISOString(),
    callerSubject: 'bikash',
    consumerId: 'portal-local',
    humanInTheLoop: true,
    toolId: CREATE,
    isWrite: true,
    deploymentId: 'local',
    phase: 'execute',
    outcome: 'ok',
    reversalClass: 'compensating-tool',
    reversalToolId: CANCEL,
    resultKeys: [
      { keyName: 'document_number', keyValue: '00123456' },
      { keyName: 'document_type', keyValue: 'PV' },
      { keyName: 'document_company', keyValue: '00100' },
    ],
  });
  writeCallId = write.id;

  const read = await store.audit.append({
    ts: new Date(Date.now() - 30_000).toISOString(),
    callerSubject: 'bikash',
    consumerId: 'portal-local',
    humanInTheLoop: true,
    toolId: 'jde.ap.voucher.search',
    isWrite: false,
    deploymentId: 'local',
    phase: 'execute',
    outcome: 'ok',
  });
  readCallId = read.id;

  await store.close();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('forge audit reverse — the constructed call', () => {
  it('applies argMap to the recorded result keys and exits 0', async () => {
    const { out, code } = await capture(() =>
      runAuditReverseCommand(
        writeCallId,
        { json: true },
        { openStore: openIsolated, registry: REGISTRY },
      ),
    );
    expect(code).toBe(0);
    const report = JSON.parse(out.trim());
    expect(report.originalToolId).toBe(CREATE);
    expect(report.reversalClass).toBe('compensating-tool');
    expect(report.reversingCall).toEqual({
      toolId: CANCEL,
      args: { document_number: '00123456', document_company: '00100' },
    });
    // Construct-only. Nothing was executed and the report does not pretend it was.
    expect(report.executed).toBeNull();
    expect(report.refusal).toBeNull();
  });

  it('the human rendering shows the result keys and says the reversal is itself a write', async () => {
    const { out } = await capture(() =>
      runAuditReverseCommand(
        writeCallId,
        { json: false },
        { openStore: openIsolated, registry: REGISTRY },
      ),
    );
    expect(out).toContain('document_number=00123456');
    expect(out).toContain(CANCEL);
    expect(out).toContain('plan -> confirm sequence');
    expect(out).toContain('NOT executed');
  });

  it('refuses a READ call with a next, and exits 1', async () => {
    const { out, code } = await capture(() =>
      runAuditReverseCommand(
        readCallId,
        { json: true },
        { openStore: openIsolated, registry: REGISTRY },
      ),
    );
    expect(code).toBe(1);
    const report = JSON.parse(out.trim());
    expect(report.refusal.reason).toBe('not_a_write');
    expect(report.refusal.next.length).toBeGreaterThan(0);
    expect(report.refusal.next).not.toMatch(/try again/i);
  });

  it('refuses an unknown call id with a next, and exits 1', async () => {
    const { out, code } = await capture(() =>
      runAuditReverseCommand(
        'no-such-call',
        { json: true },
        { openStore: openIsolated, registry: REGISTRY },
      ),
    );
    expect(code).toBe(1);
    expect(JSON.parse(out.trim()).refusal.reason).toBe('call_not_found');
  });

  // Non-negotiables 1 and 6: a bare CLI process holds no registered consumer
  // and no resolved human identity, so it may not execute a write. The flag
  // EXISTS and is refused with the reason, rather than being absent and
  // leaving an operator to look for a shortcut.
  it('refuses --execute, and says why, rather than executing from a sessionless process', async () => {
    const { out, code } = await capture(() =>
      runAuditReverseCommand(
        writeCallId,
        { json: true, execute: true },
        { openStore: openIsolated, registry: REGISTRY },
      ),
    );
    expect(code).toBe(64);
    const envelope = JSON.parse(out.trim());
    expect(envelope.code).toBe('INPUT_INVALID');
    expect(envelope.message).toMatch(/plan -> confirm/);
    expect(envelope.next.length).toBeGreaterThan(0);
  });
});

describe('forge audit reverse — no argMap is never guessed', () => {
  // W0-P20: this was the real binary's case while the repo held no manifests.
  // It stays, against a registry whose contract has a reversing tool but NO
  // argMap: the row's frozen class and tool are still read back and reported,
  // but which recorded business keys the cancel wants lives only in the
  // manifest, so the command refuses rather than guessing. A reversing call
  // assembled from guesses is a write nobody authorised.
  it('reports the frozen contract and refuses to guess an argMap the manifest does not supply', async () => {
    const noArgMap = reversalRegistry({
      [CREATE]: { class: 'compensating-tool', tool: CANCEL, windowHours: 720 },
    });
    const { out, code } = await capture(() =>
      runAuditReverseCommand(
        writeCallId,
        { json: true },
        { openStore: openIsolated, registry: noArgMap },
      ),
    );
    expect(code).toBe(1);
    const report = JSON.parse(out.trim());
    expect(report.reversalClass).toBe('compensating-tool');
    expect(report.reversingToolId).toBe(CANCEL);
    expect(report.resultKeys.document_number).toBe('00123456');
    expect(report.reversingCall).toBeNull();
    expect(report.refusal.reason).toBe('no_arg_map');
    expect(report.refusal.next).toMatch(/argMap/);
  });
});

describe('forge audit reverse — the real binary', () => {
  // The registry here is the REAL one, read from this repo's `manifests/`, and
  // `jde.ap.voucher.create` declares its argMap there. So the real binary
  // constructs the reversing call from the frozen business keys, and still
  // executes nothing.
  it('builds the reversing call from the committed manifest’s argMap, and executes nothing', () => {
    const { stdout, status } = forge(['audit', 'reverse', writeCallId, '--json']);
    expect(status).toBe(0);
    const report = JSON.parse(stdout.trim());
    expect(report.reversalClass).toBe('compensating-tool');
    expect(report.reversingToolId).toBe(CANCEL);
    expect(report.reversingCall).toEqual({
      toolId: CANCEL,
      args: { document_number: '00123456', document_type: 'PV', document_company: '00100' },
    });
    expect(report.executed).toBeNull();
    expect(report.refusal).toBeNull();
  });

  it('exits 1 with an actionable refusal on a read call', () => {
    const { stdout, status } = forge(['audit', 'reverse', readCallId, '--json']);
    expect(status).toBe(1);
    expect(JSON.parse(stdout.trim()).refusal.reason).toBe('not_a_write');
  });
}, 60_000);
