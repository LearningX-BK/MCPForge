'use server';
// MCPForge — W0-J18: the LIVE compile behind the Roles tab's right pane.
//
// 02 §8.1 item 4: "Role editing must show the compiled scope diff and any SoD
// conflict before the PR is opened. A role editor that hides which tools a glob
// picks up is the exact failure this architecture is designed to prevent."
//
// So this is not a preview. Every number and every tool id the right pane shows
// is produced by running the REAL mechanisms against a sandbox copy of the repo
// with the edited role YAML overlaid at `roles/<id>.yaml`:
//
//   runCodegen           -> writes `generated/roles/<id>.scope.json` through
//                           `compileGovernanceArtefacts` / `compileRoleScope`
//                           (core/codegen/src/compile/**, W0-B8). The tool-id
//                           list rendered on the right is READ OUT OF THAT
//                           ARTEFACT, and its bytes are the file the change
//                           proposal carries. One compiler, one artefact, one
//                           diff.
//   runTokenBudgetGate   -> the 02 §5.3(d) role core-set sum with the SAME
//                           pinned counter CI uses, and `chooseDemotions`'s own
//                           list of tools to demote when over 1,300.
//   validateRepo(SOD_RULES) -> the REAL `sod.declared-conflict` and
//                           `sod.implicit-create-approve` rules, so the panel
//                           and `forge validate` cannot disagree.
//
// WHY A SANDBOX, NOT THE LIVE REPO: identical to W0-J14's
// `build/_lib/checks.ts`, whose header states it in full — the draft is not a
// file in the working tree (`ChangeHost.saveDraft` is what commits it), the
// compilers take a directory rather than a document because role compilation is
// cross-file (globs resolve against every Tool manifest), and writing an
// unsaved role into the real tree on every keystroke could corrupt a concurrent
// `forge codegen`. Never a subprocess: `forge` is called as a library, exactly
// as W0-J14 established.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateRepo, type ValidationFailure } from '@mcpforge/codegen/validate';
import { runTokenBudgetGate } from '@mcpforge/codegen/budget/server';
import { runCodegen } from '@mcpforge/codegen/emit';
import {
  IMPLICIT_SOD_VERBS,
  SOD_RULES,
  entityPrefix,
  toolVerb,
} from '@mcpforge/codegen/compile';
import { TOKEN_BUDGETS } from '@mcpforge/shared/tokens';

import { resolveRepoRoot } from '../../build/_lib/repo-root';
import type { CompiledRoleDraft, RoleBudgetView, SodFindingView } from '../types';
import { diffToolIds } from './scope-diff';

/** The definitional trees a role compile reads. `generated` is copied so the
 *  contract-hash comparison runCodegen performs is the real one. */
const COPY_DIRS = [
  'manifests',
  'roles',
  'packages',
  'consumers',
  'enums',
  'approvals',
  'generated',
] as const;

/**
 * Root files the deterministic writer reads. `.prettierrc` matters: codegen
 * formats its JSON with the REPO's prettier config, so a sandbox without it
 * would produce artefact bytes that differ from the committed ones for no
 * reason but formatting — and the right pane would show a spurious diff.
 */
const COPY_FILES = ['.prettierrc', '.prettierignore', '.editorconfig'] as const;

export async function roleSourcePath(roleId: string): Promise<string> {
  return `roles/${roleId}.yaml`;
}

export async function roleScopePath(roleId: string): Promise<string> {
  return `generated/roles/${roleId}.scope.json`;
}

/** One declared conflict as the COMPILED artefact records it (02 §4.3). */
interface CompiledSodEntry {
  readonly conflict: readonly string[];
  readonly disposition: string;
  readonly inScope: boolean;
}

