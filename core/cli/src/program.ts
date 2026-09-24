import { Command } from 'commander';
import {
  CANONICAL_COMMANDS,
  CANONICAL_SURFACE_LINE,
  commandLabel,
  type StubCommandSpec,
} from './commands.js';
import { emitNotImplemented } from './lib/output.js';
import { runCiCommand } from './commands/ci.js';
import { runCodegenCommand } from './commands/codegen.js';
import { runValidateCommand } from './commands/validate.js';
import { runAuditVerifyCommand } from './commands/audit.js';
import { runAuditReverseCommand } from './commands/audit-reverse.js';
import { runIdentityRemapCommand } from './commands/identity.js';
import { runKillCommand } from './commands/kill.js';
import { runProbeCommand } from './commands/probe.js';
import { runBenchCommand } from './commands/bench.js';
import { runConsumerCommand } from './commands/consumer.js';
import { runSecretsCommand } from './commands/secrets.js';
import { runDevCommand } from './commands/dev.js';
import { runPackageCommand } from './commands/package.js';
import { runSliceDiffCommand } from './commands/slice-diff.js';

/**
 * Real (non-stub) command handlers, keyed by their canonical path label
 * (e.g. "ci", "audit verify"). A command absent from this map gets the
 * generic NOT_IMPLEMENTED stub — this is the one seam a task adds to when
 * it gives a command real behaviour, without touching the stub-wiring code.
 * A handler may return its exit code synchronously or via a Promise —
 * `registerCommand` awaits either.
 */
const REAL_HANDLERS: Readonly<
  Record<string, (opts: { json: boolean } & Record<string, unknown>) => number | Promise<number>>
> = {
  ci: runCiCommand,
  codegen: runCodegenCommand,
  validate: runValidateCommand,
  // W0-C4. Keyed by `commandLabel` — the space-joined canonical path — which
  // is why a nested command is "audit verify" and not "audit:verify".
  'audit verify': runAuditVerifyCommand,
  // W0-F5. The call id arrives as `opts.target`, lifted from the positional by
  // `registerCommand` exactly as `kill`'s is.
  'audit reverse': (opts) =>
    runAuditReverseCommand(opts['target'] as string | undefined, opts as never),
  // W0-D4.
  'identity remap': runIdentityRemapCommand,
  // W0-E5. `target` arrives via `opts.target` — see `ARGUMENTS` and
  // `registerCommand` below, which lift Commander's positional argument into
  // the same options bag every other handler already receives.
  kill: (opts) => runKillCommand(opts['target'] as string | undefined, opts as never),
  // W0-H4. The capability probe (02 §4.5) — emits a schema-validated
  // probe-report.json and, with --json, the report itself on stdout.
  probe: (opts) => runProbeCommand(opts as never),
  // W0-G6/W0-G7. Rank-1 discovery benchmark: the mock gateway, the intents
  // skeleton generator, and all five metrics (TTFC, VTC, DH, SA@1, MTB) with
  // per-category and per-role breakdowns (02 §5.7, §5.9, §5.10). The CI
  // regression gate that consumes `--json` is `forge ci` stage 10.
  bench: (opts) => runBenchCommand(opts as never),
  // W0-N1. The consumer registry (02 §11.2). The four mutating verbs stage a
  // change proposal and write nothing to consumers/ or approvals/.
  ...Object.fromEntries(
    (['new', 'list', 'show', 'suspend', 'rotate', 'retire', 'issue-credential'] as const).map(
      (verb) => [
        `consumer ${verb}`,
        (opts: { json: boolean } & Record<string, unknown>) =>
          runConsumerCommand(verb, opts as never),
      ],
    ),
  ),
  // W0-N6. `status` takes no positional; `rotate` and `revoke` take the
  // secretRef, lifted into `opts.target` by `registerCommand` exactly as
  // `kill`'s and `consumer`'s ids are.
  ...Object.fromEntries(
    (['status', 'rotate', 'revoke'] as const).map((verb) => [
      `secrets ${verb}`,
      (opts: { json: boolean } & Record<string, unknown>) => runSecretsCommand(verb, opts as never),
    ]),
  ),
  // W0-N11. The local bootstrap self-registration (02 §11.2) — environment
  // class `local` only, refused under probe/staging/prod and when CI=true.
  dev: (opts) => runDevCommand(opts as never),
  // W0-K1. Selection and nothing else (02 §6.1, §6.2) — the package id
  // arrives via `opts.target`, lifted from the positional exactly as
  // `kill`'s and `consumer`'s ids are.
  package: (opts) =>
    runPackageCommand(opts['target'] as string | undefined, opts as never),
  // W0-K5. The P1 no-fork proof (02 §6.4), Wave 0's file-hash form (02
  // §10.5) — `opts.targets` is the two-positional list `registerCommand`
  // lifts for any command with more than one declared argument.
  'slice-diff': (opts) => {
    const targets = (opts['targets'] as (string | undefined)[] | undefined) ?? [];
    return runSliceDiffCommand(targets[0], targets[1], opts as never);
  },
};

