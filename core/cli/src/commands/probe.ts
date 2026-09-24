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
// WAVE 0 REALITY, stated in the output rather than hidden: there is no live
// Oracle or JDE instance reachable from this environment (02 §7.1), and no
// probe executor is registered by default. Every tool therefore probes to
// `disabled_missing_binding` with a check naming the absent executor — which is
// the honest answer, and is exactly what the gateway's fail-closed
// `ProbeStatusSource` should read. A caller with a real target registers an
// executor through the library API; wiring a live AIS client to this CLI is
// W0-H5's, not this task's.

import {
  isEnvironmentClass,
  probeInputsFromCatalogue,
  runProbe,
  writeProbeReport,
  type EnvironmentClass,
  type ProbeReport,
  type ProbeToolDetail,
} from '@mcpforge/probe';
import { CatalogueIndexLoadError, loadCatalogueIndex } from '@mcpforge/registry/index/server';
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
  const entry = PROBE_STATUS[status as ProbeStatus] as (typeof PROBE_STATUS)[ProbeStatus] | undefined;
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
  readonly code: 'INPUT_INVALID' | 'CATALOGUE_UNAVAILABLE';
  readonly message: string;
  readonly next: string;
}

const USAGE_EXIT_CODE = 64;
const DEFAULT_DEPLOYMENT_ID = 'default';
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
    process.stderr.write(`forge:   ${tool.toolId} — ${colourize(tool.status)} — ${tool.remediation}\n`);
  }
  process.stderr.write(`forge: probe report written to ${filePath}\n`);
}

export async function runProbeCommand(options: ProbeOptions): Promise<number> {
  const json = Boolean(options.json);
  const root = options.root ?? process.cwd();

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

  let index;
  try {
    index = loadCatalogueIndex(root);
  } catch (err) {
    return emitError(
      {
        ok: false,
        code: 'CATALOGUE_UNAVAILABLE',
        message:
          err instanceof CatalogueIndexLoadError
            ? err.message
            : `the catalogue index could not be read: ${err instanceof Error ? err.message : String(err)}`,
        next: 'Run "forge codegen" to build generated/index/catalogue-index.json, then re-run "forge probe".',
      },
      json,
    );
  }

  // No per-tool detail source is wired at Wave 0 — `binding.ref`, `refVersion`
  // and the owning team come from the manifests a later task teaches this
  // command to read. An empty map is honest: the runner writes the explicit
  // UNASSIGNED owning-team marker rather than inventing an owner.
  const details = new Map<string, ProbeToolDetail>();

  const report = await runProbe({
    target: {
      id: options.target ?? DEFAULT_TARGET_ID,
      environmentClass: envRaw,
      deploymentId: options.deployment ?? DEFAULT_DEPLOYMENT_ID,
    },
    tools: probeInputsFromCatalogue(index, details),
    // No executor is registered: no live target exists here (02 §7.1).
    executors: new Map(),
  });

  const filePath = writeProbeReport(root, report);

  if (json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    renderHuman(report, filePath);
  }
  return 0;
}
