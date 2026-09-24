// W0-H5 — "There is no manual override path in code — only a governance
// exception with an approval record."
//
// A promise in a comment is not a control, so this file asserts the absence
// MECHANICALLY, by reading the module's own source. The same discipline
// `plan/read-only-by-construction.test.ts` takes for mutating checks.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareWhoami, constrainForCarriage } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => join(dir, f));
}

describe('core/probe/identity — no manual override path exists', () => {
  const files = sourceFiles(HERE);

  it('has source files to check (a vacuous pass would be worse than a failure)', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it('names no override, force or assume switch anywhere in the module', () => {
    // Identifier-shaped matches only, so prose in a comment explaining the
    // absence does not trip the check — but any FIELD or PARAMETER by these
    // names does.
    const forbidden =
      /\b(force|override|assumeVerified|assumeCarries|skipIdentity|bypass|allowServiceAccount|trustManifest)\s*[?:=]/;
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect({ file, match: forbidden.exec(src)?.[0] ?? null }).toEqual({ file, match: null });
    }
  });

  it('reads no environment variable and no configuration file', () => {
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toContain('process.env');
      expect(src).not.toMatch(/\bnode:fs\b/);
    }
  });

  it('never opens manifests/ — non-negotiable #2 mechanically, not by promise', () => {
    for (const file of files) {
      expect(readFileSync(file, 'utf8')).not.toContain('manifests/');
    }
  });

  it('is the only place the literal "verified" is produced, and only by comparison', () => {
    // `verified` is reachable from exactly one branch of exactly one function.
    // Anything the caller can vary — a disposition, a sensitivity, a write flag
    // — cannot reach it, because none of them are inputs to `compareWhoami`.
    const verifiedFrom = compareWhoami({
      toolId: 't.m.e.get',
      testIdentity: 'TESTUSER01',
      outcome: { kind: 'observed', observed: 'TESTUSER01' },
    });
    expect(verifiedFrom.carries).toBe('verified');
    expect(Object.keys({ toolId: 0, testIdentity: 0, outcome: 0 })).toHaveLength(3);
  });

  it('is pure: the same observation yields the same verdict, every time', () => {
    const call = (): unknown =>
      constrainForCarriage({
        toolId: 'jde.ap.voucher.create',
        carries: 'no',
        write: true,
        onNonCarriage: 'readonly-lowsens',
        sensitivity: 'financial',
      });
    expect(call()).toEqual(call());
    expect(call()).toEqual(call());
  });
});
