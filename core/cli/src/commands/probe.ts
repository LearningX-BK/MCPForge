// MCPForge — `forge probe`. W0-H4, 02 §4.5.
//
//   forge probe [--json] [--target <id>] [--env <class>] [--root <dir>]
//
// The command FORMATS; it does not implement. `runProbe` (`@mcpforge/probe`)
// generates the plans, executes them and reduces each tool to exactly one
// status; `writeProbeReport` validates the artefact against
// probe-report.schema.json before it reaches disk. This file is argument
// handling, the error taxonomy and human/JSON rendering — the same split as
// `./kill.ts` and `./audit.ts`.
//
// W0-P21: the `function` executor IS registered now, built exactly as the
// gateway routes (`overlays/<deployment>/ais-targets.yaml`: each module
// server's AIS target and its own client credential), and it authenticates as
// the target's designated `probeIdentity` (owner decision, 30 Sep 2026). Per-
// tool details (`binding.ref`, `refVersion`, the owning server's owner) come
// from the manifests. Nothing is defaulted: a `function` tool with no AIS
// target, a target with no `probeIdentity`, or an index tool with no manifest
// refuses the whole run with a `next`, BEFORE any check runs. Binding types
// with no executor at Wave 0 (`plsql`, `database`, `rest`, `wrapped-vendor`)
// still probe to `disabled_missing_binding`, which is the honest answer.
//
// W0-P33d: the run itself is `probeDeployment` (`@mcpforge/probe`), shared
// with the gateway's portal-triggered probe. Definitions (index, manifests,
// overlays) come from MCPFORGE_DEFINITIONS_ROOT when set; the vault and the
// report stay under the install root (the working directory, or --root).

import { loadManifestFiles } from '@mcpforge/codegen/validate';
import { parseSecretRef } from '@mcpforge/gateway/secrets';
import { EncryptedFileStore } from '@mcpforge/gateway/secrets/server';
import {
  isEnvironmentClass,
  probeDeployment,
  writeProbeReport,
  type ClientCredentialSource,
  type EnvironmentClass,
  type ProbeReport,
} from '@mcpforge/probe';
import { PROBE_STATUS, type ProbeStatus } from '@mcpforge/shared';

// Human-mode colouring reads PROBE_STATUS from `@mcpforge/shared/status.ts`
// (W0-J3, 03 §13.5) so a status means the same thing here as it does in the
// portal's ProbeStatusChip — no ad-hoc label/colour logic duplicated in the CLI.
const ANSI_BY_TOKEN: Record<string, string> = {
  'status-read': '\x1b[36m', // cyan
  'status-ok': '\x1b[32m', // green
  'status-write': '\x1b[33m', // yellow
  'status-platform': '\x1b[35m', // magenta
  'status-neutral': '\x1b[90m', // grey
  'status-danger': '\x1b[31m', // red
};
const ANSI_RESET = '\x1b[0m';

function colourize(status: string): string {
  const entry = PROBE_STATUS[status as ProbeStatus] as
    (typeof PROBE_STATUS)[ProbeStatus] | undefined;
  if (!entry) return status;
  const colour = ANSI_BY_TOKEN[entry.token] ?? '';
  const useColour = process.stderr.isTTY && !process.env['NO_COLOR'];
  const text = entry.label;
  return useColour ? `${colour}${text}${ANSI_RESET}` : text;
}

export interface ProbeOptions {
  readonly json: boolean;
  readonly target?: string;
  readonly env?: string;
  readonly root?: string;
  readonly deployment?: string;
}

export interface ProbeCliError {
  readonly ok: false;
  readonly code: 'INPUT_INVALID' | 'CATALOGUE_UNAVAILABLE' | 'PROBE_TARGET_UNCONFIGURED';
  readonly message: string;
  readonly next: string;
}