/**
 * Positional arguments beyond the universal options, keyed by canonical path
 * label — the argument counterpart to `EXTRA_OPTIONS`. Most entries declare
 * one positional; a value may also be an array for a command needing more
 * than one (W0-K5's `slice-diff <a> <b>` is Wave 0's only two-positional
 * command) — `registerCommand` normalises either shape to a list.
 */
type PositionalSpec = { readonly name: string; readonly description: string };
const ARGUMENTS: Readonly<Record<string, PositionalSpec | readonly PositionalSpec[]>> = {
    // W0-F5. OPTIONAL on purpose: a missing call id must reach this CLI's own
    // INPUT_INVALID envelope with a `next` (non-negotiable 5), not Commander's
    // generic "missing required argument" text, which names no action.
    'audit reverse': {
      name: '[callId]',
      description: 'The audit call id of the completed write to construct a reversal for.',
    },
    kill: {
      name: '<target>',
      description:
        'A tool id (tool scope), or scope:<id> — server:, bindingType:, consumer:, deployment:.',
    },
    // W0-K1. OPTIONAL for the same reason `kill`'s and `consumer`'s are: a
    // missing id must reach this CLI's own INPUT_INVALID envelope with an
    // actionable `next` (non-negotiable 5), not Commander's generic text.
    package: {
      name: '[packageId]',
      description: 'The package id, e.g. "jde-fin" (packages/<id>.yaml).',
    },
    // W0-K5. Both OPTIONAL for the same reason `package`'s is: a missing id
    // must reach this CLI's own INPUT_INVALID envelope with an actionable
    // `next`, not Commander's generic text.
    'slice-diff': [
      { name: '[packageA]', description: 'The first package id to compare.' },
      { name: '[packageB]', description: 'The second package id to compare.' },
    ],
    // W0-N1. OPTIONAL for the same reason `audit reverse`'s is: a missing id
    // must reach this CLI's own INPUT_INVALID envelope with an actionable
    // `next`, not Commander's generic text. `consumer list` takes none.
    ...Object.fromEntries(
      (['new', 'show', 'suspend', 'rotate', 'retire', 'issue-credential'] as const).map((verb) => [
        `consumer ${verb}`,
        {
          name: '[id]',
          description:
            'The consumer id — immutable, because audit rows and consumption edges reference it.',
        },
      ]),
    ),
    // W0-N6. OPTIONAL for the same reason: a missing ref must reach this CLI's
    // own INPUT_INVALID envelope with an actionable `next`.
    ...Object.fromEntries(
      (['rotate', 'revoke'] as const).map((verb) => [
        `secrets ${verb}`,
        {
          name: '[ref]',
          description:
            'The credential, as secretRef://<scope>/<subject>/<purpose> — the only form a credential takes (02 §11.5).',
        },
      ]),
    ),
  };

/**
 * Command-specific options beyond the universal `--json`, keyed by canonical
 * path label. Kept as data next to REAL_HANDLERS so adding one is a one-line
 * change and `commands.ts` stays the pure surface list it is.
 */
