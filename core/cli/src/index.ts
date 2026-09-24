import { CommanderError } from 'commander';
import { buildProgram } from './program.js';

/**
 * Entry point. Kept separate from program.ts so tests can build and drive
 * a Command instance in-process without touching real process.argv/exit.
 */
export async function run(argv: readonly string[] = process.argv): Promise<number> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv as string[]);
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      // --help and --version resolve here too (exitOverride intercepts them);
      // those are success, not failure.
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
        return 0;
      }
      return error.exitCode;
    }
    throw error;
  }
}

// Deliberately no top-level `run()` call here: this module is imported both
// by the real bin/forge.js entrypoint (which calls run() itself and owns
// process.exit) and by the test suite (which wants the Command tree without
// a process-exiting side effect). Keep the two paths distinct rather than
// sniffing "am I the main module" across Windows path-separator quirks.
