// MCPForge — W0-J18: the Security posture tab (03 §5.3 "Governance" item 3).
//
// "one row per application, with binding types in play (chips, computed from
// the deployed catalogue), identity carried (FROM THE PROBE, NOT FROM THE
// MANIFEST), and what actually enforces access. The OIC service-account
// exception stays a highlighted row."
//
// CLAUDE.md non-negotiable #2, made structural rather than remembered:
//
//   `identityCarries` on a row can ONLY be set from a `ProbeToolReport`, read
//   out of `.mcpforge/probe-report.json`. This module has no code path that
//   reads `binding.identity.carries` from a manifest, and `deriveRows` takes
//   the probe entries as an argument so an empty probe set can only ever
//   produce `identityCarries: null` — "not established by a probe" — never a
//   verdict. A row that claims anything therefore names the probe run that
//   established it, and the UI renders no verdict without that reference.
//
// The binding-type chips ARE read from the catalogue, because 03 says so and
// because a binding type is a structural fact about a manifest, not a claim
// about identity. The two sources are deliberately different and the row keeps
// them apart.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { resolveRepoRoot } from '../../build/_lib/repo-root';
import type { BindingType, IdentityCarries, SecurityPostureRowView } from '../types';

/** 03 §5.3 tab 3's standing caption, verbatim in intent and fixed. */
export const POSTURE_CAPTION =
  'Only REST/OAuth and per-user-token rows carry identity by themselves. Everything else needs a named compensating control, and the probe — not the manifest — decides which is which.';

/** The one place the probe report lives (`core/probe/src/report/io.ts`). */
export const PROBE_REPORT_RELATIVE_PATH = '.mcpforge/probe-report.json';

/** The subset of `ProbeToolReport` this tab reads. Field names are the probe's. */
export interface ProbeToolEntry {
  readonly toolId: string;
  readonly bindingType: string;
  readonly identity: {
    readonly carries: IdentityCarries;
    readonly observedIdentity: string | null;
    readonly disposition: string | null;
    readonly detail: string;
  };
}

export interface ProbeSnapshot {
  /** The run this came from — the reference a row must cite to claim anything. */
  readonly reference: string | null;
  readonly tools: readonly ProbeToolEntry[];
}

function appOf(toolId: string): string {
  return toolId.split('.')[0] ?? toolId;
}

function walkYaml(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walkYaml(abs, out);
    else if (name.endsWith('.tool.yaml')) out.push(abs);
  }
  return out;
}

