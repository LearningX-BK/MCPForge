// MCPForge — W0-P3e: the Catalog's data, from the two places it actually lives.
// Server-only.
//
// W0-P2 §7 draws the line: definitional reads stay on git, runtime state comes
// from `/api/v1`. A Catalog row is both, so it is assembled from both:
//
//  GIT (always shown, needs no gateway):
//   - the tool itself: every committed `manifests/**/*.tool.yaml`, verbatim;
//   - `manifestSha`: the git BLOB sha of that file's bytes, computed the way git
//     does (`sha1("blob <len>\0" + bytes)`), so it matches `git hash-object`;
//   - packages and roles: the compiled `generated/packages/*.selection.json`
//     and `generated/roles/*.scope.json`;
//   - the deployed package: `overlays/<deployment>/deployment.yaml`;
//   - change state: an open Build draft for the tool (the ChangeHost) says
//     `draft` / `in_review`; otherwise the committed manifest is `merged`.
//     Never `deployed`: that is the gateway's to say, not git's (03 §6.1).
//
//  /api/v1 (as the signed-in viewer):
//   - probe status: `/enablement`. `null` there is `not_probed`. A tool the
//     gateway did not report to this viewer, or any tool when the read failed,
//     is `unknown`, and a failed read also sets `runtimeNotice`.
//   - consumption: `/calls?tool=`, for ONE tool, on its detail page only.
//
// Never invented: probe-reported identity carriage is not served by any
// endpoint yet, so `probeIdentity` is `null` ("not probed" in the identity
// block); per-tool benchmark results are not recorded, so `lastBenchmark` is
// absent.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifestFiles } from '@mcpforge/codegen/validate';
import { loadConsumerRegistry } from '@mcpforge/gateway/consumer/records';
import type { ToolManifest } from '@mcpforge/shared';
import { parse as parseYaml } from 'yaml';

import { readCalls, readEnablement, type ReadResult } from '@/lib/gateway-client/read-client';
import type { EnablementResponse } from '@mcpforge/shared/api/v1';

import { listBuildDrafts } from '../build/drafts';
import { resolveRepoRoot } from '../build/_lib/repo-root';
import type {
  CatalogData,
  CatalogProbeState,
  CatalogRole,
  CatalogTool,
  ChangeState,
  ToolConsumption,
} from './types';

/** `git hash-object` for a file's bytes: the id git itself gives the blob. */
export function gitBlobSha(bytes: Buffer): string {
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest('hex');
}

function jsonFiles(dir: string, suffix: string): { name: string; doc: Record<string, unknown> }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .sort()
    .map((f) => ({
      name: f.slice(0, -suffix.length),
      doc: JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>,
    }));
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** The git half. Synchronous and gateway-free. */
export function loadCatalogDefinitions(repoRoot: string = resolveRepoRoot()): {
  readonly tools: readonly Omit<CatalogTool, 'probeStatus' | 'changeState'>[];
  readonly roles: readonly CatalogRole[];
  readonly deployment: CatalogData['deployment'];
} {
  const packagesOf = new Map<string, string[]>();
  for (const { name, doc } of jsonFiles(
    join(repoRoot, 'generated', 'packages'),
    '.selection.json',
  )) {
    for (const id of strings(doc['toolIds']))
      packagesOf.set(id, [...(packagesOf.get(id) ?? []), name]);
  }

  const tools = loadManifestFiles(repoRoot)
    .filter((f) => (f.doc as { kind?: unknown } | undefined)?.kind === 'Tool')
    .map((f) => {
      const manifest = f.doc as ToolManifest;
      return {
        manifest,
        packages: packagesOf.get(manifest.id) ?? [],
        manifestSha: gitBlobSha(readFileSync(f.absPath)),
        probeIdentity: null,
      };
    })
    .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));

  const roles: CatalogRole[] = jsonFiles(join(repoRoot, 'generated', 'roles'), '.scope.json').map(
    ({ name, doc }) => ({
      id: typeof doc['roleId'] === 'string' ? doc['roleId'] : name,
      label: typeof doc['label'] === 'string' ? doc['label'] : name,
      toolIds: strings(doc['toolIds']),
    }),
  );

  const deploymentId = process.env['MCPFORGE_DEPLOYMENT'] ?? 'local';
  const overlay = join(repoRoot, 'overlays', deploymentId, 'deployment.yaml');
  const selected = existsSync(overlay)
    ? strings((parseYaml(readFileSync(overlay, 'utf8')) as { packages?: unknown } | null)?.packages)
    : [];
  const deployedPackageId = selected[0] ?? '';
  const pkgFile = join(repoRoot, 'packages', `${deployedPackageId}.yaml`);
  const pkgLabel =
    deployedPackageId !== '' && existsSync(pkgFile)
      ? (parseYaml(readFileSync(pkgFile, 'utf8')) as { label?: unknown } | null)?.label
      : undefined;

  return {
    tools,
    roles,
    deployment: {
      deployedPackageId,
      deploymentLabel:
        typeof pkgLabel === 'string'
          ? `${pkgLabel} · deployment ${deploymentId}`
          : `deployment ${deploymentId}`,
    },
  };
}

