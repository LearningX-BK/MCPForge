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

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifestFiles } from '@mcpforge/codegen/validate';
import { parseSecretRef } from '@mcpforge/gateway/secrets';
import { EncryptedFileStore } from '@mcpforge/gateway/secrets/server';
import {
  AisTargetsOverlayInvalid,
  isEnvironmentClass,
  loadAisTargetsOverlay,
  probeInputsFromCatalogue,
  runProbe,
  wireFunctionProbe,
  writeProbeReport,
  type ClientCredentialSource,
  type EnvironmentClass,
  type ProbeCheckExecutor,
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

interface ToolFacts {
  readonly serverId: string;
  readonly ref: string;
  readonly refVersion: string | null;
  readonly onNonCarriage: string | null;
}

/** `binding.ref`, `refVersion`, server and `onServiceAccount` per tool; each server's owner. */
function manifestFacts(root: string): {
  tools: Map<string, ToolFacts>;
  serverOwner: Map<string, string>;
} {
  const tools = new Map<string, ToolFacts>();
  const serverOwner = new Map<string, string>();
  for (const file of loadManifestFiles(root)) {
    const doc = file.doc as Record<string, unknown> | null | undefined;
    if (doc === null || doc === undefined || typeof doc['id'] !== 'string') continue;
    if (doc['kind'] === 'Server' && typeof doc['owner'] === 'string') {
      serverOwner.set(doc['id'], doc['owner']);
    }
    if (doc['kind'] !== 'Tool') continue;
    const binding = (doc['binding'] ?? {}) as Record<string, unknown>;
    const identity = (binding['identity'] ?? {}) as Record<string, unknown>;
    tools.set(doc['id'], {
      serverId: typeof doc['server'] === 'string' ? doc['server'] : '',
      ref: typeof binding['ref'] === 'string' ? binding['ref'] : '',
      refVersion: typeof binding['refVersion'] === 'string' ? binding['refVersion'] : null,
      onNonCarriage:
        // eslint-disable-next-line mcpforge/no-service-account-fallback -- spec-fixed manifest field name (02 §2.2), read as the DETECTION disposition the probe reports under; nothing is substituted.
        typeof identity['onServiceAccount'] === 'string' ? identity['onServiceAccount'] : null,
    });
  }
  return { tools, serverOwner };
}

export async function runProbeCommand(
  options: ProbeOptions,
  deps: ProbeDeps = {},
): Promise<number> {
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

  const deployment =
    options.deployment ?? process.env['MCPFORGE_DEPLOYMENT'] ?? DEFAULT_DEPLOYMENT_ID;

  // Per-tool details from the manifests (W0-P21). An index entry with no
  // manifest means generated/ and manifests/ disagree: refuse, never guess.
  const facts = manifestFacts(root);
  const missing = index.tools.map((t) => t.id).filter((id) => !facts.tools.has(id));
  if (missing.length > 0) {
    return emitError(
      {
        ok: false,
        code: 'CATALOGUE_UNAVAILABLE',
        message: `the catalogue index names ${missing.join(', ')}, but no committed manifest declares ${missing.length === 1 ? 'it' : 'them'}.`,
        next: 'Run "forge codegen" so generated/index matches manifests/, then re-run "forge probe".',
      },
      json,
    );
  }

  // The `function` executor, per module server, from the AIS overlay.
  const functionTools = index.tools
    .filter((t) => t.filters.bindingType === 'function')
    .map((t) => ({ toolId: t.id, serverId: facts.tools.get(t.id)!.serverId }));
  const executors = new Map<ProbeCheckExecutor['bindingType'], ProbeCheckExecutor>();
  let probeIdentityByServer: ReadonlyMap<string, string> = new Map();
  if (functionTools.length > 0) {
    const overlayPath = join(root, 'overlays', deployment, 'ais-targets.yaml');
    const overlayFile = `overlays/${deployment}/ais-targets.yaml`;
    if (!existsSync(overlayPath)) {
      return emitError(
        {
          ok: false,
          code: 'PROBE_TARGET_UNCONFIGURED',
          message: `${functionTools.length} function tool(s) need an AIS target, and ${overlayFile} does not exist.`,
          next: `Create ${overlayFile} (kind: AisTargets) naming each module server's target and a probeIdentity, or pass --deployment <id> for a deployment that has one.`,
        },
        json,
      );
    }
    let overlay;
    try {
      overlay = loadAisTargetsOverlay(overlayPath);
    } catch (err) {
      return emitError(
        {
          ok: false,
          code: 'PROBE_TARGET_UNCONFIGURED',
          message: err instanceof AisTargetsOverlayInvalid ? err.message : String(err),
          next: `Fix ${overlayFile} as listed, then re-run "forge probe".`,
        },
        json,
      );
    }
    const store = new EncryptedFileStore({ repoRoot: root });
    const wiring = wireFunctionProbe({
      overlay,
      tools: functionTools,
      credential:
        deps.credential ??
        ((ref: string) =>
          ({ ref: parseSecretRef(ref), secretStore: store }) as ClientCredentialSource<unknown>),
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    });
    if (!wiring.ok) {
      return emitError(
        {
          ok: false,
          code: 'PROBE_TARGET_UNCONFIGURED',
          message: wiring.problems.map((p) => p.message).join(' '),
          next: wiring.problems.map((p) => p.next).join(' '),
        },
        json,
      );
    }
    executors.set('function', wiring.executor);
    probeIdentityByServer = wiring.probeIdentityByServer;
  }

  const details = new Map<string, ProbeToolDetail>(
    [...facts.tools.entries()].map(([toolId, f]) => [
      toolId,
      {
        ref: f.ref,
        refVersion: f.refVersion,
        // The owning MODULE SERVER's owner (runner.ts: "the owning module
        // server's `owner`"); a server with none gets the runner's explicit
        // UNASSIGNED marker rather than an invented team.
        owningTeam: facts.serverOwner.get(f.serverId) ?? '',
        onNonCarriage: f.onNonCarriage,
        testIdentity: probeIdentityByServer.get(f.serverId) ?? null,
      },
    ]),
  );

  const report = await runProbe({
    target: {
      id: options.target ?? DEFAULT_TARGET_ID,
      environmentClass: envRaw,
      deploymentId: deployment,
    },
    tools: probeInputsFromCatalogue(index, details),
    executors,
  });

  const filePath = writeProbeReport(root, report);

  if (json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    renderHuman(report, filePath);
  }
  return 0;
}
