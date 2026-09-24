// MCPForge — W0-J13: the Catalog's thirteen facets (03 §5.3's table),
// derived entirely from real `ToolManifest`/probe/change-state fields —
// see `types.ts`'s file header. `../components/data/facets.ts` (W0-J10)
// owns the generic encode/decode/toggle contract; this module only supplies
// the facet GROUP definitions and the filter predicate over `CatalogTool`.
//
// The thirteen groups, in 03 §5.3's table order:
//   1 free text        -> `q`         (lexical: id + purpose + aliases + entity)
//   2 application       -> `app`
//   3 module / server   -> `server`
//   4 archetype         -> `archetype`
//   5 binding type      -> `binding`
//   6 package (slice)   -> `package`
//   7 verb              -> `verb`
//   8 write             -> `write`    (tri-state: any / read-only / write)
//   9 sensitivity       -> `sensitivity`
//  10 process tag       -> `process`
//  11 role              -> `role`
//  12 probe status      -> `status`
//  13 change state      -> `change`
//
// JUDGMENT CALL — free text is `q`, a single un-grouped value rather than a
// `FacetState` group of many, because 03 §5.3 describes it as "a search
// input, debounced" (one string), not a multi-select; it is still carried in
// the same URL-encoded state object so the whole filter set — search
// included — round-trips as one shareable link, which is the `done:`
// requirement ("Facet state is URL-encoded so a filtered catalog is a
// shareable link").
import type { FacetGroupDef } from '@/components/data/facet-panel';
import type { FacetState } from '@/components/data/facets';
import {
  BINDING_TYPE,
  PROBE_STATUS,
  CHANGE_STATE,
  SENSITIVITIES,
  VERB,
  VERBS,
} from '@mcpforge/shared';
import type { CatalogData, CatalogTool } from './types';

export const FREE_TEXT_KEY = 'q';

const WRITE_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'read', label: 'Read-only' },
  { value: 'write', label: 'Write' },
] as const;

/** Builds a `FacetOption`, omitting `count` entirely when unknown — required under `exactOptionalPropertyTypes`. */
function opt(value: string, label: string, count: number | undefined): { value: string; label: string; count?: number } {
  return count === undefined ? { value, label } : { value, label, count };
}