/** Test seams. Production uses the repo's EncryptedFileStore and global fetch. */
export interface ProbeDeps {
  readonly credential?: (clientCredentialRef: string) => ClientCredentialSource<unknown>;
  readonly fetch?: typeof fetch;
  /** Where MCPFORGE_DEFINITIONS_ROOT and MCPFORGE_DEPLOYMENT are read. Default: process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The install root when `--root` is absent. Default: process.cwd(). */
  readonly cwd?: string;
}

const USAGE_EXIT_CODE = 64;
/** The same default the gateway launches with (`core/gateway/launch.ts`). */
const DEFAULT_DEPLOYMENT_ID = 'local';
const DEFAULT_TARGET_ID = 'local';
const DEFAULT_ENV: EnvironmentClass = 'local';

function emitError(error: ProbeCliError, json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify(error)}\n`);
  } else {
    process.stderr.write(`forge: probe — ${error.message}\n`);
    process.stderr.write(`forge: next — ${error.next}\n`);
  }
  return USAGE_EXIT_CODE;
}

function renderHuman(report: ProbeReport, filePath: string): void {
  const { summary, target } = report;
  process.stderr.write(
    `forge: probe — target "${target.id}" (${target.environmentClass}), ${summary.toolCount} tool(s)\n`,
  );
  for (const [status, count] of Object.entries(summary.byStatus)) {
    process.stderr.write(`forge:   ${colourize(status)}: ${count}\n`);
  }
  for (const tool of report.tools) {
    if (tool.status === 'resolved') continue;
    process.stderr.write(
      `forge:   ${tool.toolId} — ${colourize(tool.status)} — ${tool.remediation}\n`,
    );
  }
  process.stderr.write(`forge: probe report written to ${filePath}\n`);
}

export async function runProbeCommand(
  options: ProbeOptions,
  deps: ProbeDeps = {},
): Promise<number> {
  const json = Boolean(options.json);
  // W0-P33a/P33d: two roots. The INSTALL root holds the vault and receives
  // .mcpforge/probe-report.json; the DEFINITIONS root (MCPFORGE_DEFINITIONS_ROOT,
  // the git clone on the VM) is what is probed. `--root` names both, as before.
  const env = deps.env ?? process.env;
  const installRoot = options.root ?? deps.cwd ?? process.cwd();
  const configuredDefs = env['MCPFORGE_DEFINITIONS_ROOT'];
  const definitionsRoot =
    options.root ??
    (configuredDefs !== undefined && configuredDefs.length > 0 ? configuredDefs : installRoot);

  const envRaw = options.env ?? DEFAULT_ENV;
  if (!isEnvironmentClass(envRaw)) {
    return emitError(
      {
        ok: false,
        code: 'INPUT_INVALID',
        message: `--env "${String(envRaw)}" is not an environment class.`,
        next: 'Run "forge probe --env <local|probe|staging|prod>". 02 §7.1 names these four and no others.',
      },
      json,
    );
  }

  const deployment = options.deployment ?? env['MCPFORGE_DEPLOYMENT'] ?? DEFAULT_DEPLOYMENT_ID;

  const store = new EncryptedFileStore({ repoRoot: installRoot });
  const outcome = await probeDeployment({
    definitionsRoot,
    manifestDocs: loadManifestFiles(definitionsRoot).map((f) => f.doc),
    target: {
      id: options.target ?? DEFAULT_TARGET_ID,
      environmentClass: envRaw,
      deploymentId: deployment,
    },
    credential:
      deps.credential ??
      ((ref: string) =>
        ({ ref: parseSecretRef(ref), secretStore: store }) as ClientCredentialSource<unknown>),
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  });
  if (!outcome.ok) {
    return emitError(
      { ok: false, code: outcome.code, message: outcome.message, next: outcome.next },
      json,
    );
  }
  const report = outcome.report;

  const filePath = writeProbeReport(installRoot, report);

  if (json) {
    process.stdout.write(`${JSON.stringify(report)}
`);
  } else {
    renderHuman(report, filePath);
  }
  return 0;
}