export interface CatalogLoadDeps {
  readonly repoRoot?: string;
  readonly enablement?: () => Promise<ReadResult<EnablementResponse>>;
  readonly draftStates?: () => Promise<ReadonlyMap<string, ChangeState>>;
}

async function openDraftStates(): Promise<ReadonlyMap<string, ChangeState>> {
  const result = await listBuildDrafts();
  if (result.kind !== 'ok') return new Map();
  return new Map(result.drafts.map((d) => [d.toolId, d.state]));
}

/** The whole Catalog: git always, runtime facets when the gateway answers. */
export async function loadCatalogData(deps: CatalogLoadDeps = {}): Promise<CatalogData> {
  const defs = loadCatalogDefinitions(deps.repoRoot);
  const [enablement, drafts] = await Promise.all([
    (deps.enablement ?? (() => readEnablement()))(),
    (deps.draftStates ?? openDraftStates)(),
  ]);

  const reported =
    enablement.kind === 'ok'
      ? new Map(enablement.data.tools.map((t) => [t.toolId, t.status]))
      : undefined;
  const statusOf = (toolId: string): CatalogProbeState => {
    if (reported === undefined || !reported.has(toolId)) return 'unknown';
    const status = reported.get(toolId);
    return status === null || status === undefined ? 'not_probed' : (status as CatalogProbeState);
  };

  return {
    tools: defs.tools.map((t) => ({
      ...t,
      probeStatus: statusOf(t.manifest.id),
      changeState: drafts.get(t.manifest.id) ?? 'merged',
    })),
    roles: defs.roles,
    deployment: defs.deployment,
    ...(enablement.kind === 'ok' ? {} : { runtimeNotice: enablement }),
  };
}

/** How many pages of `/api/v1/calls` (200 each) one consumption count may read. */
export const CONSUMPTION_PAGE_CAP = 5;

/**
 * One tool's last 30 days, counted from the calls the viewer may read. Stops
 * at the page cap and says so (`atLeast`), rather than reading without bound.
 */
export async function loadToolConsumption(
  toolId: string,
  deps: {
    readonly calls?: typeof readCalls;
    readonly now?: () => Date;
    readonly repoRoot?: string;
  } = {},
): Promise<ToolConsumption> {
  const read = deps.calls ?? readCalls;
  const since = (deps.now?.() ?? new Date()).getTime() - 30 * 86_400_000;
  const byConsumer = new Map<string, number>();
  let count = 0;
  let lastCallAt: string | undefined;
  let cursor: string | undefined;
  let atLeast = false;

  for (let page = 0; page < CONSUMPTION_PAGE_CAP; page++) {
    const result = await read({
      tool: toolId,
      limit: 200,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (result.kind !== 'ok') {
      if (page > 0) break;
      return {
        kind: 'unavailable',
        message:
          result.kind === 'gateway-down'
            ? `The gateway at ${result.endpoint} did not answer, so calls to this tool cannot be counted.`
            : result.kind === 'signed-out'
              ? 'Sign in to see who has called this tool.'
              : result.message,
        next: result.next,
      };
    }
    let reachedOlder = false;
    for (const call of result.data.items) {
      if (Date.parse(call.ts) < since) {
        reachedOlder = true;
        break;
      }
      count += 1;
      lastCallAt ??= call.ts;
      byConsumer.set(call.consumerId, (byConsumer.get(call.consumerId) ?? 0) + 1);
    }
    if (reachedOlder || result.data.nextCursor === null) break;
    cursor = result.data.nextCursor;
    if (page === CONSUMPTION_PAGE_CAP - 1) atLeast = true;
  }

  const registry = loadConsumerRegistry(deps.repoRoot ?? resolveRepoRoot());
  const platformOf = (id: string): string => {
    const record = registry.consumers.find((c) => c.record.id === id)?.record;
    return record === undefined ? 'unregistered' : (record.label ?? record.class);
  };

  return {
    kind: 'counted',
    last30dCalls: count,
    ...(lastCallAt === undefined ? {} : { lastCallAt }),
    consumers: [...byConsumer.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, calls30d]) => ({ id, platform: platformOf(id), calls30d })),
    ...(atLeast ? { atLeast } : {}),
  };
}
