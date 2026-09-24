import { spawnSync } from 'node:child_process';

export interface PnpmScriptResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run a `pnpm` subcommand against the repo root, capturing output rather than streaming it. */
export function runPnpmScript(
  repoRoot: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
): PnpmScriptResult {
  // args are always fixed literals from tools/ci/src/stages.ts (e.g. ['lint']),
  // never caller-supplied — so folding them into one shell string here is safe,
  // and it avoids Node's DEP0190 warning about shell:true plus an args array.
  const command = ['pnpm', ...args].join(' ');
  const result = spawnSync(command, {
    cwd: repoRoot,
    shell: true,
    encoding: 'utf-8',
    // W0-K2 — the both-modes CI matrix sets MCPFORGE_MODE here; every other
    // caller omits `env` and inherits the ambient process environment exactly
    // as before.
    env: env === undefined ? process.env : { ...process.env, ...env },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Last N lines of some captured output — enough context in a stage report without dumping everything. */
export function tail(text: string, lines = 20): string {
  return text.split(/\r?\n/).slice(-lines).join('\n');
}
