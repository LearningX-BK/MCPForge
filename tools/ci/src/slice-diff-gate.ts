// `forge ci` stage 11 — the slice-diff proof (P1, "no branch of MCPForge is
// ever created for a customer"). W0-P1, 02 §6.4, 02 §7.2 stage 11.
//
// WHICH STAGE, AND WHY NOT A NEW ONE. Stage 11 is already named
// `slice-diff-proof`, failing on "any unexplained file difference between two
// slices, or core digest mismatch". Until now it carried
// `notImplemented('a later Track M/package task')` — but `forge slice-diff`
// landed (`core/cli/src/commands/slice-diff.ts`, W0-K5) and the stage was
// never connected to it.
//
// WHY A SUBPROCESS. Same as `bench-gate.ts` and `validate-gate.ts`:
// `@mcpforge/cli` depends on `@mcpforge/ci`, so importing the command would
// be a workspace cycle, and gating on the real `bin/forge.js` means CI checks
// the exit code a developer can reproduce.
//
// WHICH PAIR. The proof is a property of ANY two slices, so the gate does not
// hardcode a pair: it enumerates `packages/*.yaml`, sorts by id, and runs
// every unordered pair. Wave 0's package count is tiny, and a pair-count that
// grows quadratically with a handful of slices is cheaper than choosing one
// pair and calling it the proof.
//
// FAILS CLOSED WITH FEWER THAN TWO SLICES — and this is the one place where
// that choice has a visible consequence, so it is stated plainly rather than
// buried:
//
//   The repo currently defines ONE package (`packages/jde-fin.yaml`). A
//   two-slice proof cannot run against one slice. The three ways out are not
//   equal:
//     (a) report `not_implemented` — that is what this stage did before, and
//         it is what CLAUDE.md §5 and this file's sibling header call a gate
//         that has "not run at all". It hides an unproven claim behind a
//         green pipeline.
//     (b) diff `jde-fin` against itself — trivially identical, proves
//         nothing, and is a manufactured pass. Forbidden outright.
//     (c) FAIL, naming the missing artefact.
//   This gate does (c). A second slice definition is a human-authored
//   artefact (a real selection for a real deployment, `packages/<id>.yaml`),
//   not something CI or an agent may invent — CLAUDE.md §8: "do not stub it,
//   do not fake it". So until one exists, `forge ci` reports stage 11 red and
//   says exactly why. Per TASKS.md's own exit-criteria rule, a fail is
//   answered with a written waiver naming who accepted the risk and until
//   when — not by softening the gate.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { StageOutcome } from './stages.js';

export interface SliceDiffRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Injectable for tests. Production runs the real `bin/forge.js`. */
export type SliceDiffRunner = (repoRoot: string, a: string, b: string) => SliceDiffRun;

const defaultRunner: SliceDiffRunner = (repoRoot, a, b) => {
  const bin = join(repoRoot, 'core', 'cli', 'bin', 'forge.js');
  const run = spawnSync(process.execPath, [bin, 'slice-diff', a, b, '--json', '--root', repoRoot], {
    cwd: repoRoot,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return { code: run.status ?? 1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
};

/** The two fields of `forge slice-diff --json` this gate reads. Structural, over a process boundary. */
interface SliceDiffJson {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly next?: string;
  readonly onlyInA?: readonly string[];
  readonly onlyInB?: readonly string[];
}

/** Every package id defined in `packages/`, sorted. Exported so a test can assert the discovery. */
export function discoverPackageIds(repoRoot: string): readonly string[] {
  const dir = join(repoRoot, 'packages');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => f.replace(/\.ya?ml$/, ''))
    .sort((a, b) => a.localeCompare(b));
}

export function unorderedPairs(ids: readonly string[]): readonly (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      pairs.push([ids[i]!, ids[j]!]);
    }
  }
  return pairs;
}

export function runSliceDiffGate(
  repoRoot: string,
  runner: SliceDiffRunner = defaultRunner,
): StageOutcome {
  const ids = discoverPackageIds(repoRoot);

  if (ids.length < 2) {
    return {
      status: 'failed',
      detail: [
        `The no-fork proof compares two slices and this repo defines ${ids.length} (${ids.length === 0 ? 'none' : ids.join(', ')}).`,
        'This gate fails rather than reporting `not_implemented` or diffing a slice against itself: a two-slice proof that has never run is an unproven claim, and a self-comparison is a manufactured pass.',
        'next: author a second slice definition — `packages/<id>.yaml`, a real selection for a real deployment — and commit it; or record a written waiver naming who accepted the unproven no-fork claim and until when (TASKS.md, Wave 0 exit criteria). A slice definition is a human-authored artefact; CI must not invent one.',
      ].join('\n'),
    };
  }

  const pairs = unorderedPairs(ids);
  const failures: string[] = [];

  for (const [a, b] of pairs) {
    let run: SliceDiffRun;
    try {
      run = runner(repoRoot, a, b);
    } catch (err) {
      failures.push(
        `${a} vs ${b}: \`forge slice-diff\` could not be spawned — ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    let report: SliceDiffJson | null;
    try {
      report = JSON.parse(run.stdout.trim()) as SliceDiffJson;
    } catch {
      report = null;
    }

    if (report === null) {
      failures.push(
        `${a} vs ${b}: exited ${run.code} and its stdout was not parseable JSON, so this gate cannot tell a pass from a failure.\n  ${(run.stderr || run.stdout).trim().slice(0, 1000)}`,
      );
      continue;
    }

    if (!report.ok || run.code !== 0) {
      const only = [
        ...(report.onlyInA ?? []).map((p) => `${p} (only in ${a})`),
        ...(report.onlyInB ?? []).map((p) => `${p} (only in ${b})`),
      ];
      failures.push(
        [
          `${a} vs ${b}: ${report.code ?? `exit ${run.code}`} — ${report.message ?? 'slice-diff reported a failure.'}`,
          ...only.slice(0, 10).map((p) => `  ${p}`),
          report.next === undefined ? undefined : `  next: ${report.next}`,
        ]
          .filter((line): line is string => line !== undefined)
          .join('\n'),
      );
    }
  }

  if (failures.length > 0) {
    return {
      status: 'failed',
      detail: [
        `${failures.length} of ${pairs.length} slice pair(s) failed the no-fork proof:`,
        ...failures,
      ].join('\n'),
    };
  }

  return {
    status: 'passed',
    detail: `${pairs.length} slice pair(s) across ${ids.length} slice(s) (${ids.join(', ')}) differ only in selection — no unexplained file difference, no core digest mismatch.`,
  };
}
