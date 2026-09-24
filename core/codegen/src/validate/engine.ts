// MCPForge — the `forge validate` engine. W0-B2.
//
// Two passes, in order: structural (the W0-B1 Ajv schema, translated into
// MCPForge's rule-id/file/path/fix shape) then referential integrity (this
// module's own rules, reaching across files). The W0-B3 policy/safety rules
// are a later, separate task that plugs into the same `ValidationRule` seam
// (see types.ts) — nothing here implements them.

import { POLICY_RULES } from '../rules/index.js';
import { loadEnumNames, loadManifestFiles } from './loader.js';
import { REFERENTIAL_RULES } from './referential.js';
import { resolvedKindAndId, structuralFailures } from './structural.js';
import type { IndexedManifest, RepoContext, ValidationReport, ValidationRule } from './types.js';

export type {
  IndexedManifest,
  ManifestFile,
  RepoContext,
  ValidationFailure,
  ValidationReport,
  ValidationRule,
} from './types.js';
export { REFERENTIAL_RULES } from './referential.js';
export { loadEnumNames, loadManifestFiles } from './loader.js';
export { resolvedKindAndId } from './structural.js';
export { POLICY_RULES } from '../rules/index.js';

/**
 * Run `forge validate` against every manifest file under `manifests/`,
 * `roles/`, `packages/` and `consumers/` beneath `repoRoot`.
 *
 * `extraRules` is the seam W0-B3 plugged its policy/safety rules into, without
 * this function's shape changing — they run against the identical
 * `RepoContext` the referential rules do. It DEFAULTS to `POLICY_RULES`, so
 * every caller of `validateRepo` (the `forge validate` command, codegen, CI)
 * gets the structural, referential and policy passes together and a caller has
 * to pass an explicit array to get fewer. Silence is the safe direction.
 */
export function validateRepo(
  repoRoot: string,
  extraRules: readonly ValidationRule[] = POLICY_RULES,
): ValidationReport {
  const files = loadManifestFiles(repoRoot);
  const enumNames = loadEnumNames(repoRoot);

  const manifests: IndexedManifest[] = [];
  for (const file of files) {
    const resolved = resolvedKindAndId(file);
    if (resolved) {
      manifests.push({
        file,
        kind: resolved.kind,
        id: resolved.id,
        doc: (file.doc ?? {}) as Record<string, unknown>,
      });
    }
  }

  const ctx: RepoContext = { repoRoot, files, manifests, enumNames };

  const structural = files.flatMap((f) => structuralFailures(f));
  const referential = [...REFERENTIAL_RULES, ...extraRules].flatMap((rule) => rule.check(ctx));

  const all = [...structural, ...referential];
  // ABSENT SEVERITY MEANS ERROR — a rule must say `warning` explicitly to be
  // downgraded, so a typo or a forgotten field can only ever fail the build,
  // never silently pass it.
  const failures = all.filter((f) => f.severity !== 'warning');
  const warnings = all.filter((f) => f.severity === 'warning');
  return {
    ok: failures.length === 0,
    filesChecked: files.length,
    failures,
    warnings,
  };
}
