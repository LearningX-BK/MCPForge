// MCPForge — W0-J18: loading the role sources the editor opens with.
//
// Server-only (`node:fs`), read-only, and read from the SAME two places the
// governance mechanism lives in: the authored `roles/*.yaml` and the compiled
// `generated/roles/*.scope.json`. The compiled artefact on disk is the
// "currently merged scope" the live compile is diffed against (02 §4.3), so it
// is read, never re-derived — re-deriving it here would give the portal a
// second opinion about what is already granted, and two opinions is how a
// widening goes unseen.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { resolveRepoRoot } from '../../build/_lib/repo-root';
import type { RoleSource } from '../types';

function readMergedScope(repoRoot: string, roleId: string): {
  toolIds: readonly string[];
  json: string;
} {
  const abs = join(repoRoot, 'generated', 'roles', `${roleId}.scope.json`);
  if (!existsSync(abs)) return { toolIds: [], json: '' };
  const json = readFileSync(abs, 'utf8');
  try {
    const doc = JSON.parse(json) as Record<string, unknown>;
    const toolIds = Array.isArray(doc['toolIds'])
      ? doc['toolIds'].filter((t): t is string => typeof t === 'string')
      : [];
    return { toolIds, json };
  } catch {
    // An unparseable committed artefact means "we do not know what is merged".
    // Reporting an empty base would render every tool as newly ADDED, which
    // overstates the grant change; reporting no base at all is honest.
    return { toolIds: [], json };
  }
}

/** Every role in `roles/`, sorted by id, with its merged compiled scope. */
export function loadRoleSources(repoRoot: string = resolveRepoRoot()): readonly RoleSource[] {
  const dir = join(repoRoot, 'roles');
  if (!existsSync(dir)) return [];
  const out: RoleSource[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue;
    const yamlText = readFileSync(join(dir, name), 'utf8');
    let doc: Record<string, unknown>;
    try {
      doc = (parseYaml(yamlText) ?? {}) as Record<string, unknown>;
    } catch {
      // An unparseable file in `roles/` is not a role this editor can open.
      continue;
    }
    if (doc['kind'] !== 'Role') continue;
    const roleId = typeof doc['id'] === 'string' ? doc['id'] : name.replace(/\.ya?ml$/, '');
    const merged = readMergedScope(repoRoot, roleId);
    out.push({
      roleId,
      label: typeof doc['label'] === 'string' ? doc['label'] : roleId,
      path: `roles/${name}`,
      yamlText,
      mergedToolIds: merged.toolIds,
      mergedScopeJson: merged.json,
      scopePath: `generated/roles/${roleId}.scope.json`,
    });
  }
  return out.sort((a, b) => a.roleId.localeCompare(b.roleId));
}
