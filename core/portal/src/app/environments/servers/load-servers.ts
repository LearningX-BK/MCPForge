// MCPForge — W0-P6: `/environments/servers` — the module-server inventory.
//
// W0-P2 §7 (owner decision, 25 Sep 2026): definitional reads stay on git, runtime
// state comes from `/api/v1`. A server row is both, so it is assembled from both
// (the same split W0-P3c's packages page and W0-P3e's Catalog use):
//
//  GIT (always shown, needs no gateway): the server itself, read from
//   `manifests/_servers/*.server.yaml`; its tools, counted from every committed
//   `manifests/**/*.tool.yaml` whose `server:` names it; the binding types those
//   tools use.
//  /api/v1 (as the signed-in viewer): probe status per tool (`/enablement`) and
//   active kill flags (`/deployment`). When a read fails the corresponding
//   column is `unknown`, which is a different state from "not probed" and from
//   "not killed", and the page says why once.
//
// Never invented: no identity-carriage claim is made here, so nothing on this
// surface can say "verified" (non-negotiable 2). Server-only (`node:fs`).

import { loadManifestFiles } from '@mcpforge/codegen/validate';
import type { DeploymentResponse, EnablementResponse } from '@mcpforge/shared/api/v1';

import { resolveRepoRoot } from '../../build/_lib/repo-root';

export interface ServerDefinition {
  readonly id: string;
  readonly label: string;
  readonly mode: 'A' | 'B';
  readonly version: string;
  readonly owner: string;
  readonly toolIds: readonly string[];
  readonly bindingTypes: readonly string[];
}

/** How the probe reported a server's tools: status -> count, plus tools no report names. */
export interface ServerProbeSummary {
  readonly byStatus: readonly { readonly status: string; readonly count: number }[];
  readonly notProbed: number;
}

export type ServerProbeState =
  | { readonly kind: 'reported'; readonly summary: ServerProbeSummary }
  | { readonly kind: 'unknown' };

export type ServerKillState =
  | {
      readonly kind: 'known';
      /** Active flags that stop this whole server (moduleServer for it, or deployment-wide). */
      readonly serverFlags: readonly { readonly scope: string; readonly reason: string }[];
      /** Active tool-scope flags on this server's tools. */
      readonly killedToolCount: number;
    }
  | { readonly kind: 'unknown' };

export interface ServerInventoryRow extends ServerDefinition {
  readonly probe: ServerProbeState;
  readonly kill: ServerKillState;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;

/** The git half. Synchronous and gateway-free. Sorted by id. */
export function loadServerDefinitions(
  repoRoot: string = resolveRepoRoot(),
): readonly ServerDefinition[] {
  const servers: {
    id: string;
    label: string;
    mode: 'A' | 'B';
    version: string;
    owner: string;
  }[] = [];
  const toolsByServer = new Map<string, { ids: string[]; bindings: Set<string> }>();

  for (const file of loadManifestFiles(repoRoot)) {
    const doc = file.doc as Record<string, unknown> | null | undefined;
    if (doc === null || doc === undefined) continue;
    if (doc['kind'] === 'Server' && typeof doc['id'] === 'string') {
      servers.push({
        id: doc['id'],
        label: str(doc['label']) ?? doc['id'],
        mode: doc['mode'] === 'B' ? 'B' : 'A',
        version: str(doc['version']) ?? 'not declared',
        owner: str(doc['owner']) ?? 'not declared',
      });
    } else if (doc['kind'] === 'Tool' && typeof doc['id'] === 'string') {
      const server = str(doc['server']);
      if (server === undefined) continue;
      const entry = toolsByServer.get(server) ?? { ids: [], bindings: new Set<string>() };
      entry.ids.push(doc['id']);
      const type = str((doc['binding'] as { type?: unknown } | undefined)?.type);
      if (type !== undefined) entry.bindings.add(type);
      toolsByServer.set(server, entry);
    }
  }

  return servers
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => {
      const t = toolsByServer.get(s.id);
      return {
        ...s,
        toolIds: (t?.ids ?? []).slice().sort(),
        bindingTypes: [...(t?.bindings ?? [])].sort(),
      };
    });
}

/** Joins the git half with whatever runtime reads succeeded. A `null` read is `unknown`, never empty. */
export function toInventory(
  defs: readonly ServerDefinition[],
  enablement: EnablementResponse | null,
  deployment: DeploymentResponse | null,
): readonly ServerInventoryRow[] {
  const statusOf =
    enablement === null ? null : new Map(enablement.tools.map((t) => [t.toolId, t.status]));

  return defs.map((def): ServerInventoryRow => {
    let probe: ServerProbeState = { kind: 'unknown' };
    if (statusOf !== null) {
      const counts = new Map<string, number>();
      let notProbed = 0;
      for (const id of def.toolIds) {
        const status = statusOf.get(id);
        // A tool the gateway did not report (outside the viewer's scope) is not
        // "not probed": nobody said. Leave it out of both counts.
        if (status === undefined) continue;
        if (status === null) notProbed += 1;
        else counts.set(status, (counts.get(status) ?? 0) + 1);
      }
      probe = {
        kind: 'reported',
        summary: {
          byStatus: [...counts.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([status, count]) => ({ status, count })),
          notProbed,
        },
      };
    }

    let kill: ServerKillState = { kind: 'unknown' };
    if (deployment !== null) {
      const own = new Set(def.toolIds);
      kill = {
        kind: 'known',
        serverFlags: deployment.killFlags
          .filter(
            (f) => (f.scope === 'moduleServer' && f.target === def.id) || f.scope === 'deployment',
          )
          .map((f) => ({ scope: f.scope, reason: f.reason })),
        killedToolCount: deployment.killFlags.filter((f) => f.scope === 'tool' && own.has(f.target))
          .length,
      };
    }
    return { ...def, probe, kill };
  });
}
