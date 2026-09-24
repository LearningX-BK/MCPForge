// MCPForge — `forge identity remap`. W0-D4, 02 §4.4 item 3.
//
// "A subject-migration tool (`forge identity remap`) exists from Wave 0 to
// rewrite the local-subject → AD-subject correspondence in the mapping
// files, because the one thing that genuinely changes at swap time is the
// subject value." The rewrite itself lives in
// `../lib/group-role-mapping.ts`; this file is the command surface: argument
// handling, the error taxonomy, and human/JSON rendering, following the same
// split as `./audit.ts` (the command formats; it does not implement).

import path from 'node:path';
import {
  remapSubjectAcrossMappingFiles,
  type MappingParseError,
  type RemapChangedRow,
} from '../lib/group-role-mapping.js';

/** Default root: every deployment's mapping files live under `overlays/<deployment>/mappings/`. */
export const DEFAULT_MAPPINGS_ROOT = 'overlays';

export interface IdentityRemapOptions {
  readonly json: boolean;
  readonly from?: string;
  readonly to?: string;
  /** Override for tests / a non-default overlay layout. Default: `overlays`. */
  readonly mappingsRoot?: string;
}

export interface IdentityRemapReport {
  readonly ok: boolean;
  readonly fromSubject: string;
  readonly toSubject: string;
  readonly mappingsRoot: string;
  /** One row per mapping file actually changed — empty is a valid, reportable outcome. */
  readonly changed: readonly RemapChangedRow[];
  /** Mapping files that failed to parse and were skipped, not silently dropped. */
  readonly errors: readonly MappingParseError[];
}

export interface IdentityRemapCliError {
  readonly ok: false;
  readonly code: 'INPUT_INVALID';
  readonly message: string;
  readonly next: string;
}

function usageError(message: string): IdentityRemapCliError {
  return {
    ok: false,
    code: 'INPUT_INVALID',
    message,
    next: 'Run "forge identity remap --from <old-subject> --to <new-subject> [--json]" — both flags are required and must be non-empty, distinct subject values.',
  };
}

/** The remap itself, separated from CLI parsing and output formatting (mirrors audit.ts). */
export function runIdentityRemap(
  fromSubject: string,
  toSubject: string,
  mappingsRoot: string,
): IdentityRemapReport {
  const { changed, errors } = remapSubjectAcrossMappingFiles(mappingsRoot, fromSubject, toSubject);
  return {
    ok: errors.length === 0,
    fromSubject,
    toSubject,
    mappingsRoot,
    changed,
    errors,
  };
}

export function formatIdentityRemapReportHuman(report: IdentityRemapReport): string {
  const lines: string[] = [];
  lines.push(
    `forge identity remap: ${report.fromSubject} -> ${report.toSubject} (root: ${report.mappingsRoot})`,
  );
  if (report.changed.length === 0) {
    lines.push(
      `  No subjectOverrides entry for "${report.fromSubject}" was found in any mapping file — nothing to change.`,
    );
  }
  for (const row of report.changed) {
    const rel = path.relative(process.cwd(), row.filePath);
    const mergeNote = row.mergedWithExisting
      ? ' (merged into an existing entry for the target subject)'
      : '';
    lines.push(
      `  ${rel}: ${row.fromSubject} -> ${row.toSubject} — roles: [${row.roles.join(', ')}]${mergeNote}`,
    );
  }
  for (const err of report.errors) {
    const rel = path.relative(process.cwd(), err.filePath);
    lines.push(`  SKIPPED (parse error) ${rel}: ${err.message}`);
  }
  return lines.join('\n');
}

/**
 * `forge identity remap --from <subject> --to <subject> [--mappings-root <dir>] [--json]`.
 *
 * Exit 0 when the walk completed and every visited mapping file parsed
 * cleanly (a zero-row result is still exit 0 — "found nothing to change" is
 * not a failure); exit 1 when any mapping file under the root failed to
 * parse, per CLAUDE.md §2 item 5's "never a dead end" — the report names
 * every skipped file and why. Exit 64 (INPUT_INVALID, matching the CLI's
 * `emitNotImplemented` usage-error convention) when `--from`/`--to` are
 * missing, empty, or identical.
 */
export function runIdentityRemapCommand(opts: IdentityRemapOptions): number {
  const from = opts.from?.trim();
  const to = opts.to?.trim();
  if (!from || !to) {
    return emitCliError(
      usageError('Both --from and --to are required and must be non-empty.'),
      opts.json,
    );
  }
  if (from === to) {
    return emitCliError(
      usageError(
        '--from and --to must be different subject values — there is nothing to remap otherwise.',
      ),
      opts.json,
    );
  }

  const mappingsRoot = opts.mappingsRoot ?? DEFAULT_MAPPINGS_ROOT;
  const report = runIdentityRemap(from, to, mappingsRoot);

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(`${formatIdentityRemapReportHuman(report)}\n`);
  }
  return report.ok ? 0 : 1;
}

const USAGE_EXIT_CODE = 64;

function emitCliError(error: IdentityRemapCliError, json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify(error)}\n`);
  } else {
    process.stderr.write(`forge: identity remap — ${error.message}\n`);
    process.stderr.write(`forge: next — ${error.next}\n`);
  }
  return USAGE_EXIT_CODE;
}