const EXTRA_OPTIONS: Readonly<
  Record<string, readonly { readonly flags: string; readonly description: string }[]>
> = {
  'audit verify': [
    {
      // Default: every deployment in the store. Single-INSTANCE is not the
      // same claim as single-deployment (02 §10.4 item 6).
      flags: '--deployment <id>',
      description:
        'Walk only this one deployment chain. Default: every deployment that has written an audit row.',
    },
  ],
  'audit reverse': [
    {
      flags: '--execute',
      description:
        'Refused. A reversal is itself a write and runs the full plan -> confirm sequence from a real session; this CLI holds no consumer and no resolved human identity.',
    },
  ],
  // W0-N11. The gate on `forge dev`'s self-registration. `--env` beats
  // MCPFORGE_ENV; an unrecognised value is INPUT_INVALID, never a default.
  dev: [
    {
      flags: '--env <class>',
      description:
        'Environment class: local | probe | staging | prod (02 §7.1). Self-registration runs in local only. Default: MCPFORGE_ENV, else "local".',
    },
    {
      flags: '--root <dir>',
      description: 'Repository root to write consumers/portal-local.consumer.yaml into.',
    },
  ],
  'identity remap': [
    {
      flags: '--from <subject>',
      description: 'The old Principal.subject value to rewrite (required).',
    },
    {
      flags: '--to <subject>',
      description: 'The new Principal.subject value (required).',
    },
    {
      flags: '--mappings-root <dir>',
      description: 'Root directory to search for */mappings/*.yaml files. Default: "overlays".',
    },
  ],
  // W0-H4. 02 §7.1's four environment classes; `prod` is the one the probe
  // runner refuses every mutating check against.
  probe: [
    {
      flags: '--target <id>',
      description: 'The target instance name (reaches audit_call.target_env). Default: "local".',
    },
    {
      flags: '--env <class>',
      description: 'Environment class: local | probe | staging | prod (02 §7.1). Default: "local".',
    },
    {
      flags: '--root <dir>',
      description:
        'Repository root to read generated/index/catalogue-index.json from and write .mcpforge/probe-report.json into. Default: the working directory.',
    },
    {
      flags: '--deployment <id>',
      description: 'Which deployment this probe run belongs to. Default: "default".',
    },
  ],
  bench: [
    {
      flags: '--root <dir>',
      description:
        'Repository root to read generated/index/catalogue-index.json from and evals/ under. Default: the working directory.',
    },
    {
      flags: '--evals <dir>',
      description: 'Where evals/<server>/intents.yaml files live. Default: "<root>/evals".',
    },
    {
      flags: '--baseline <file>',
      description:
        'The committed benchmark baseline `forge ci` stage 10 compares against. Default: "<root>/evals/baseline.json".',
    },
    {
      // W0-G7 — a deliberate human/agent act, like `codegen --accept-contract`. Refused when CI=true.
      flags: '--record-baseline',
      description:
        'Overwrite the baseline with this run and exit 0. Refused when CI=true; the resulting diff is reviewed like any other change.',
    },
  ],
  codegen: [
    {
      // 02 §2.4 — a deliberate human/agent act, refused when CI=true.
      flags: '--accept-contract <toolId>',
      description:
        'Accept a changed binding contract for one tool: rewrites ONLY the mcpforge:contract-hash comment in its hand-owned binding.custom.ts. Refused when CI=true (02 §2.4).',
    },
  ],
  // W0-N1. `--by <subject>` is required on every mutating verb for the same
  // reason `kill --by` is: a bare CLI invocation carries no authenticated
  // session, and there is no default acting identity (CLAUDE.md #1).
  'consumer new': [
    {
      flags: '--class <class>',
      description: 'interactive-client | autonomous-agent | batch-service | portal (required).',
    },
    { flags: '--label <text>', description: 'Human-readable label. Default: the id.' },
    { flags: '--owner <team>', description: 'The accountable team (required).' },
    {
      flags: '--steward <person>',
      description: 'The named human who stewards this consumer (required).',
    },
    {
      flags: '--human-in-the-loop <bool>',
      description:
        'true|false, stated explicitly (required). false forces humanApprovalRequired: true on every write this consumer attempts (02 §11.2).',
    },
    {
      flags: '--expires <date>',
      description:
        'ISO date the registration expires. Default: one year out — renewal is a re-approval.',
    },
    {
      flags: '--reason <text>',
      description: 'Why this consumer is being registered; carried into the approval record.',
    },
    { flags: '--by <subject>', description: 'Principal.subject of the requester (required).' },
    { flags: '--root <dir>', description: 'Repository root. Default: the enclosing repository.' },
  ],
  'consumer list': [
    { flags: '--root <dir>', description: 'Repository root. Default: the enclosing repository.' },
  ],
  'consumer show': [
    { flags: '--root <dir>', description: 'Repository root. Default: the enclosing repository.' },
  ],
  'consumer suspend': [
    { flags: '--reason <text>', description: 'Why (required).' },
    { flags: '--by <subject>', description: 'Principal.subject of the requester (required).' },
    { flags: '--root <dir>', description: 'Repository root. Default: the enclosing repository.' },
  ],
  'consumer rotate': [
    { flags: '--reason <text>', description: 'Why, if it is not the scheduled 90-day rotation.' },
    { flags: '--by <subject>', description: 'Principal.subject of the requester (required).' },
    { flags: '--root <dir>', description: 'Repository root. Default: the enclosing repository.' },
  ],
  'consumer retire': [
    { flags: '--reason <text>', description: 'Why (required).' },
    { flags: '--by <subject>', description: 'Principal.subject of the requester (required).' },
    { flags: '--root <dir>', description: 'Repository root. Default: the enclosing repository.' },
  ],
  'consumer issue-credential': [
    {
      flags: '--env <class>',
      description:
        'Environment class: local | probe | staging | prod. Refused for staging and prod, and refused whenever CI=true (02 §11.2). Default: "local".',
    },
    {
      flags: '--by <subject>',
      description: 'Principal.subject of whoever is minting it (required).',
    },
    { flags: '--root <dir>', description: 'Repository root. Default: the enclosing repository.' },
  ],
  // W0-N6.
  'secrets status': [
    {
      flags: '--root <dir>',
      description:
        'Repository root the sealed vault lives under. Default: the enclosing repository.',
    },
  ],
  'secrets rotate': [
    {
      flags: '--root <dir>',
      description:
        'Repository root the sealed vault lives under. Default: the enclosing repository.',
    },
  ],
  'secrets revoke': [
    {
      flags: '--reason <text>',
      description:
        'Why the credential is being destroyed (required). Written verbatim into every dependent kill switch.',
    },
    {
      flags: '--by <subject>',
      description:
        'Principal.subject of whoever is running this (required — no default acting identity).',
    },
    {
      flags: '--deployment <id>',
      description: 'Which deployment audit chain records the kill switches. Default: "default".',
    },
    { flags: '--root <dir>', description: 'Repository root. Default: the enclosing repository.' },
  ],
  // W0-K1.
  package: [
    {
      flags: '--root <dir>',
      description: 'Repository root to read manifests/generated from. Default: the working directory.',
    },
    {
      flags: '--out <dir>',
      description: 'Where to write the selection artefact. Default: "<root>/.forge-build/packages/<id>".',
    },
  ],
  // W0-K5.
  'slice-diff': [
    {
      flags: '--root <dir>',
      description:
        'Repository root both sides read manifests/generated from, unless overridden per side. Default: the working directory.',
    },
    {
      flags: '--a-root <dir>',
      description: 'Override which repo checkout side A builds from. Default: --root.',
    },
    {
      flags: '--b-root <dir>',
      description: 'Override which repo checkout side B builds from. Default: --root.',
    },
    {
      flags: '--out <dir>',
      description:
        'Where to build both packages and write the markdown report. Default: "<root>/.forge-build/slice-diff/<a>__<b>".',
    },
  ],
  kill: [
    { flags: '--reason <text>', description: 'Why this is being kill-switched (required).' },
    {
      flags: '--until <date>',
      description: 'ISO date/time after which the flag is spent. Default: indefinite.',
    },
    {
      flags: '--by <subject>',
      description:
        'Principal.subject of whoever is running this kill (required — no default acting identity).',
    },
    {
      flags: '--deployment <id>',
      description: 'Which deployment audit chain records this action. Default: "default".',
    },
  ],
};