/** app -> binding types present in the deployed catalogue. Manifest-structural, not a claim. */
export function loadCatalogueBindingTypes(
  repoRoot: string = resolveRepoRoot(),
): ReadonlyMap<string, readonly BindingType[]> {
  const byApp = new Map<string, Set<string>>();
  for (const abs of walkYaml(join(repoRoot, 'manifests'))) {
    let doc: Record<string, unknown>;
    try {
      doc = (parseYaml(readFileSync(abs, 'utf8')) ?? {}) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (doc['kind'] !== 'Tool' || typeof doc['id'] !== 'string') continue;
    const binding = doc['binding'];
    const type =
      typeof binding === 'object' && binding !== null
        ? (binding as Record<string, unknown>)['type']
        : undefined;
    if (typeof type !== 'string') continue;
    const app = appOf(doc['id']);
    const set = byApp.get(app) ?? new Set<string>();
    set.add(type);
    byApp.set(app, set);
  }
  const out = new Map<string, readonly BindingType[]>();
  for (const [app, set] of byApp) {
    out.set(app, [...set].sort() as readonly BindingType[]);
  }
  return out;
}

/** Read `.mcpforge/probe-report.json` if a probe has run here. Never fabricated. */
export function loadProbeSnapshot(repoRoot: string = resolveRepoRoot()): ProbeSnapshot {
  const abs = join(repoRoot, PROBE_REPORT_RELATIVE_PATH);
  if (!existsSync(abs)) return { reference: null, tools: [] };
  try {
    const doc = JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
    const target = (doc['target'] ?? {}) as Record<string, unknown>;
    const finishedAt = typeof doc['finishedAt'] === 'string' ? doc['finishedAt'] : 'unknown time';
    const deploymentId =
      typeof target['deploymentId'] === 'string' ? target['deploymentId'] : 'unknown deployment';
    const tools = Array.isArray(doc['tools'])
      ? doc['tools'].flatMap((t): ProbeToolEntry[] => {
          if (typeof t !== 'object' || t === null) return [];
          const entry = t as Record<string, unknown>;
          const identity = (entry['identity'] ?? {}) as Record<string, unknown>;
          const carries = identity['carries'];
          if (carries !== 'verified' && carries !== 'unverified' && carries !== 'no') return [];
          return [
            {
              toolId: typeof entry['toolId'] === 'string' ? entry['toolId'] : '',
              bindingType: typeof entry['bindingType'] === 'string' ? entry['bindingType'] : '',
              identity: {
                carries,
                observedIdentity:
                  typeof identity['observedIdentity'] === 'string'
                    ? identity['observedIdentity']
                    : null,
                disposition:
                  typeof identity['disposition'] === 'string' ? identity['disposition'] : null,
                detail: typeof identity['detail'] === 'string' ? identity['detail'] : '',
              },
            },
          ];
        })
      : [];
    return { reference: `probe run ${deploymentId} @ ${finishedAt}`, tools };
  } catch {
    return { reference: null, tools: [] };
  }
}

/**
 * One row per application.
 *
 * The identity verdict for an application is the WEAKEST verdict any of its
 * tools reported — `no` beats `unverified` beats `verified`. A single tool
 * running under a service account is the application's posture, and averaging
 * it away would hide exactly the row 03 asks to highlight.
 */
export function deriveRows(
  bindingTypes: ReadonlyMap<string, readonly BindingType[]>,
  probe: ProbeSnapshot,
): readonly SecurityPostureRowView[] {
  const rank: Record<IdentityCarries, number> = { no: 0, unverified: 1, verified: 2 };
  const byApp = new Map<string, ProbeToolEntry[]>();
  for (const entry of probe.tools) {
    const app = appOf(entry.toolId);
    byApp.set(app, [...(byApp.get(app) ?? []), entry]);
  }

  const apps = [...new Set([...bindingTypes.keys(), ...byApp.keys()])].sort();
  return apps.map((application) => {
    const entries = byApp.get(application) ?? [];
    const weakest = entries.reduce<ProbeToolEntry | null>(
      (worst, e) =>
        worst === null || rank[e.identity.carries] < rank[worst.identity.carries] ? e : worst,
      null,
    );
    const carried = weakest?.identity.carries ?? null;
    // A verdict without a probe reference is not a verdict. Both are null or
    // both are set — never one.
    const probeReference = carried === null ? null : probe.reference;
    const exception = carried === 'no' || carried === 'unverified';
    return {
      application,
      bindingTypes: bindingTypes.get(application) ?? [],
      identityCarries: probeReference === null ? null : carried,
      probeReference,
      enforcedBy:
        weakest?.identity.detail !== undefined && weakest.identity.detail !== ''
          ? weakest.identity.detail
          : 'Not established — no capability probe has reported on this application.',
      nonCarriageDisposition:
        weakest?.identity.disposition === 'block' ||
        weakest?.identity.disposition === 'readonly-lowsens'
          ? weakest.identity.disposition
          : null,
      exception: probeReference === null ? false : exception,
      note:
        probeReference === null
          ? 'No probe evidence. MCPForge will not mark this application identity-carrying without it.'
          : exception
            ? 'The probe did not observe this application carrying the human identity into the target. Constrained until it does.'
            : 'The probe observed the target executing under the calling human identity.',
    };
  });
}

export function loadPostureRows(
  repoRoot: string = resolveRepoRoot(),
): readonly SecurityPostureRowView[] {
  return deriveRows(loadCatalogueBindingTypes(repoRoot), loadProbeSnapshot(repoRoot));
}
