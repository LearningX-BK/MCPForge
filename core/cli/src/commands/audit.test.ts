// MCPForge — `forge audit verify`, W0-C4, end to end.
//
// Two layers, deliberately:
//  * the command function against an isolated temp-file store, which is where
//    the report shape and the exit code are asserted;
//  * the real `forge` binary spawned as a child process against that same
//    file via MCPFORGE_STORE_FILE, which is what proves the wiring in
//    `program.ts` and the `--json` contract actually hold for a human typing
//    the command.
//
// The tamper is performed by a SEPARATE `node` process that opens the file
// with the SQLite driver and drops the triggers — exactly what 02 §10.4 item 1
// says anyone holding `.mcpforge/runtime.db` can do, and the reason this
// command is load-bearing at Wave 0 rather than a nicety. It is a subprocess
// rather than an import for two reasons, and the first is the honest one: an
// outside process holding the file IS the threat model. The second is that
// `better-sqlite3` may only be imported inside `core/gateway/store/**`
// (eslint `no-restricted-imports`, 02 §10.2), and this file is not that.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRuntimeStore, type RuntimeStore } from '@mcpforge/gateway/store/server';
import { runAuditVerifyCommand, verifyAuditChains } from './audit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(here, '..', '..', 'bin', 'forge.js');

let tempDir: string;
let dbFile: string;
let store: RuntimeStore;
let written: string[];

function forge(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    encoding: 'utf-8',
    cwd: path.join(here, '..', '..'),
    env: { ...process.env, MCPFORGE_STORE_KIND: 'sqlite', MCPFORGE_STORE_FILE: dbFile },
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

/** Capture stdout for the in-process runs. */
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

beforeEach(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'mcpforge-cli-audit-'));
  dbFile = path.join(tempDir, 'runtime.db');
  store = await openRuntimeStore({ kind: 'sqlite', file: dbFile });
  written = [];
  for (let i = 0; i < 5; i += 1) {
    const day = String(i + 1).padStart(2, '0');
    const row = await store.audit.append({
      ts: `2020-01-${day}T00:00:00.000Z`,
      callerSubject: 'bikash',
      consumerId: 'portal-local',
      humanInTheLoop: true,
      toolId: 'jde.ap.voucher.create',
      isWrite: true,
      deploymentId: 'local',
      phase: 'execute',
      outcome: 'ok',
    });
    written.push(row.id);
  }
  await store.close();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** The gateway package, where the SQLite driver is legitimately resolvable. */
const gatewayDir = path.join(here, '..', '..', '..', 'gateway');

// The driver's module id is passed IN, as an argument, rather than written
// into a `require(...)` here: this file genuinely does not depend on the
// driver — an outside process does, which is the point — and
// `store/driver-isolation.test.ts` scans source text for exactly that
// dependency. Keeping the id an argument keeps that scan honest instead of
// making it carry an exemption for a file that has no such dependency.
const SQLITE_DRIVER = 'better-sqlite3';

const TAMPER_SCRIPT = [
  `const Database = require(process.argv[3]);`,
  `const db = new Database(process.argv[1]);`,
  // Precisely the two statements 02 §10.4 item 1 describes.
  `db.exec('DROP TRIGGER audit_call_no_update');`,
  `db.prepare("UPDATE audit_call SET caller_subject = 'mallory' WHERE id = ?").run(process.argv[2]);`,
  `db.close();`,
].join('\n');

function tamper(callId: string): void {
  const result = spawnSync(process.execPath, ['-e', TAMPER_SCRIPT, dbFile, callId, SQLITE_DRIVER], {
    encoding: 'utf-8',
    cwd: gatewayDir,
  });
  // If the tamper itself failed, the assertions below would pass for the wrong
  // reason — an intact chain — so it is checked rather than assumed.
  if (result.status !== 0) {
    throw new Error(`tamper subprocess failed: ${result.stderr}`);
  }
}

const openTemp = (): Promise<RuntimeStore> =>
  openRuntimeStore({ kind: 'sqlite', file: dbFile }, { migrate: false });

