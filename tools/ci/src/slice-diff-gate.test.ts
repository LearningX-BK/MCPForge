// W0-P1 — stage 11's gate, the no-fork proof.
//
// The most important test in this file is the fewer-than-two-slices one: it
// pins the decision that a proof which cannot run is a FAILURE, not a skip
// and not a self-comparison. If a later change makes that case pass, this
// test is what catches it.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverPackageIds,
  runSliceDiffGate,
  unorderedPairs,
  type SliceDiffRun,
} from './slice-diff-gate.js';

function repoWithPackages(ids: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcpforge-slice-gate-'));
  mkdirSync(join(dir, 'packages'), { recursive: true });
  for (const id of ids) {
    writeFileSync(join(dir, 'packages', `${id}.yaml`), `apiVersion: mcpforge/v1\nkind: Package\nid: ${id}\n`);
  }
  return dir;
}

const ok: SliceDiffRun = { code: 0, stdout: `${JSON.stringify({ ok: true })}\n`, stderr: '' };

describe('discovery', () => {
  let root: string;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('reads package ids from packages/*.yaml, sorted', () => {
    root = repoWithPackages(['zeta-slice', 'alpha-slice']);
    expect(discoverPackageIds(root)).toEqual(['alpha-slice', 'zeta-slice']);
  });

  it('a missing packages/ directory is zero slices, not a throw', () => {
    root = mkdtempSync(join(tmpdir(), 'mcpforge-slice-gate-empty-'));
    expect(discoverPackageIds(root)).toEqual([]);
  });

  it('enumerates every unordered pair, never a self-pair', () => {
    expect(unorderedPairs(['a', 'b', 'c'])).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
    expect(unorderedPairs(['a'])).toEqual([]);
  });
});

describe('stage 11 — the no-fork proof', () => {
  let root: string;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('FAILS with one slice — it does not skip, and it does not diff a slice against itself', () => {
    root = repoWithPackages(['jde-fin']);
    let invoked = 0;
    const outcome = runSliceDiffGate(root, () => {
      invoked += 1;
      return ok;
    });
    expect(outcome.status).toBe('failed');
    expect(invoked).toBe(0); // no self-comparison was attempted
    expect(outcome.detail).toContain('this repo defines 1 (jde-fin)');
    expect(outcome.detail).toContain('manufactured pass');
    expect(outcome.detail).toContain('next:');
  });

  it('FAILS with zero slices', () => {
    root = repoWithPackages([]);
    const outcome = runSliceDiffGate(root, () => ok);
    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('defines 0 (none)');
  });

  it('passes when every pair differs only in selection, naming the pair count', () => {
    root = repoWithPackages(['a-slice', 'b-slice', 'c-slice']);
    const seen: string[] = [];
    const outcome = runSliceDiffGate(root, (_r, a, b) => {
      seen.push(`${a}|${b}`);
      return ok;
    });
    expect(outcome.status).toBe('passed');
    expect(seen).toEqual(['a-slice|b-slice', 'a-slice|c-slice', 'b-slice|c-slice']);
    expect(outcome.detail).toContain('3 slice pair(s) across 3 slice(s)');
  });

  it('fails on an unexplained difference, naming the code, the message and the offending paths', () => {
    root = repoWithPackages(['a-slice', 'b-slice']);
    const outcome = runSliceDiffGate(root, () => ({
      code: 1,
      stdout: `${JSON.stringify({
        ok: false,
        code: 'SLICE_UNEXPLAINED_DIFFERENCE',
        message: 'one file differs for a reason selection does not explain',
        next: 'inspect generated/tools/jde.ap.voucher.create/handler.generated.ts',
        onlyInA: ['tools/jde.ap.voucher.create/handler.generated.ts'],
      })}\n`,
      stderr: '',
    }));
    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('SLICE_UNEXPLAINED_DIFFERENCE');
    expect(outcome.detail).toContain('handler.generated.ts (only in a-slice)');
    expect(outcome.detail).toContain('next:');
  });

  it('fails when stdout is not parseable JSON — a broken gate is a failed gate', () => {
    root = repoWithPackages(['a-slice', 'b-slice']);
    const outcome = runSliceDiffGate(root, () => ({
      code: 1,
      stdout: 'Cannot find module',
      stderr: '',
    }));
    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('not parseable JSON');
  });

  it('fails when the command cannot be spawned', () => {
    root = repoWithPackages(['a-slice', 'b-slice']);
    const outcome = runSliceDiffGate(root, () => {
      throw new Error('ENOENT');
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('could not be spawned');
  });

  it('never returns not_implemented', () => {
    root = repoWithPackages(['only-one']);
    expect(runSliceDiffGate(root, () => ok).status).not.toBe('not_implemented');
  });
});