/**
 * The SoD panel: declared conflicts and implicit create/approve pairs, each
 * with its disposition.
 *
 * Both halves come from real logic, neither is re-derived by hand:
 *   - declared: the compiled artefact's own `segregationOfDuties` entries,
 *     including `inScope` — the field `compileRoleScope` computes to say
 *     whether the role's resolved globs actually grant both halves.
 *   - implicit: `entityPrefix` / `toolVerb` / `IMPLICIT_SOD_VERBS`, the exact
 *     exported functions `sod.implicit-create-approve` itself uses, applied to
 *     the compiled tool-id list.
 * The rule report (`SOD_RULES` via `validateRepo`) supplies each finding's
 * message and fix, so the panel's prose is the rule's own prose.
 */
function readSodFindings(
  sandbox: string,
  roleId: string,
  toolIds: readonly string[],
  declared: readonly CompiledSodEntry[],
): SodFindingView[] {
  // SOD_RULES only — the SoD panel is a segregation-of-duties panel, and
  // running the whole policy set here would put unrelated manifest failures in
  // it. The rules themselves are the real ones, unmodified.
  const report = validateRepo(sandbox, SOD_RULES);
  const roleFile = `roles/${roleId}.yaml`;
  const failures = [...report.failures, ...report.warnings].filter(
    (f: ValidationFailure) => f.file === roleFile,
  );
  const forRule = (ruleId: string, pair: readonly string[]) =>
    failures.find((f) => f.ruleId === ruleId && pair.every((t) => f.message.includes(t)));

  const rows: SodFindingView[] = [];

  for (const entry of declared) {
    if (!entry.inScope) continue;
    const pair = [...entry.conflict].sort();
    const found = forRule('sod.declared-conflict', pair);
    rows.push({
      ruleId: 'sod.declared-conflict',
      severity: entry.disposition === 'block' ? 'error' : 'warning',
      pair,
      disposition: entry.disposition,
      message: found?.message ?? '',
      fix: found?.fix ?? '',
    });
  }

  const verbsByEntity = new Map<string, Set<string>>();
  for (const id of toolIds) {
    const prefix = entityPrefix(id);
    const verb = toolVerb(id);
    if (prefix === null || verb === null) continue;
    const set = verbsByEntity.get(prefix) ?? new Set<string>();
    set.add(verb);
    verbsByEntity.set(prefix, set);
  }
  for (const prefix of [...verbsByEntity.keys()].sort()) {
    const verbs = verbsByEntity.get(prefix)!;
    if (!IMPLICIT_SOD_VERBS.every((v) => verbs.has(v))) continue;
    const pair = IMPLICIT_SOD_VERBS.map((v) => `${prefix}.${v}`).sort();
    const found = forRule('sod.implicit-create-approve', pair);
    const declaredHere = declared.find((e) => pair.every((t) => e.conflict.includes(t)));
    rows.push({
      ruleId: 'sod.implicit-create-approve',
      // 02 §4.3 attaches `disposition` to a DECLARED conflict; an undeclared
      // pattern has none, and saying so is the finding.
      severity: 'warning',
      pair,
      disposition: declaredHere?.disposition ?? null,
      message: found?.message ?? '',
      fix: found?.fix ?? '',
    });
  }

  return rows;
}

function readDeclared(artefact: Record<string, unknown>): readonly CompiledSodEntry[] {
  const raw = artefact['segregationOfDuties'];
  if (!Array.isArray(raw)) return [];
  const out: CompiledSodEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    out.push({
      conflict: Array.isArray(e['conflict'])
        ? e['conflict'].filter((t): t is string => typeof t === 'string')
        : [],
      disposition: typeof e['disposition'] === 'string' ? e['disposition'] : '',
      inScope: e['inScope'] === true,
    });
  }
  return out;
}

function readBudget(sandbox: string, roleId: string): RoleBudgetView {
  const gate = runTokenBudgetGate(sandbox);
  const measured = gate.roles[roleId];
  const failure = gate.failures.find((f) => f.kind === 'roleCoreSet' && f.id === roleId);
  const coreSetTokens = measured?.coreSetTokens ?? 0;
  return {
    coreSetTokens,
    limit: TOKEN_BUDGETS.roleCoreSet,
    overBudget: coreSetTokens > TOKEN_BUDGETS.roleCoreSet,
    demote: failure?.demote ?? [],
    message: failure?.message ?? null,
  };
}