function countBy<T>(rows: readonly CatalogTool[], get: (row: CatalogTool) => readonly T[] | T | undefined) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = get(row);
    const values = v === undefined ? [] : Array.isArray(v) ? v : [v];
    for (const raw of values) {
      const key = String(raw);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/** Builds the thirteen (minus free text) facet groups, each option carrying a live count over `rows`. */
export function buildFacetGroups(data: CatalogData, rows: readonly CatalogTool[]): FacetGroupDef[] {
  const appCounts = countBy(rows, (r) => r.manifest.app);
  const serverCounts = countBy(rows, (r) => r.manifest.server);
  const archetypeCounts = countBy(rows, (r) => r.manifest.archetype);
  const bindingCounts = countBy(rows, (r) => r.manifest.binding.type);
  const packageCounts = countBy(rows, (r) => r.packages);
  const verbCounts = countBy(rows, (r) => r.manifest.verb);
  const writeCounts = countBy(rows, (r) => (r.manifest.write ? 'write' : 'read'));
  const sensitivityCounts = countBy(rows, (r) => r.manifest.sensitivity);
  const processCounts = countBy(rows, (r) => r.manifest.processTags ?? []);
  const roleCounts = countBy(rows, (r) => data.roles.filter((role) => role.toolIds.includes(r.manifest.id)).map((role) => role.id));
  const statusCounts = countBy(rows, (r) => r.probeStatus);
  const changeCounts = countBy(rows, (r) => r.changeState);

  const readVerbs = VERBS.filter((v) => !['create', 'update', 'cancel', 'submit', 'approve', 'release', 'run_process'].includes(v));

  return [
    {
      key: 'app',
      label: 'Application',
      options: [...appCounts.keys()].sort().map((v) => opt(v, v.toUpperCase(), appCounts.get(v))),
    },
    {
      key: 'server',
      label: 'Module / server',
      options: [...serverCounts.keys()].sort().map((v) => opt(v, v, serverCounts.get(v))),
    },
    {
      key: 'archetype',
      label: 'Archetype',
      options: [...archetypeCounts.keys()].sort().map((v) => opt(v, v, archetypeCounts.get(v))),
    },
    {
      key: 'binding',
      label: 'Binding type',
      options: [...bindingCounts.keys()].map((v) =>
        opt(v, BINDING_TYPE[v as keyof typeof BINDING_TYPE]?.label ?? v, bindingCounts.get(v)),
      ),
    },
    {
      key: 'package',
      label: 'Deployment package',
      options: [...packageCounts.keys()].sort().map((v) => opt(v, v, packageCounts.get(v))),
    },
    {
      // Grouped Read then Write (03 §5.3's "multi-select from the closed
      // 17/19-verb list, grouped Read / Write") by ORDERING the options
      // read-verbs-first rather than a sub-heading — `FacetPanel` (W0-J10)
      // renders one flat pill row per group and has no sub-grouping
      // affordance, and adding one is out of this task's `touches:`
      // (`core/portal/src/app/catalog/**` only). Documented judgment call.
      key: 'verb',
      label: 'Verb (read, then write)',
      options: [
        ...readVerbs.filter((v) => verbCounts.has(v)).map((v) => opt(v, VERB[v]?.label ?? v, verbCounts.get(v))),
        ...VERBS.filter((v) => !readVerbs.includes(v))
          .filter((v) => verbCounts.has(v))
          .map((v) => opt(v, VERB[v]?.label ?? v, verbCounts.get(v))),
      ],
    },
    {
      key: 'write',
      label: 'Write',
      options: WRITE_OPTIONS.map((o) => opt(o.value, o.label, o.value === 'any' ? rows.length : writeCounts.get(o.value))),
    },
    {
      key: 'sensitivity',
      label: 'Sensitivity',
      options: SENSITIVITIES.filter((s) => sensitivityCounts.has(s)).map((s) => opt(s, s, sensitivityCounts.get(s))),
    },
    {
      key: 'process',
      label: 'Process tag',
      options: [...processCounts.keys()].sort().map((v) => opt(v, v.toUpperCase(), processCounts.get(v))),
    },
    {
      key: 'role',
      label: 'Role',
      options: data.roles.filter((role) => roleCounts.has(role.id)).map((role) => opt(role.id, role.label, roleCounts.get(role.id))),
    },
    {
      key: 'status',
      label: 'Probe status',
      options: [...statusCounts.keys()].map((v) =>
        opt(v, PROBE_STATUS[v as keyof typeof PROBE_STATUS]?.label ?? v, statusCounts.get(v)),
      ),
    },
    {
      key: 'change',
      label: 'Change state',
      options: [...changeCounts.keys()].map((v) =>
        opt(v, CHANGE_STATE[v as keyof typeof CHANGE_STATE]?.label ?? v, changeCounts.get(v)),
      ),
    },
  ];
}

/** `resolved` and `degraded_readonly` preselected, per 03 §5.3's facet table. */
export const DEFAULT_FACET_STATE: FacetState = {
  status: ['resolved', 'degraded_readonly'],
};

function matchesGroup(state: FacetState, key: string, test: (value: string) => boolean): boolean {
  const selected = state[key];
  if (!selected || selected.length === 0) return true;
  return selected.some(test);
}

/** Applies the free-text query plus all twelve grouped facets to one row. */
export function matchesFacets(row: CatalogTool, data: CatalogData, state: FacetState): boolean {
  const q = (state[FREE_TEXT_KEY]?.[0] ?? '').trim().toLowerCase();
  if (q.length > 0) {
    const haystack = [row.manifest.id, row.manifest.purpose, row.manifest.title, ...(row.manifest.aliases ?? []), row.manifest.entity]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  const roleIdsForRow = data.roles.filter((role) => role.toolIds.includes(row.manifest.id)).map((role) => role.id);

  return (
    matchesGroup(state, 'app', (v) => row.manifest.app === v) &&
    matchesGroup(state, 'server', (v) => row.manifest.server === v) &&
    matchesGroup(state, 'archetype', (v) => row.manifest.archetype === v) &&
    matchesGroup(state, 'binding', (v) => row.manifest.binding.type === v) &&
    matchesGroup(state, 'package', (v) => row.packages.includes(v)) &&
    matchesGroup(state, 'verb', (v) => row.manifest.verb === v) &&
    matchesGroup(
      state,
      'write',
      (v) => v === 'any' || (v === 'write' ? row.manifest.write : !row.manifest.write),
    ) &&
    matchesGroup(state, 'sensitivity', (v) => row.manifest.sensitivity === v) &&
    matchesGroup(state, 'process', (v) => (row.manifest.processTags ?? []).includes(v)) &&
    matchesGroup(state, 'role', (v) => roleIdsForRow.includes(v)) &&
    matchesGroup(state, 'status', (v) => row.probeStatus === v) &&
    matchesGroup(state, 'change', (v) => row.changeState === v)
  );
}

export function filterCatalog(data: CatalogData, state: FacetState): CatalogTool[] {
  return data.tools.filter((row) => matchesFacets(row, data, state));
}
