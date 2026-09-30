// MCPForge — W0-P33b: the checks a merge must pass, as `forge` runs them.
//
// SERVER-ONLY (`node:child_process`). The approved design (docs/build-plan/
// w0-p33-portal-merge.md §2.3): `forge codegen` then `forge validate` run on
// the branch before anything is merged, and a failure refuses the merge with
// the rule's own `next`. They run as the real CLI in a child process, pointed
// at the branch's working tree through `MCPFORGE_DEFINITIONS_ROOT` (W0-P33a),
// so "valid" means exactly what it means in CI, with no second definition of
// it in the portal. `execFile` with an argv array: nothing reaches a shell.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import type { MergeCheck } from './types';

const run = promisify(execFile);

interface ForgeOutcome {
  readonly ok: boolean;
  readonly json: unknown;
  readonly text: string;
}

async function forge(
  runtimeRoot: string,
  tree: string,
  args: readonly string[],
): Promise<ForgeOutcome> {
  const bin = path.join(runtimeRoot, 'core', 'cli', 'bin', 'forge.js');
  const env = { ...process.env, MCPFORGE_DEFINITIONS_ROOT: tree };
  try {
    const { stdout } = await run(process.execPath, [bin, ...args, '--json'], {
      cwd: runtimeRoot,
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, json: parseLastJson(stdout), text: stdout };
  } catch (error) {
    const stdout = (error as { stdout?: unknown }).stdout;
    const text = typeof stdout === 'string' ? stdout : '';
    return { ok: false, json: parseLastJson(text), text };
  }
}

function parseLastJson(text: string): unknown {
  const line = text
    .trim()
    .split('\n')
    .reverse()
    .find((l) => l.trim().startsWith('{'));
  if (line === undefined) return undefined;
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

interface ValidationFailureLike {
  readonly ruleId?: string;
  readonly file?: string;
  readonly message?: string;
  readonly fix?: string;
}

/** `forge codegen`, then `forge validate`, on `tree`. The first failure refuses. */
export function forgeMergeCheck(runtimeRoot: string): MergeCheck {
  return async (tree) => {
    const codegen = await forge(runtimeRoot, tree, ['codegen']);
    const codegenOk = codegen.ok && (codegen.json as { ok?: unknown } | undefined)?.ok !== false;
    if (!codegenOk) {
      return {
        ok: false,
        message: 'forge codegen failed on this change, so nothing was merged.',
        next: 'Open the change in Build and fix what codegen reports (a hand-owned binding contract, or a manifest it cannot generate from), Propose again, and have it re-approved.',
      };
    }
    const validate = await forge(runtimeRoot, tree, ['validate']);
    const report = validate.json as
      { ok?: unknown; failures?: readonly ValidationFailureLike[] } | undefined;
    if (validate.ok && report?.ok === true) return { ok: true };
    const first = report?.failures?.[0];
    return {
      ok: false,
      message:
        first === undefined
          ? 'forge validate did not pass on this change, so nothing was merged.'
          : `forge validate refused this change (${first.ruleId ?? 'rule'} in ${first.file ?? 'a file'}): ${first.message ?? ''}`.trim(),
      next:
        first?.fix !== undefined && first.fix.length > 0
          ? `${first.fix} Then Propose again and have it re-approved.`
          : 'Open the change in Build, fix what the checks pane reports, Propose again, and have it re-approved.',
    };
  };
}
