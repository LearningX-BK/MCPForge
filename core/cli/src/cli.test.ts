import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CANONICAL_COMMANDS, CANONICAL_SURFACE_LINE, commandLabel } from './commands.js';
import { NOT_IMPLEMENTED_EXIT_CODE } from './lib/output.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(here, '..', 'bin', 'forge.js');

function runForge(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    encoding: 'utf-8',
    cwd: path.join(here, '..'),
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

describe('forge --help', () => {
  it('exits 0 and lists the full Wave 0 command surface', () => {
    const { stdout, status } = runForge(['--help']);
    expect(status).toBe(0);
    expect(stdout).toContain(CANONICAL_SURFACE_LINE);
    // Every canonical command's leaf name shows up somewhere in --help,
    // whether as a top-level entry or under its group's heading.
    for (const spec of CANONICAL_COMMANDS) {
      expect(stdout).toContain(spec.path[spec.path.length - 1]);
    }
  });

  it('the group commands (new, audit, identity) point at their own --help', () => {
    const { stdout } = runForge(['audit', '--help']);
    expect(stdout).toContain('verify');
    expect(stdout).toContain('reverse');
  });
});

// Commands with a real (non-stub) handler, wired in program.ts's
// REAL_HANDLERS map. They don't fit the generic NOT_IMPLEMENTED assertions
// below, and — for `ci` specifically — must never be spawned as a real
// end-to-end subprocess from *this* suite: forge ci's stage 6 runs the
// real `pnpm test`, which is this very suite, so doing that here would
// recurse. Its pipeline logic is tested in isolation instead, in
// tools/ci/src/*.test.ts, against a synthetic repoRoot that never touches
// the real monorepo's pnpm scripts.
const REAL_HANDLER_LABELS = new Set([
  'ci',
  'validate',
  'codegen',
  'audit verify',
  // W0-F5 — see ./commands/audit-reverse.test.ts. It takes a positional call
  // id, so it doesn't fit the generic NOT_IMPLEMENTED assertions below.
  'audit reverse',
  'identity remap',
  // W0-E5 — see ./commands/kill.test.ts for its own end-to-end coverage,
  // including the real binary. It takes a positional target, so it doesn't
  // fit the generic "no positional argument" NOT_IMPLEMENTED assertions below.
  'kill',
  // W0-H4 — the capability probe (02 §4.5). See core/probe's own suite for the
  // orchestrator, the closed status enum and the schema-validated artefact.
  'probe',
  // W0-G6/W0-G7 — the discovery benchmark. A real handler since W0-G6 (this
  // entry was missed then, leaving two stale NOT_IMPLEMENTED assertions
  // failing); its own coverage is tests/bench/**, which drives it in-process
  // against a synthetic catalogue rather than spawning it here.
  'bench',
  // W0-N1 — the consumer registry (02 §11.2). Real handlers since W0-N1; each
  // takes a positional consumer id, so none fits the generic "no positional
  // argument" NOT_IMPLEMENTED assertions below. Their own coverage is
  // ./commands/consumer.test.ts, which drives them in-process against a
  // temporary repo root rather than staging proposals in this one.
  'consumer new',
  'consumer list',
  'consumer show',
  'consumer suspend',
  'consumer rotate',
  'consumer retire',
  'consumer issue-credential',
  // W0-N6 — `forge secrets status|rotate|revoke` (02 §11.5 rules 5 and 6).
  // `rotate` and `revoke` take a positional secretRef, and `status` walks the
  // real vault, so none fits the generic NOT_IMPLEMENTED assertions below.
  // Their own coverage is ./commands/secrets.test.ts, which drives them
  // in-process against a temporary repo root and an isolated runtime store,
  // plus a real-binary layer.
  'secrets status',
  'secrets rotate',
  'secrets revoke',
  // W0-N11 — `forge dev`'s local bootstrap self-registration (02 §11.2). A
  // real handler that WRITES consumers/portal-local.consumer.yaml, so it must
  // never be run against this repo from here; its coverage is ./commands/
  // dev.test.ts, which drives it against a temporary repo root.
  'dev',
  // W0-K1 — `forge package <id>` (02 §6.1, §6.2). Takes a positional
  // package id, so it doesn't fit the generic "no positional argument"
  // NOT_IMPLEMENTED assertions below. Its own coverage is
  // ./commands/package.test.ts, which drives it in-process against this
  // repo's real, checked-in manifests/generated/ tree.
  'package',
  // W0-K5 — `forge slice-diff <a> <b>` (02 §6.4). Takes two positional
  // package ids, so it doesn't fit the generic NOT_IMPLEMENTED assertions
  // below. Its own coverage is ./commands/slice-diff.test.ts, which drives
  // it in-process against this repo's real tree plus synthetic fixtures.
  'slice-diff',
]);

describe('forge ci (real handler — see tools/ci for the pipeline-logic tests)', () => {
  it('is registered and describable via --help, without being run for real here', () => {
    const { stdout, status } = runForge(['ci', '--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('ci');
  });
});

describe('forge validate (real handler — see core/codegen/src/validate for the engine tests)', () => {
  it('runs against the real repo and exits 0 with a parseable ok:true envelope (no manifests authored yet)', () => {
    const { stdout, status } = runForge(['validate', '--json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.failures).toEqual([]);
  });

  it('non-JSON mode prints a human-readable OK line', () => {
    const { stdout, status } = runForge(['validate']);
    expect(status).toBe(0);
    expect(stdout).toContain('forge validate: OK');
  });
});

describe('forge codegen (real handler — see core/codegen/src/emit for the engine tests)', () => {
  it('runs against the real repo and exits 0 with a parseable ok:true envelope (no manifests authored yet)', () => {
    const { stdout, status } = runForge(['codegen', '--json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.manifestsProcessed).toBe(0);
    // W0-G1: `forge codegen` writes generated/index/catalogue-index.json
    // unconditionally, even with zero tool manifests — it is not a per-tool
    // artefact, so "no manifests authored yet" no longer means "nothing
    // written".
    expect(parsed.filesWritten).toEqual(['generated/index/catalogue-index.json']);
  });

  it('non-JSON mode prints a human-readable OK line', () => {
    const { stdout, status } = runForge(['codegen']);
    expect(status).toBe(0);
    expect(stdout).toContain('forge codegen: OK');
  });
});

describe('every canonical command', () => {
  for (const spec of CANONICAL_COMMANDS.filter(
    (spec) => !REAL_HANDLER_LABELS.has(commandLabel(spec)),
  )) {
    const label = commandLabel(spec);

    it(`forge ${label} --json exits 64 with a parseable NOT_IMPLEMENTED envelope on stdout`, () => {
      const { stdout, stderr, status } = runForge([...spec.path, '--json']);
      expect(status).toBe(NOT_IMPLEMENTED_EXIT_CODE);
      expect(status).toBe(64);

      const parsed = JSON.parse(stdout.trim());
      expect(parsed).toMatchObject({
        ok: false,
        code: 'NOT_IMPLEMENTED',
        command: label,
      });
      expect(typeof parsed.next).toBe('string');
      expect(parsed.next.length).toBeGreaterThan(0);
      // Diagnostics, if any, stay off stdout.
      expect(stderr).not.toContain('NOT_IMPLEMENTED');
    });

    it(`forge ${label} (no --json) exits 64, stdout carries no JSON, stderr carries the diagnostic`, () => {
      const { stdout, stderr, status } = runForge([...spec.path]);
      expect(status).toBe(NOT_IMPLEMENTED_EXIT_CODE);
      expect(() => JSON.parse(stdout)).toThrow();
      expect(stderr).toContain(label);
      expect(stderr).toContain('not implemented yet');
    });
  }
});
