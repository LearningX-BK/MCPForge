// THE STRUCTURAL PROOF. 02 §4.5: "Probe plans are read-only or validate-only
// by construction." Same proof style as `adapters/function`'s
// no-arbitrary-orchestration test: assert over the SOURCE and over the
// exhaustive catalogue, not over one happy path.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BINDING_TYPES } from '@mcpforge/shared/manifest';
import { ALL_CHECKS, CHECK_CATALOGUE } from './checks.js';
import { buildProbePlan } from './build.js';
import { NON_MUTATING_CLASSIFICATIONS, isMutating } from './types.js';
import { dispatchableOrchestrations } from '../run/function-executor.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('probe plans are read-only or validate-only by construction', () => {
  it('every check in the catalogue is read-only or validate-only', () => {
    expect(ALL_CHECKS.length).toBeGreaterThan(0);
    for (const check of ALL_CHECKS) {
      expect(NON_MUTATING_CLASSIFICATIONS).toContain(check.classification);
      expect(isMutating(check.classification)).toBe(false);
    }
  });

  it('every binding type has checks, so no binding type is silently unprobed', () => {
    for (const type of BINDING_TYPES) {
      expect(CHECK_CATALOGUE[type].length).toBeGreaterThan(0);
    }
  });

  it('every plan buildProbePlan can produce — read and write, all binding types — is non-mutating', () => {
    for (const bindingType of BINDING_TYPES) {
      for (const write of [false, true]) {
        const plan = buildProbePlan({
          toolId: `x.y.z.${write ? 'create' : 'get'}`,
          bindingType,
          write,
        });
        expect(plan.checks.length).toBeGreaterThan(0);
        for (const check of plan.checks) {
          expect(isMutating(check.classification)).toBe(false);
        }
      }
    }
  });

  it("write-only checks are excluded from a read tool's plan and included in a write tool's", () => {
    const read = buildProbePlan({
      toolId: 'jde.ap.voucher.get',
      bindingType: 'function',
      write: false,
    });
    const write = buildProbePlan({
      toolId: 'jde.ap.voucher.create',
      bindingType: 'function',
      write: true,
    });
    expect(read.checks.map((c) => c.name)).not.toContain('validate_sibling');
    expect(write.checks.map((c) => c.name)).toContain('validate_sibling');
  });

  it('the function probe executor can never dispatch binding.ref itself', () => {
    // Dispatching `ref` for a write tool WOULD BE the write. The complete set
    // of names the executor can dispatch is declared, and `ref` is not in it.
    const ref = 'JDE_AP_VOUCHER_CREATE';
    const dispatchable = dispatchableOrchestrations(ref);
    expect(dispatchable).not.toContain(ref);
    for (const name of dispatchable) expect(name).not.toBe(ref);
  });

  it("no source file in core/probe references a manifests/ path in CODE — non-negotiable #2's mechanical form", () => {
    // Comments are stripped first: this package discusses manifests at length
    // and must be allowed to. What must not exist is a manifests path in an
    // executable line.
    const stripComments = (s: string): string =>
      s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/manifests[\\/]/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('the check catalogue is frozen — a mutating check cannot be injected at run time', () => {
    expect(Object.isFrozen(CHECK_CATALOGUE)).toBe(true);
    for (const type of BINDING_TYPES) {
      for (const check of CHECK_CATALOGUE[type]) expect(Object.isFrozen(check)).toBe(true);
    }
    expect(() =>
      Object.defineProperty(CHECK_CATALOGUE as object, 'function', { value: [] }),
    ).toThrow(TypeError);
  });

  it('the only file in core/probe that writes at all writes probe-report.json', () => {
    const writers = sourceFiles(SRC).filter((f) =>
      /\bwriteFileSync\(/.test(readFileSync(f, 'utf8')),
    );
    expect(writers.map((f) => f.replace(SRC, '').replace(/\\/g, '/'))).toEqual(['/report/io.ts']);
  });
});
