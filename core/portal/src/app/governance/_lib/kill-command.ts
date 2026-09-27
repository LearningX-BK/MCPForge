// MCPForge — W0-P5b: the `forge kill` command the portal shows instead of a
// write path (W0-P4 §9 decision 4: "show the `forge kill` command now; a real
// write path later").
//
// Pure and client-safe. It renders the command exactly as
// `core/cli/src/commands/kill.ts` parses it:
//   forge kill <target> --reason "..." --by <subject> [--deployment <id>]
// where <target> is a bare tool id, or `server:` / `bindingType:` /
// `consumer:` / `deployment:` plus an id. `--by` is the signed-in viewer's
// subject: `forge kill` refuses to default it (CLAUDE.md non-negotiable 1).

import type { KillScope } from '@mcpforge/gateway/scope';

const PREFIX: Readonly<Record<KillScope, string>> = {
  tool: '',
  moduleServer: 'server:',
  bindingType: 'bindingType:',
  consumer: 'consumer:',
  deployment: 'deployment:',
};

/**
 * POSIX single-quoting: everything is literal inside '...', and a single quote
 * is written as '\''. So a reason cannot expand a variable or end the argument.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface KillCommandInput {
  readonly scope: KillScope;
  readonly target: string;
  readonly reason: string;
  readonly by: string;
  readonly deployment: string;
}

export function forgeKillCommand(input: KillCommandInput): string {
  return [
    'forge kill',
    shellQuote(`${PREFIX[input.scope]}${input.target}`),
    '--reason',
    shellQuote(input.reason),
    '--by',
    shellQuote(input.by),
    '--deployment',
    shellQuote(input.deployment),
  ].join(' ');
}