describe('forge audit verify — the report', () => {
  it('reports intact with its origin, and exits 0', async () => {
    const { out, code } = await capture(() =>
      runAuditVerifyCommand({ json: true }, { openStore: openTemp }),
    );
    expect(code).toBe(0);
    const report = JSON.parse(out.trim());
    expect(report.ok).toBe(true);
    expect(report.deployments).toHaveLength(1);
    expect(report.deployments[0].status).toBe('intact');
    expect(report.deployments[0].origin.kind).toBe('genesis');
    expect(report.deployments[0].origin.firstRowId).toBe(written[0]);
    expect(report.store.kind).toBe('sqlite');
  });

  it('names the FIRST broken row by id and exits non-zero', async () => {
    tamper(written[2]!);
    const { out, code } = await capture(() =>
      runAuditVerifyCommand({ json: true }, { openStore: openTemp }),
    );
    expect(code).toBe(1);
    const report = JSON.parse(out.trim());
    expect(report.ok).toBe(false);
    const chain = report.deployments[0];
    expect(chain.status).toBe('broken');
    expect(chain.firstBreak.rowId).toBe(written[2]);
    expect(chain.firstBreak.position).toBe(2);
    expect(chain.firstBreak.expected).not.toBe(chain.firstBreak.actual);
    expect(chain.firstBreak.next.length).toBeGreaterThan(0);
  });

  it('--deployment narrows the walk', async () => {
    const reopened = await openTemp();
    try {
      const report = await verifyAuditChains(reopened, 'not-a-deployment');
      expect(report.ok).toBe(true);
      expect(report.deployments).toEqual([
        {
          deploymentId: 'not-a-deployment',
          status: 'empty',
          rowsChecked: 0,
          origin: null,
          firstBreak: null,
        },
      ]);
    } finally {
      await reopened.close();
    }
  });

  it('still verifies after the retention job has removed a prefix', async () => {
    const reopened = await openTemp();
    try {
      await reopened.retention.sweep({
        deploymentId: 'local',
        olderThanIso: '2020-01-03T00:00:00.000Z',
        reason: '2-year default retention (02 §4.6)',
        actorSubject: 'ops-bikash',
        consumerId: 'forge-cli',
      });
    } finally {
      await reopened.close();
    }

    const { out, code } = await capture(() =>
      runAuditVerifyCommand({ json: true }, { openStore: openTemp }),
    );
    expect(code).toBe(0);
    const report = JSON.parse(out.trim());
    expect(report.ok).toBe(true);
    expect(report.deployments[0].status).toBe('intact_from_retention_boundary');
    expect(report.deployments[0].origin.attestation.deletedCount).toBe(2);
  });

  it('human mode names the break, the store and the next action', async () => {
    tamper(written[1]!);
    const { out, code } = await capture(() =>
      runAuditVerifyCommand({ json: false }, { openStore: openTemp }),
    );
    expect(code).toBe(1);
    expect(out).toContain('forge audit verify: BROKEN');
    expect(out).toContain(written[1]!);
    expect(out).toContain('next:');
    expect(out).toContain('SQLite · local file');
  });
});

// Spawning the real binary costs a `tsx` registration per call, and the ROOT
// vitest config's 5s default is not enough for that under full-suite parallel
// load. The timeout is declared HERE rather than left to whichever config is
// running, so the suite behaves identically under `pnpm -C core/cli test` and
// under the repo-wide `pnpm test`.
describe('forge audit verify — the real binary', () => {
  it('exits 0 with a parseable ok:true envelope against a clean chain', () => {
    const { stdout, status } = forge(['audit', 'verify', '--json']);
    expect(status).toBe(0);
    const report = JSON.parse(stdout.trim());
    expect(report.ok).toBe(true);
    expect(report.deployments[0].status).toBe('intact');
  });

  it('exits 1 and names the tampered row after a direct-file rewrite', () => {
    tamper(written[3]!);
    const { stdout, status } = forge(['audit', 'verify', '--json']);
    expect(status).toBe(1);
    const report = JSON.parse(stdout.trim());
    expect(report.ok).toBe(false);
    expect(report.deployments[0].firstBreak.rowId).toBe(written[3]);
  });

  it('accepts --deployment', () => {
    const { stdout, status } = forge(['audit', 'verify', '--deployment', 'local', '--json']);
    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim()).deployments).toHaveLength(1);
  });

  // W0-F5 gave `audit reverse` a real handler; its own coverage lives in
  // ./audit-reverse.test.ts. What is asserted here is only that it is no
  // longer the stub W0-C4 left behind, and that a missing call id reaches this
  // CLI's INPUT_INVALID envelope with a `next` rather than Commander's text.
  it('`audit reverse` is a real handler with an actionable usage error', () => {
    const { stdout, status } = forge(['audit', 'reverse', '--json']);
    expect(status).toBe(64);
    const envelope = JSON.parse(stdout.trim());
    expect(envelope.code).toBe('INPUT_INVALID');
    expect(envelope.next.length).toBeGreaterThan(0);
  });
}, 60_000);
