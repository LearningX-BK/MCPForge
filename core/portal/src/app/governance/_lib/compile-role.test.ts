// MCPForge — W0-J18: proof that the Roles tab's right pane is a REAL compile.
//
// The failure mode this task exists to prevent (02 §8.1 item 4) is a role
// editor that shows a tool list which is not the one the glob actually picks
// up. A test that asserts against a hand-written expected list would not catch
// that — it would only prove the mock and the expectation agree. So every
// assertion below cross-checks the portal's answer against one of:
//   (a) the committed `generated/roles/p2p.scope.json` (what CI verifies), or
//   (b) a DIRECT call to `compileRoleScope` — the real W0-B8 compiler function
//       — on the same edited role, or
//   (c) the real `runTokenBudgetGate` / `chooseDemotions` output.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { compileRoleScope, type RoleView } from '@mcpforge/codegen/compile';

import { compileRoleDraft } from './compile-role';
import { loadRoleSources } from './repo-roles';
import { resolveRepoRoot } from '../../build/_lib/repo-root';

const repoRoot = resolveRepoRoot();
const sources = loadRoleSources(repoRoot);
const p2p = sources.find((r) => r.roleId === 'p2p');

/** Read the role doc and swap `includes`, returning YAML the compiler will read. */
function withIncludes(yamlText: string, includes: readonly string[]): string {
  const doc = parseYaml(yamlText) as Record<string, unknown>;
  return stringifyYaml({ ...doc, includes: [...includes] });
}

/** The same role, run through the REAL compiler directly, for cross-checking. */
function directCompile(yamlText: string, catalogue: readonly string[]): readonly string[] {
  const doc = parseYaml(yamlText) as Record<string, unknown>;
  const role: RoleView = {
    id: String(doc['id']),
    label: String(doc['label'] ?? doc['id']),
    includes: (doc['includes'] as string[]) ?? [],
    excludes: (doc['excludes'] as string[]) ?? [],
    coreTools: (doc['coreTools'] as string[]) ?? [],
    sensitivityCeiling: String(doc['sensitivityCeiling'] ?? ''),
    writeAllowed: doc['writeAllowed'] === true,
    budgetTokens: typeof doc['budgetTokens'] === 'number' ? doc['budgetTokens'] : null,
    mutuallyExclusiveWith: (doc['mutuallyExclusiveWith'] as string[]) ?? [],
    segregationOfDuties: [],
    bindingGrants: [],
  };
  return compileRoleScope(
    role,
    catalogue,
    { manifestPath: '', manifestSha256: '', codegenVersion: '' },
    '2026-09-09',
  ).toolIds;
}

/** Every Tool id in the repo, as the committed artefact's own scope proves. */
function catalogueIds(): readonly string[] {
  const json = JSON.parse(
    readFileSync(join(repoRoot, 'generated', 'roles', 'p2p.scope.json'), 'utf8'),
  ) as { toolIds: string[] };
  return json.toolIds;
}

describe('loadRoleSources', () => {
  it('finds p2p with its merged compiled scope read from the committed artefact', () => {
    expect(p2p).toBeDefined();
    const committed = JSON.parse(
      readFileSync(join(repoRoot, 'generated', 'roles', 'p2p.scope.json'), 'utf8'),
    ) as { toolIds: string[] };
    expect(p2p!.mergedToolIds).toEqual(committed.toolIds);
    expect(p2p!.path).toBe('roles/p2p.yaml');
    expect(p2p!.scopePath).toBe('generated/roles/p2p.scope.json');
  });
});

