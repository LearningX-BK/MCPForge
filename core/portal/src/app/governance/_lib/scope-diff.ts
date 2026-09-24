// MCPForge — W0-J18: the pure half of the Roles tab. No fs, no server action,
// so it is directly unit-testable and reusable by the client editor.
//
// 02 §4.3: the compiled scope is "an explicit tool-id list"; the governance
// mechanism is that widening it "shows up as a diff". Both halves of that
// sentence are this file's two functions.

import type { CompiledRoleDraft, RoleSource, SodFindingView } from '../types';

export interface ToolIdDelta {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly unchanged: readonly string[];
}

/** Sorted set difference over two explicit tool-id lists. */
export function diffToolIds(
  base: readonly string[],
  next: readonly string[],
): ToolIdDelta {
  const baseSet = new Set(base);
  const nextSet = new Set(next);
  return {
    added: [...nextSet].filter((id) => !baseSet.has(id)).sort(),
    removed: [...baseSet].filter((id) => !nextSet.has(id)).sort(),
    unchanged: [...nextSet].filter((id) => baseSet.has(id)).sort(),
  };
}

/**
 * How one compiled tool id reads in the right pane. `added`/`removed` are the
 * grant change a reviewer must see; `unchanged` is the rest of the grant,
 * which is still shown, because a diff that hides the tools a glob ALREADY
 * picks up is the same failure at one remove.
 */
export type ScopeRowState = 'added' | 'removed' | 'unchanged';

export interface ScopeRow {
  readonly toolId: string;
  readonly state: ScopeRowState;
}

/** The right pane's rows: the compiled set plus the removed ids, in one list. */
export function scopeRows(
  merged: readonly string[],
  compiled: readonly string[],
): readonly ScopeRow[] {
  const delta = diffToolIds(merged, compiled);
  const removedSet = new Set(delta.removed);
  const addedSet = new Set(delta.added);
  const all = [...new Set([...merged, ...compiled])].sort();
  return all.map((toolId) => ({
    toolId,
    state: removedSet.has(toolId) ? 'removed' : addedSet.has(toolId) ? 'added' : 'unchanged',
  }));
}

/**
 * The files a change proposal carries for one role edit.
 *
 * THIS IS THE done: CRITERION MADE LITERAL. The proposal is
 * `{ roles/<id>.yaml, generated/roles/<id>.scope.json }`, and the second file's
 * bytes are what the REAL compiler wrote during the live compile — not a
 * summary of the edit, not a description, not a hand-built JSON. Handing these
 * to `ChangeHost.saveDraft` makes the proposal's diff the compiled scope.
 */
export function proposalFiles(
  source: Pick<RoleSource, 'path' | 'scopePath'>,
  yamlText: string,
  draft: Pick<CompiledRoleDraft, 'scopeJson' | 'error'>,
): Readonly<Record<string, string>> {
  if (draft.error !== undefined) {
    // A proposal whose compiled artefact does not exist would carry an edit
    // with no visible grant change — exactly what 02 §4.3 forbids. Refuse.
    return {};
  }
  return {
    [source.path]: yamlText,
    [source.scopePath]: draft.scopeJson,
  };
}

/** True when this edit is proposable: it compiled, and it changed something. */
export function canProposeEdit(
  source: Pick<RoleSource, 'yamlText'>,
  yamlText: string,
  draft: Pick<CompiledRoleDraft, 'scopeJson' | 'error'> | undefined,
): boolean {
  if (draft === undefined || draft.error !== undefined) return false;
  return yamlText.trim() !== source.yamlText.trim();
}

/** Declared conflicts first, then implicit pairs; stable within each. */
export function sortSodFindings(
  findings: readonly SodFindingView[],
): readonly SodFindingView[] {
  const rank = (f: SodFindingView) => (f.ruleId === 'sod.declared-conflict' ? 0 : 1);
  return [...findings].sort(
    (a, b) => rank(a) - rank(b) || a.pair.join(',').localeCompare(b.pair.join(',')),
  );
}
