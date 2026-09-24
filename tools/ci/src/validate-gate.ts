// `forge ci` stage 2 — `forge validate`, the ~40 schema + policy rules.
// W0-P1, 02 §7.2 stage 2, CLAUDE.md §5.
//
// WHICH STAGE, AND WHY NOT A NEW ONE. 02 §7.2's stage table is fixed and
// stage 2 is already named `forge validate`, failing on "any manifest/role/
// package schema or policy rule (~40 rules)". Until now it carried
// `notImplemented('W0-B2')` — but W0-B2 landed long ago and
// `core/cli/src/commands/validate.ts` has been passing 17/17 manifests for
// weeks. The stage was never connected to it. No stage is added, renumbered
// or renamed.
//
// WHY A SUBPROCESS AND NOT AN IMPORT. Same reason as `bench-gate.ts`, and it
// is worth restating because the alternative looks cleaner here than it is:
// `@mcpforge/ci` could import `validateRepo` from `@mcpforge/codegen/validate`
// directly and skip the process boundary. It deliberately does not. The stage
// is named after a COMMAND, and a developer's confidence in CI rests on the
// exit code they can reproduce by typing that command. Running the real
// `bin/forge.js validate --json` means the rule set CI gates on is the rule
// set `forge validate` applies, including any flag handling, repo-root
// discovery or output contract that lives in the command rather than in
// `validateRepo`. A direct import would gate on a subset and could drift from
// the command silently. (`@mcpforge/cli` also depends on `@mcpforge/ci`, so
// importing the command itself would be a workspace cycle regardless.)
//
// FAILURE MODES, ALL REAL FAILURES, NEVER A SOFT PASS:
//   1. `forge validate` reports failures -> failed, naming each rule id;
//   2. it exits non-zero without parseable JSON -> failed (a broken gate is a
//      failed gate, not an absent one);
//   3. it cannot be spawned at all -> failed.
// Warnings are REPORTED but do not fail, matching W0-B8's decision that a
// declared segregation-of-duties conflict is a build warning, not a breach.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { StageOutcome } from './stages.js';

/**
 * The fields of `forge validate --json` this gate reads. Structural over a
 * JSON process boundary, by design — the same choice `bench-gate.ts` makes
 * and for the same reason: it reads only what it gates on and tolerates every
 * other field the report carries.
 */
export interface ValidateJsonReport {
  readonly ok: boolean;
  readonly filesChecked?: number;
  readonly failures?: readonly {
    readonly ruleId: string;
    readonly file: string;
    readonly path: string;
    readonly message: string;
    readonly fix: string;
  }[];
  readonly warnings?: readonly {
    readonly ruleId: string;
    readonly file: string;
    readonly path: string;
    readonly message: string;
    readonly fix: string;
  }[];
}

export interface ValidateRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Injectable for tests. Production runs the real `bin/forge.js`. */
export type ValidateRunner = (repoRoot: string) => ValidateRun;

const defaultRunner: ValidateRunner = (repoRoot) => {
  const bin = join(repoRoot, 'core', 'cli', 'bin', 'forge.js');
  const run = spawnSync(process.execPath, [bin, 'validate', '--json'], {
    cwd: repoRoot,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return { code: run.status ?? 1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
};

function truncate(lines: readonly string[], limit = 20): string[] {
  if (lines.length <= limit) return [...lines];
  return [...lines.slice(0, limit), `  … and ${lines.length - limit} more.`];
}

export function runValidateGate(
  repoRoot: string,
  runner: ValidateRunner = defaultRunner,
): StageOutcome {
  let run: ValidateRun;
  try {
    run = runner(repoRoot);
  } catch (err) {
    return {
      status: 'failed',
      detail: [
        `\`forge validate\` could not be spawned: ${err instanceof Error ? err.message : String(err)}`,
        'next: run `pnpm install` and confirm `core/cli/bin/forge.js` exists — this gate fails closed rather than reporting a pass it cannot back up.',
      ].join('\n'),
    };
  }

  let report: ValidateJsonReport;
  try {
    report = JSON.parse(run.stdout.trim()) as ValidateJsonReport;
  } catch {
    return {
      status: 'failed',
      detail: [
        `\`forge validate --json\` exited ${run.code} and its stdout was not parseable JSON, so this gate cannot tell a pass from a failure and reports a failure.`,
        'next: run `forge validate` by hand and fix whatever it reports before re-running `forge ci`.',
        (run.stderr || run.stdout).trim().slice(0, 2000),
      ].join('\n'),
    };
  }

  const warnings = report.warnings ?? [];
  const warningBlock =
    warnings.length === 0
      ? []
      : [
          `${warnings.length} warning(s) — reported, not failing (W0-B8):`,
          ...truncate(warnings.map((w) => `  [${w.ruleId}] ${w.file}${w.path} — ${w.message}`)),
        ];

  const failures = report.failures ?? [];
  if (!report.ok || failures.length > 0) {
    return {
      status: 'failed',
      detail: [
        `forge validate: ${failures.length} failure(s) across ${report.filesChecked ?? 0} manifest file(s).`,
        ...truncate(failures.map((f) => `  [${f.ruleId}] ${f.file}${f.path} — ${f.message}\n    fix: ${f.fix}`)),
        ...warningBlock,
      ].join('\n'),
    };
  }

  return {
    status: 'passed',
    detail: [
      `forge validate: OK — ${report.filesChecked ?? 0} manifest file(s) checked, 0 failures.`,
      ...warningBlock,
    ].join('\n'),
  };
}