describe('compileRoleDraft — the live compile is the real compiler', () => {
  it('reproduces the committed artefact byte-for-byte when nothing is edited', async () => {
    const draft = await compileRoleDraft('p2p', p2p!.yamlText, p2p!.mergedToolIds);
    expect(draft.error).toBeUndefined();
    // (a) — the bytes CI verifies. If the portal used its own compiler, or a
    // mock, or a re-serialisation, this comparison fails.
    expect(draft.scopeJson).toBe(p2p!.mergedScopeJson);
    expect(draft.toolsAdded).toEqual([]);
    expect(draft.toolsRemoved).toEqual([]);
  }, 120_000);

  it('NARROWING a glob removes exactly the tools that glob picked up', async () => {
    // Drop `jde.ap.voucher.*`. Nobody types the expected list here.
    const narrowed = withIncludes(
      p2p!.yamlText,
      (parseYaml(p2p!.yamlText) as { includes: string[] }).includes.filter(
        (g) => g !== 'jde.ap.voucher.*',
      ),
    );
    const draft = await compileRoleDraft('p2p', narrowed, p2p!.mergedToolIds);
    expect(draft.error).toBeUndefined();

    // (b) — cross-check against a direct call to the REAL compiler.
    const expected = directCompile(narrowed, catalogueIds());
    expect(draft.toolIds).toEqual([...expected]);

    // And the change is genuinely visible as a removal, not a silent shrink.
    expect(draft.toolsRemoved.length).toBeGreaterThan(0);
    expect(draft.toolsRemoved.every((id) => id.startsWith('jde.ap.voucher.'))).toBe(true);
    expect(draft.toolsAdded).toEqual([]);
    expect(draft.toolIds).not.toEqual(p2p!.mergedToolIds);
  }, 120_000);

  it('WIDENING a glob adds exactly the tools that glob picks up, diffed against merged', async () => {
    // Replace the five specific includes with one repo-wide glob.
    const widened = withIncludes(p2p!.yamlText, ['jde.**']);
    const draft = await compileRoleDraft('p2p', widened, p2p!.mergedToolIds);
    expect(draft.error).toBeUndefined();

    const expected = directCompile(widened, catalogueIds());
    expect(draft.toolIds).toEqual([...expected]);
    // The whole point of 02 §4.3: widening shows up.
    expect(draft.toolIds.length).toBeGreaterThanOrEqual(p2p!.mergedToolIds.length);
    expect(new Set(draft.toolIds).size).toBe(draft.toolIds.length);
  }, 120_000);

  it('an excludes entry is honoured by the same compiled list', async () => {
    const doc = parseYaml(p2p!.yamlText) as Record<string, unknown>;
    const edited = stringifyYaml({ ...doc, excludes: ['jde.scm.purchase_order.approve'] });
    const draft = await compileRoleDraft('p2p', edited, p2p!.mergedToolIds);
    expect(draft.error).toBeUndefined();
    expect(draft.toolIds).not.toContain('jde.scm.purchase_order.approve');
    expect(draft.toolsRemoved).toContain('jde.scm.purchase_order.approve');
  }, 120_000);

  it('reports the role core-set budget with the 1,300 limit and no demote list when within it', async () => {
    const draft = await compileRoleDraft('p2p', p2p!.yamlText, p2p!.mergedToolIds);
    expect(draft.budget.limit).toBe(1300);
    expect(draft.budget.coreSetTokens).toBeGreaterThan(0);
    expect(draft.budget.overBudget).toBe(draft.budget.coreSetTokens > 1300);
    if (!draft.budget.overBudget) expect(draft.budget.demote).toEqual([]);
  }, 120_000);

  it('NAMES the tools to demote when the core set goes over 1,300', async () => {
    // Promote every tool in the catalogue into coreTools — that is what puts a
    // role over budget, and the meter must answer with tool ids, not a number.
    const doc = parseYaml(p2p!.yamlText) as Record<string, unknown>;
    const everyTool = [...catalogueIds()];
    const fat = stringifyYaml({ ...doc, includes: ['jde.**'], coreTools: everyTool });
    const draft = await compileRoleDraft('p2p', fat, p2p!.mergedToolIds);
    expect(draft.error).toBeUndefined();
    expect(draft.budget.overBudget).toBe(true);
    expect(draft.budget.coreSetTokens).toBeGreaterThan(1300);
    // (c) — the ACTIONABLE list, from the gate's own chooseDemotions.
    expect(draft.budget.demote.length).toBeGreaterThan(0);
    for (const id of draft.budget.demote) expect(everyTool).toContain(id);
    expect(draft.budget.message).toContain('Demote from coreTools');
  }, 120_000);

  it('reports the declared conflict with its authored disposition and the implicit pair', async () => {
    const draft = await compileRoleDraft('p2p', p2p!.yamlText, p2p!.mergedToolIds);
    const declared = draft.sod.filter((f) => f.ruleId === 'sod.declared-conflict');
    const implicit = draft.sod.filter((f) => f.ruleId === 'sod.implicit-create-approve');

    expect(declared).toHaveLength(1);
    expect(declared[0]!.pair).toEqual([
      'jde.scm.purchase_order.approve',
      'jde.scm.purchase_order.create',
    ]);
    // 02 §4.3's real vocabulary, read off the role, never invented here.
    expect(declared[0]!.disposition).toBe('warn-and-require-exception');
    expect(declared[0]!.severity).toBe('warning');
    expect(declared[0]!.message).not.toBe('');

    // The implicit create/approve pattern is reported EVEN THOUGH it is also
    // declared — sod.ts's own stated rule.
    expect(implicit).toHaveLength(1);
    expect(implicit[0]!.pair).toEqual([
      'jde.scm.purchase_order.approve',
      'jde.scm.purchase_order.create',
    ]);
  }, 120_000);

  it('a declared conflict that the edited scope no longer grants stops being reported', async () => {
    const doc = parseYaml(p2p!.yamlText) as Record<string, unknown>;
    const edited = stringifyYaml({ ...doc, excludes: ['jde.scm.purchase_order.approve'] });
    const draft = await compileRoleDraft('p2p', edited, p2p!.mergedToolIds);
    expect(draft.sod.filter((f) => f.ruleId === 'sod.declared-conflict')).toHaveLength(0);
    expect(draft.sod.filter((f) => f.ruleId === 'sod.implicit-create-approve')).toHaveLength(0);
  }, 120_000);

  it('a role source that cannot compile reports an error with an actionable next, and no stale list', async () => {
    const draft = await compileRoleDraft('p2p', ': not : valid : yaml :\n  - [', []);
    expect(draft.error).toBeDefined();
    expect(draft.error!.next.trim()).not.toBe('');
    expect(draft.error!.next.toLowerCase()).not.toContain('try again');
    expect(draft.toolIds).toEqual([]);
    expect(draft.scopeJson).toBe('');
  }, 120_000);
});
