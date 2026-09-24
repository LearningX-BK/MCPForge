import { describe, expect, it } from 'vitest';

import { canProposeEdit, diffToolIds, proposalFiles, scopeRows, sortSodFindings } from './scope-diff';
import type { CompiledRoleDraft, SodFindingView } from '../types';

const source = { path: 'roles/p2p.yaml', scopePath: 'generated/roles/p2p.scope.json' };

function draft(over: Partial<CompiledRoleDraft> = {}): CompiledRoleDraft {
  return {
    roleId: 'p2p',
    toolIds: ['a.b.c.get'],
    scopeJson: '{"toolIds":["a.b.c.get"]}\n',
    toolsAdded: [],
    toolsRemoved: [],
    budget: { coreSetTokens: 10, limit: 1300, overBudget: false, demote: [], message: null },
    sod: [],
    ...over,
  };
}

describe('diffToolIds', () => {
  it('reports added, removed and unchanged, each sorted', () => {
    const d = diffToolIds(['b', 'a', 'c'], ['c', 'd', 'a']);
    expect(d.added).toEqual(['d']);
    expect(d.removed).toEqual(['b']);
    expect(d.unchanged).toEqual(['a', 'c']);
  });
});

describe('scopeRows', () => {
  it('shows removed tools alongside the compiled set, so a narrowing is visible', () => {
    const rows = scopeRows(['a', 'b'], ['b', 'c']);
    expect(rows).toEqual([
      { toolId: 'a', state: 'removed' },
      { toolId: 'b', state: 'unchanged' },
      { toolId: 'c', state: 'added' },
    ]);
  });
});

describe('proposalFiles — the proposal IS the compiled scope', () => {
  it('carries the edited role source and the compiled artefact, and nothing else', () => {
    const files = proposalFiles(source, 'edited: yaml\n', draft());
    expect(Object.keys(files).sort()).toEqual([
      'generated/roles/p2p.scope.json',
      'roles/p2p.yaml',
    ]);
    // The compiled artefact's bytes are the compiler's, unaltered.
    expect(files['generated/roles/p2p.scope.json']).toBe('{"toolIds":["a.b.c.get"]}\n');
    expect(files['roles/p2p.yaml']).toBe('edited: yaml\n');
  });

  it('refuses to build a proposal when the edit did not compile', () => {
    const files = proposalFiles(
      source,
      'broken',
      draft({ error: { message: 'no', next: 'fix it' } }),
    );
    expect(files).toEqual({});
  });
});

describe('canProposeEdit — nothing saves directly, and nothing broken is proposable', () => {
  it('is false before a compile has happened', () => {
    expect(canProposeEdit({ yamlText: 'a' }, 'b', undefined)).toBe(false);
  });
  it('is false when the compile failed', () => {
    expect(
      canProposeEdit({ yamlText: 'a' }, 'b', draft({ error: { message: 'x', next: 'y' } })),
    ).toBe(false);
  });
  it('is false when nothing changed', () => {
    expect(canProposeEdit({ yamlText: 'a' }, 'a', draft())).toBe(false);
  });
  it('is true only for a compiled, changed edit', () => {
    expect(canProposeEdit({ yamlText: 'a' }, 'b', draft())).toBe(true);
  });
});

describe('sortSodFindings', () => {
  it('puts declared conflicts before implicit pairs', () => {
    const findings: SodFindingView[] = [
      {
        ruleId: 'sod.implicit-create-approve',
        severity: 'warning',
        pair: ['x.y.z.approve', 'x.y.z.create'],
        disposition: null,
        message: '',
        fix: '',
      },
      {
        ruleId: 'sod.declared-conflict',
        severity: 'warning',
        pair: ['a.b.c.approve', 'a.b.c.create'],
        disposition: 'warn-and-require-exception',
        message: '',
        fix: '',
      },
    ];
    expect(sortSodFindings(findings).map((f) => f.ruleId)).toEqual([
      'sod.declared-conflict',
      'sod.implicit-create-approve',
    ]);
  });
});
