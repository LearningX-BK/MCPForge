// MCPForge — W0-J14: the structural (schema) half of the editor's inline
// `forge validate` diagnostics.
//
// Reuses the REAL, sole structural validator — `validateManifest` from
// `@mcpforge/codegen/schema` (the Ajv-compiled `mcpforge/v1` schemas, the
// same function `core/codegen/src/validate/structural.ts` calls for `forge
// validate` itself) — never a second hand-written check (CLAUDE.md §5).
// Pure and dependency-free of the filesystem, so it runs CLIENT-SIDE, live,
// on every edit: this is deliberately the FAST half of validation. The
// referential/policy half (cross-file rules: disambiguation, SoD, the
// `forge validate` ~40-rule suite) needs the whole repo's manifests as
// context and cannot run per-keystroke in a browser tab — that half is
// `_lib/repo-validate.ts`'s server action, run on demand (the right pane's
// "Run validate" action), not on every keystroke. Splitting fast/structural
// from slow/referential is this task's one performance judgment call.
import { parse as parseYaml } from 'yaml';
import { validateManifest } from '@mcpforge/codegen/schema';
import { locateYamlPointer } from './yaml-location';

export interface StructuralDiagnostic {
  readonly line: number;
  readonly path: string;
  readonly message: string;
  readonly severity: 'error';
}

export interface StructuralCheckResult {
  readonly ok: boolean;
  readonly kind: string | null;
  readonly diagnostics: readonly StructuralDiagnostic[];
}

export function runStructuralCheck(yamlText: string): StructuralCheckResult {
  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
  } catch (err) {
    return {
      ok: false,
      kind: null,
      diagnostics: [
        {
          line: 1,
          path: '/',
          message: `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
          severity: 'error',
        },
      ],
    };
  }

  const result = validateManifest(doc);
  if (result.ok) {
    return { ok: true, kind: result.kind, diagnostics: [] };
  }
  const diagnostics = (result.issues ?? []).map((issue) => ({
    line: locateYamlPointer(yamlText, issue.path).line,
    path: issue.path,
    message: issue.message,
    severity: 'error' as const,
  }));
  return { ok: false, kind: result.kind, diagnostics };
}