function failed(roleId: string, message: string, next: string): CompiledRoleDraft {
  return {
    roleId,
    toolIds: [],
    scopeJson: '',
    toolsAdded: [],
    toolsRemoved: [],
    budget: { coreSetTokens: 0, limit: TOKEN_BUDGETS.roleCoreSet, overBudget: false, demote: [], message: null },
    sod: [],
    error: { message, next },
  };
}

/**
 * Compile `yamlText` as `roles/<roleId>.yaml` and report the explicit tool-id
 * list, the budget, the SoD findings and the delta against `mergedToolIds`.
 */
export async function compileRoleDraft(
  roleId: string,
  yamlText: string,
  mergedToolIds: readonly string[],
): Promise<CompiledRoleDraft> {
  const repoRoot = resolveRepoRoot();
  let sandbox: string;
  try {
    sandbox = mkdtempSync(join(tmpdir(), 'mcpforge-governance-role-'));
  } catch (err) {
    return failed(
      roleId,
      `A sandbox for the live compile could not be created: ${String(err)}.`,
      'Check the portal process can write to the system temp directory, then edit the role again.',
    );
  }
  try {
    for (const dir of COPY_DIRS) {
      const src = join(repoRoot, dir);
      if (existsSync(src)) cpSync(src, join(sandbox, dir), { recursive: true });
    }
    for (const file of COPY_FILES) {
      const src = join(repoRoot, file);
      if (existsSync(src)) cpSync(src, join(sandbox, file));
    }
    const rolePath = join(sandbox, 'roles', `${roleId}.yaml`);
    mkdirSync(dirname(rolePath), { recursive: true });
    writeFileSync(rolePath, yamlText, 'utf8');

    // Remove the COPIED compiled artefact before compiling. Its presence
    // afterwards is then proof that THIS run's compiler wrote it — without
    // this, a role source codegen silently skipped (unparseable YAML, wrong
    // kind) would leave the previous artefact in place and the right pane
    // would show a stale tool list as though it were the live one. That is
    // precisely the failure 02 §8.1 item 4 names.
    const scopeAbs = join(sandbox, 'generated', 'roles', `${roleId}.scope.json`);
    rmSync(scopeAbs, { force: true });

    try {
      await runCodegen(sandbox);
    } catch (err) {
      return failed(
        roleId,
        `The edited role did not compile: ${err instanceof Error ? err.message : String(err)}`,
        `Fix roles/${roleId}.yaml in the editor on the left — the compiled scope stays empty until it compiles, so nothing here is stale.`,
      );
    }

    if (!existsSync(scopeAbs)) {
      return failed(
        roleId,
        `codegen wrote no generated/roles/${roleId}.scope.json for this edit, so there is no compiled scope to show.`,
        `Check that roles/${roleId}.yaml still declares "kind: Role" and "id: ${roleId}", then edit again.`,
      );
    }
    const scopeJson = readFileSync(scopeAbs, 'utf8');
    const artefact = JSON.parse(scopeJson) as Record<string, unknown>;
    const toolIds = Array.isArray(artefact['toolIds'])
      ? artefact['toolIds'].filter((t): t is string => typeof t === 'string')
      : [];

    const delta = diffToolIds(mergedToolIds, toolIds);
    return {
      roleId,
      toolIds,
      scopeJson,
      toolsAdded: delta.added,
      toolsRemoved: delta.removed,
      budget: readBudget(sandbox, roleId),
      sod: readSodFindings(sandbox, roleId, toolIds, readDeclared(artefact)),
    };
  } catch (err) {
    return failed(
      roleId,
      `The live compile failed: ${err instanceof Error ? err.message : String(err)}`,
      `Re-open /governance and edit roles/${roleId}.yaml again; if it persists, run \`forge codegen\` locally to see the same failure with its full output.`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}
