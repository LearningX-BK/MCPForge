// MCPForge — W0-Q2: `/catalog/servers/[serverId]` — one module server, read for real.
//
// Definitional half from git: the server manifest and every tool manifest whose
// `server:` names it. Runtime half (probe, kill switch) from `/api/v1`, joined by
// the inventory's own `toInventory`, so the two pages can never disagree. Server-only.
//
// The 15–20 tool figure is 01 §2's split-rule INPUT, shown against the real count.
// "Auth boundary" and "sensitivity class" are not fields of `kind: Server`; they are
// shown as the facts the server's tools declare (binding types and technologies;
// sensitivity classes), never as a verdict. The split rule needs two of five inputs
// to fire; this page shows inputs, it does not decide.

import { loadManifestFiles } from '@mcpforge/codegen/validate';

import { resolveRepoRoot } from '../../../build/_lib/repo-root';
import {
  toInventory,
  type ServerDefinition,
  type ServerInventoryRow,
} from '../../../environments/servers/load-servers';
import type { DeploymentResponse, EnablementResponse } from '@mcpforge/shared/api/v1';

/** The split rule's tool-count input: "> 15–20 tools" (01 §2). */
export const SPLIT_TOOL_COUNT_LOW = 15;
export const SPLIT_TOOL_COUNT_HIGH = 20;

export interface ServerToolTarget {
  readonly toolId: string;
  readonly verb: string;
  readonly write: boolean;
  readonly bindingType: string;
  readonly technology: string;
  /** The underlying target: orchestration, package, table/view or endpoint. */
  readonly target: string;
}

export interface EntityGroup {
  readonly entity: string;
  readonly tools: readonly ServerToolTarget[];
}

export interface ServerDetailDefinition {
  readonly def: ServerDefinition;
  readonly app: string;
  readonly module: string;
  readonly steward: string;
  readonly promotionReason?: string;
  readonly entities: readonly EntityGroup[];
  readonly technologies: readonly string[];
  readonly sensitivityClasses: readonly string[];
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;

export function toolCountPosition(n: number): 'below' | 'in-range' | 'above' {
  return n > SPLIT_TOOL_COUNT_HIGH ? 'above' : n >= SPLIT_TOOL_COUNT_LOW ? 'in-range' : 'below';
}

/** Git half. `undefined` when no `manifests/**` server has this id. */
export function loadServerDetailDefinition(
  serverId: string,
  repoRoot: string = resolveRepoRoot(),
): ServerDetailDefinition | undefined {
  let server: Record<string, unknown> | undefined;
  const byEntity = new Map<string, ServerToolTarget[]>();
  const techs = new Set<string>();
  const sens = new Set<string>();

  for (const file of loadManifestFiles(repoRoot)) {
    const doc = file.doc as Record<string, unknown> | null | undefined;
    if (doc === null || doc === undefined) continue;
    if (doc['kind'] === 'Server' && doc['id'] === serverId) server = doc;
    else if (
      doc['kind'] === 'Tool' &&
      doc['server'] === serverId &&
      typeof doc['id'] === 'string'
    ) {
      const b = (doc['binding'] ?? {}) as Record<string, unknown>;
      const bindingType = str(b['type']) ?? 'not declared';
      const technology = str(b['technology']) ?? 'not declared';
      const ref = str(b['ref']) ?? str(b['object']) ?? str(b['endpoint']) ?? str(b['package']);
      const refVersion = str(b['refVersion']);
      const row: ServerToolTarget = {
        toolId: doc['id'],
        verb: str(doc['verb']) ?? '',
        write: doc['write'] === true,
        bindingType,
        technology,
        target: ref === undefined ? 'not declared' : refVersion ? `${ref} v${refVersion}` : ref,
      };
      const entity = str(doc['entity']) ?? 'unspecified';
      byEntity.set(entity, [...(byEntity.get(entity) ?? []), row]);
      techs.add(technology);
      const s = str(doc['sensitivity']);
      if (s !== undefined) sens.add(s);
    }
  }
  if (server === undefined) return undefined;

  const entities = [...byEntity.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([entity, ts]) => ({
      entity,
      tools: ts.slice().sort((a, b) => a.toolId.localeCompare(b.toolId)),
    }));
  const all = entities.flatMap((e) => e.tools);
  return {
    def: {
      id: serverId,
      label: str(server['label']) ?? serverId,
      mode: server['mode'] === 'B' ? 'B' : 'A',
      version: str(server['version']) ?? 'not declared',
      owner: str(server['owner']) ?? 'not declared',
      toolIds: all.map((t) => t.toolId).sort(),
      bindingTypes: [...new Set(all.map((t) => t.bindingType))].sort(),
    },
    app: str(server['app']) ?? 'not declared',
    module: str(server['module']) ?? 'not declared',
    steward: str(server['steward']) ?? 'not declared',
    ...(str(server['promotionReason']) === undefined
      ? {}
      : { promotionReason: str(server['promotionReason'])! }),
    entities,
    technologies: [...techs].sort(),
    sensitivityClasses: [...sens].sort(),
  };
}

/** Join with runtime reads; a `null` read is `unknown`, never "not killed". */
export function toServerRuntime(
  def: ServerDefinition,
  enablement: EnablementResponse | null,
  deployment: DeploymentResponse | null,
): ServerInventoryRow {
  return toInventory([def], enablement, deployment)[0]!;
}
