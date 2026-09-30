// MCPForge — W0-J14: `runStructuralCheck` — reuses the REAL `validateManifest`
// (never a second hand-written validator, CLAUDE.md §5).
import { describe, expect, it } from 'vitest';
import { runStructuralCheck } from './structural-check';
import { loadBuildDrafts } from '../fixtures';

describe('runStructuralCheck', () => {
  it('reports ok for a real, valid seeded draft', () => {
    const draft = loadBuildDrafts()[0]!;
    const result = runStructuralCheck(draft.yaml);
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('Tool');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('reports a diagnostic, with a line number, for a missing required field', () => {
    const draft = loadBuildDrafts()[0]!;
    const withoutId = draft.yaml.replace(/^id: .*$/m, '');
    const result = runStructuralCheck(withoutId);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.every((d) => d.line >= 1)).toBe(true);
  });

  it('reports a diagnostic for an unparseable YAML document, without throwing', () => {
    const result = runStructuralCheck('id: [unterminated');
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('never asserts `identity.carries: verified` as valid (CLAUDE.md non-negotiable #2)', () => {
    const draft = loadBuildDrafts()[0]!;
    const withVerified = draft.yaml.replace('carries: unverified', 'carries: verified');
    const result = runStructuralCheck(withVerified);
    expect(result.ok).toBe(false);
  });
});
