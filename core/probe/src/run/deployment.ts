// MCPForge — probe one deployment: everything `forge probe` did between
// reading its arguments and writing the report. W0-H4, W0-P21, W0-P33d.
//
// Moved here from `core/cli/src/commands/probe.ts` so that the CLI and the
// gateway's portal-triggered probe (W0-P33d, decision D of the approved W0-P33
// design note) run ONE implementation. Nothing in it changed on the way.
//
// THE TWO ROOTS (W0-P33a carried this forward). On the VM the definitions are
// a git clone apart from the install:
//
//  - the DEFINITIONS root holds what is probed: `generated/index`, the
//    manifests (which the caller loads and hands in, so this package does not
//    depend on codegen), and `overlays/<deployment>/ais-targets.yaml`;
//  - the INSTALL root holds the vault and receives the report. Neither is
//    touched here: the caller supplies the credential source over its own
//    SecretStore, and writes the returned report with `writeProbeReport`.
//
// Nothing is defaulted that matters: a `function` tool with no AIS target, a
// target with no `probeIdentity`, or an index tool with no manifest refuses the
// whole run with a `next`, BEFORE any check runs.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  AisTargetsOverlayInvalid,
  loadAisTargetsOverlay,
  type ClientCredentialSource,
} from '@mcpforge/adapter-function';
import { CatalogueIndexLoadError, loadCatalogueIndex } from '@mcpforge/registry/index/server';
import { probeInputsFromCatalogue, type ProbeToolDetail } from '../catalogue.js';
import type { ProbeCheckExecutor } from '../plan/index.js';
import type { ProbeReport } from '../report/types.js';
import type { ProbeTarget } from '../target.js';
import { wireFunctionProbe } from './function-wiring.js';
import { runProbe } from './runner.js';

export interface DeploymentProbeInput {
  /** Where `generated/index` and `overlays/<deployment>/` are read from. */
  readonly definitionsRoot: string;
  /**
   * The parsed manifest documents of the definitions root (`loadManifestFiles`
   * from `@mcpforge/codegen/validate`, `.doc` of each).
   */
  readonly manifestDocs: readonly unknown[];
  readonly target: ProbeTarget;
  /** A client credential reference, resolved against the CALLER's SecretStore. */
  readonly credential: (clientCredentialRef: string) => ClientCredentialSource<unknown>;
  readonly fetch?: typeof fetch;
}

export type DeploymentProbeRefusalCode = 'CATALOGUE_UNAVAILABLE' | 'PROBE_TARGET_UNCONFIGURED';

export type DeploymentProbeOutcome =
  | { readonly ok: true; readonly report: ProbeReport }
  | {
      readonly ok: false;
      readonly code: DeploymentProbeRefusalCode;
      readonly message: string;
      readonly next: string;
    };

interface ToolFacts {
  readonly serverId: string;
  readonly ref: string;
  readonly refVersion: string | null;
  readonly onNonCarriage: string | null;
}

/** `binding.ref`, `refVersion`, server and `onServiceAccount` per tool; each server's owner. */
function manifestFacts(docs: readonly unknown[]): {
  tools: Map<string, ToolFacts>;
  serverOwner: Map<string, string>;
} {
  const tools = new Map<string, ToolFacts>();
  const serverOwner = new Map<string, string>();
  for (const raw of docs) {
    const doc = raw as Record<string, unknown> | null | undefined;
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

/**
 * Probe every tool of the definitions root's catalogue against `target`.
 * Returns the report (not yet written) or a refusal with a `next`; it never
 * throws for a configuration problem.
 */
export async function probeDeployment(
  input: DeploymentProbeInput,
): Promise<DeploymentProbeOutcome> {
  const root = input.definitionsRoot;
  const deployment = input.target.deploymentId;

  let index;
  try {
    index = loadCatalogueIndex(root);
  } catch (err) {
    return {
      ok: false,
      code: 'CATALOGUE_UNAVAILABLE',
      message:
        err instanceof CatalogueIndexLoadError
          ? err.message
          : `the catalogue index could not be read: ${err instanceof Error ? err.message : String(err)}`,
      next: 'Run "forge codegen" to build generated/index/catalogue-index.json, then re-run "forge probe".',
    };
  }

  // Per-tool details from the manifests (W0-P21). An index entry with no
  // manifest means generated/ and manifests/ disagree: refuse, never guess.
  const facts = manifestFacts(input.manifestDocs);
  const missing = index.tools.map((t) => t.id).filter((id) => !facts.tools.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'CATALOGUE_UNAVAILABLE',
      message: `the catalogue index names ${missing.join(', ')}, but no committed manifest declares ${missing.length === 1 ? 'it' : 'them'}.`,
      next: 'Run "forge codegen" so generated/index matches the committed manifests, then re-run "forge probe".',
    };
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
      return {
        ok: false,
        code: 'PROBE_TARGET_UNCONFIGURED',
        message: `${functionTools.length} function tool(s) need an AIS target, and ${overlayFile} does not exist.`,
        next: `Create ${overlayFile} (kind: AisTargets) naming each module server's target and a probeIdentity, or pass --deployment <id> for a deployment that has one.`,
      };
    }
    let overlay;
    try {
      overlay = loadAisTargetsOverlay(overlayPath);
    } catch (err) {
      return {
        ok: false,
        code: 'PROBE_TARGET_UNCONFIGURED',
        message: err instanceof AisTargetsOverlayInvalid ? err.message : String(err),
        next: `Fix ${overlayFile} as listed, then re-run "forge probe".`,
      };
    }
    const wiring = wireFunctionProbe({
      overlay,
      tools: functionTools,
      credential: input.credential,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    });
    if (!wiring.ok) {
      return {
        ok: false,
        code: 'PROBE_TARGET_UNCONFIGURED',
        message: wiring.problems.map((p) => p.message).join(' '),
        next: wiring.problems.map((p) => p.next).join(' '),
      };
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
    target: input.target,
    tools: probeInputsFromCatalogue(index, details),
    executors,
  });
  return { ok: true, report };
}
