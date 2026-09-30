'use server';
// MCPForge — W0-J14: the right pane's "validate rules" check — the full
// `forge validate` (structural + referential + the ~40 policy rules),
// reused as-is via `validateRepo` (`@mcpforge/codegen/validate`, the SAME
// function the `forge validate` CLI command calls — `core/cli/src/
// commands/validate.ts` imports it by this exact name). This is the seam
// the task brief asked for explicitly: "a browser-side editor cannot
// literally shell out to the `forge` CLI ... figure out the right seam (a
// Next.js API route/server action, never a second hand-written validator)."
// This file is that seam, as a Next.js Server Action.
//
// WHY A SANDBOX COPY, NOT THE LIVE REPO: `validateRepo` takes a directory,
// not an in-memory document — it needs every OTHER manifest on disk too,
// because the referential and policy passes are cross-file (disambiguation,
// SoD, enumRef membership). The draft is not a file in the working tree
// (`ChangeHost.saveDraft` is what commits it to a branch — W0-J12) and
// running this against the real `manifests/` tree would require writing an
// unsaved, possibly-invalid draft into the actual working tree for every
// "Run validate" click, which could corrupt a concurrent `forge codegen`/
// `git status` elsewhere on the same machine. So: copy the real definitional
// trees into an OS temp directory, overlay the draft's YAML at its real
// manifest path inside that copy, validate the copy, delete it. Nothing
// about `validateRepo` itself is touched or reimplemented.
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateRepo, type ValidationFailure } from '@mcpforge/codegen/validate';
import { resolveRepoRoot } from './repo-root';

export interface DraftValidationResult {
  readonly ok: boolean;
  readonly filesChecked: number;
  /** Every failure/warning, sorted. `concernsDraft` flags the ones whose `file` is this draft. */
  readonly failures: readonly (ValidationFailure & { readonly concernsDraft: boolean })[];
  readonly warnings: readonly (ValidationFailure & { readonly concernsDraft: boolean })[];
}

// `approvals` must be copied too: a role's `bindingGrants[].standingAuthorization`
// (02 §11.4.4) resolves against committed records under `approvals/`, and
// without it here the sandbox disagrees with the real `forge validate` on
// any role carrying one — a real gap, not a hypothetical, surfaced by
// `roles/p2p.yaml` gaining its first real `bindingGrants` entry (W0-HG8).
const COPY_DIRS = ['manifests', 'roles', 'packages', 'consumers', 'enums', 'approvals'] as const;

/**
 * Run the full `forge validate` suite against the repo's real definitional
 * trees with `yamlText` overlaid at `manifestPath` (repo-relative, e.g.
 * `manifests/jde/fin/ap/voucher.create.tool.yaml`).
 */
export async function runFullDraftValidation(
  manifestPath: string,
  yamlText: string,
): Promise<DraftValidationResult> {
  const repoRoot = resolveRepoRoot();
  const sandbox = mkdtempSync(join(tmpdir(), 'mcpforge-build-validate-'));
  try {
    for (const dir of COPY_DIRS) {
      const src = join(repoRoot, dir);
      if (existsSync(src)) {
        cpSync(src, join(sandbox, dir), { recursive: true });
      }
    }
    const draftAbsPath = join(sandbox, manifestPath);
    mkdirSync(dirname(draftAbsPath), { recursive: true });
    writeFileSync(draftAbsPath, yamlText, 'utf8');

    const report = validateRepo(sandbox);
    const draftFile = manifestPath.split('\\').join('/');
    const tag = (f: ValidationFailure) => ({ ...f, concernsDraft: f.file === draftFile });
    return {
      ok: report.ok,
      filesChecked: report.filesChecked,
      failures: report.failures.map(tag),
      warnings: report.warnings.map(tag),
    };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}
