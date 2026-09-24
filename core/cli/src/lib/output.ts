// Deterministic, machine-readable CLI output. Every forge command that
// hasn't landed yet answers through this one path, so the shape of a
// "not implemented" reply is identical everywhere — CLAUDE.md §5's
// "closed taxonomy, never a bare throw" applies to the CLI surface too,
// even though NOT_IMPLEMENTED is a CLI-only status, not one of
// @mcpforge/shared's 21 gateway error codes (those describe gateway/policy
// failures against a running instance; this describes the CLI's own build
// state).

/** sysexits.h EX_USAGE — reused here as the fixed "not implemented" exit code
 *  per TASKS.md W0-A5's `done:` criterion. */
export const NOT_IMPLEMENTED_EXIT_CODE = 64;

export interface CliEnvelope {
  readonly ok: false;
  readonly code: 'NOT_IMPLEMENTED';
  readonly command: string;
  readonly message: string;
  readonly next: string;
}

export function buildNotImplementedEnvelope(commandPath: readonly string[]): CliEnvelope {
  const command = commandPath.join(' ');
  return {
    ok: false,
    code: 'NOT_IMPLEMENTED',
    command,
    message: `forge ${command} is not implemented yet.`,
    next: `This command is a Wave 0 skeleton (W0-A5). Find and complete its build task in TASKS.md, or run "forge --help" to see which commands already have real behaviour.`,
  };
}

/**
 * Emit the not-implemented result and return the exit code to use.
 * JSON mode: the envelope, and only the envelope, goes to stdout — parseable,
 * per the `done:` criterion. Human mode: a one-line diagnostic goes to
 * stderr instead, stdout stays empty.
 */
export function emitNotImplemented(commandPath: readonly string[], json: boolean): number {
  const envelope = buildNotImplementedEnvelope(commandPath);
  if (json) {
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
  } else {
    process.stderr.write(`forge: ${envelope.command} — ${envelope.message}\n`);
    process.stderr.write(`forge: next — ${envelope.next}\n`);
  }
  return NOT_IMPLEMENTED_EXIT_CODE;
}