/**
 * Wire one canonical command (possibly nested, e.g. ['audit', 'verify'])
 * onto its Commander parent, creating intermediate group commands
 * (`audit`, `identity`, `new`) on first use so `forge audit --help` shows
 * both `verify` and `reverse` together.
 */
function registerCommand(root: Command, groups: Map<string, Command>, spec: StubCommandSpec): void {
  let parent = root;
  for (let i = 0; i < spec.path.length - 1; i += 1) {
    const groupName = spec.path[i]!;
    const key = spec.path.slice(0, i + 1).join(' ');
    let group = groups.get(key);
    if (!group) {
      group = parent.command(groupName).description(`${groupName} — see 'forge ${key} --help'.`);
      groups.set(key, group);
    }
    parent = group;
  }

  const leafName = spec.path[spec.path.length - 1]!;
  const label = commandLabel(spec);
  const leaf = parent.command(leafName).description(spec.description);
  const positionalSpec = ARGUMENTS[label];
  const positionals: readonly PositionalSpec[] = positionalSpec
    ? Array.isArray(positionalSpec)
      ? positionalSpec
      : [positionalSpec]
    : [];
  for (const positional of positionals) {
    leaf.argument(positional.name, positional.description);
  }
  leaf.option('--json', 'emit machine-readable JSON on stdout; diagnostics stay on stderr');
  for (const extra of EXTRA_OPTIONS[label] ?? []) {
    leaf.option(extra.flags, extra.description);
  }

  const realHandler = REAL_HANDLERS[label];
  leaf.action(async (...actionArgs: unknown[]) => {
    // Commander calls the action with one positional parameter per declared
    // `.argument(...)`, in order, followed by the Command instance itself.
    // A single positional (Wave 0's common case, e.g. `kill`) lifts into
    // `opts.target`, matching every existing handler's expectation; a
    // command with more than one (only `slice-diff` at Wave 0) additionally
    // gets `opts.targets`, the full ordered list.
    const opts = leaf.opts<{ json?: boolean } & Record<string, unknown>>();
    const json = Boolean(opts.json);
    const withTargets =
      positionals.length > 0
        ? { ...opts, target: actionArgs[0], targets: actionArgs.slice(0, positionals.length) }
        : opts;
    const exitCode = realHandler
      ? await realHandler({ ...withTargets, json })
      : emitNotImplemented(spec.path, json);
    process.exitCode = exitCode;
  });
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('forge')
    .description(
      'MCPForge control-plane CLI — the automation seam driving the build lane and the human operator (02 §8.2).',
    )
    .version('0.0.0')
    .exitOverride() // never call process.exit() ourselves during tests; caller controls exit
    .configureOutput({
      writeOut: (str) => process.stdout.write(str),
      writeErr: (str) => process.stderr.write(str),
    });

  const groups = new Map<string, Command>();
  for (const spec of CANONICAL_COMMANDS) {
    registerCommand(program, groups, spec);
  }

  program.addHelpText(
    'after',
    [
      '',
      'Full Wave 0 command surface (see TASKS.md track A for which commands are implemented vs. still a skeleton):',
      `  ${CANONICAL_SURFACE_LINE}`,
      '',
      'Every command above accepts --json. An unimplemented command exits 64',
      'with a machine-readable NOT_IMPLEMENTED envelope (--json: on stdout; otherwise a diagnostic on stderr).',
    ].join('\n'),
  );

  return program;
}

export { CANONICAL_COMMANDS, commandLabel };
