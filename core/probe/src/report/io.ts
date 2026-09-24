// MCPForge — writing and reading `probe-report.json`, and the bridge into the
// gateway's `ProbeStatusSource`. 02 §4.5. W0-H4.
//
// WRITER DISCIPLINE — non-negotiable #2. This module writes exactly ONE path:
// `<root>/.mcpforge/probe-report.json`. It is the only writer in
// `core/probe/**`, it takes no caller-supplied directory outside that root, and
// nothing in this package opens `manifests/**` for writing at all. `verified`
// (here: `identityCarries`) therefore cannot reach a manifest by any code path
// in this package — which is the mechanical form of the rule, as opposed to a
// promise about it.
//
// The report lands under `.mcpforge/` — the runtime directory, not git —
// because it is an EVENT, not a definition (02 §1.5, CLAUDE.md §3.1). The
// consequence is intended: `rm -rf .mcpforge/` removes the probe report and the
// gateway then resolves an empty `tools/list` until the next `forge probe`,
// which is exactly the fail-closed reading `ProbeStatusSource` documents.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertProbeReport } from './schema.js';
import type { ProbeReport } from './types.js';
import type { ProbeStatus } from '../status.js';

/** Repo-relative path of the artefact, stated once. */
export const PROBE_REPORT_RELATIVE_PATH = ['.mcpforge', 'probe-report.json'] as const;

export function probeReportPath(root: string): string {
  return join(root, ...PROBE_REPORT_RELATIVE_PATH);
}

/**
 * Validate, then write. Validation happens BEFORE the write, so an invalid
 * report never reaches disk where a later reader could half-trust it.
 */
export function writeProbeReport(root: string, report: ProbeReport): string {
  assertProbeReport(report);
  const filePath = probeReportPath(root);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return filePath;
}

export class ProbeReportLoadError extends Error {
  constructor(
    public readonly filePath: string,
    reason: string,
  ) {
    super(`Failed to load probe report from ${filePath}: ${reason}`);
    this.name = 'ProbeReportLoadError';
  }
}

/**
 * Read and schema-validate. Throws — never returns a partial or empty report —
 * matching `loadCatalogueIndex`'s discipline in `@mcpforge/registry`.
 */
export function loadProbeReport(root: string): ProbeReport {
  const filePath = probeReportPath(root);
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new ProbeReportLoadError(
      filePath,
      `file not readable (${err instanceof Error ? err.message : String(err)}). Run \`forge probe\` first.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ProbeReportLoadError(
      filePath,
      `not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  try {
    return assertProbeReport(parsed);
  } catch (err) {
    throw new ProbeReportLoadError(filePath, err instanceof Error ? err.message : String(err));
  }
}

/**
 * The bridge into `core/gateway/scope`'s `ProbeStatusSource`.
 *
 * Deliberately a MAP, not a `ProbeStatusSource` implementation: W0-E2 already
 * ships `staticProbeStatuses(map)`, whose contract is exactly this map and
 * whose `null` for an absent tool is the fail-closed default. Returning the map
 * fills that seam without `core/probe` importing the gateway at run time and
 * without either package growing a second, parallel source implementation.
 *
 *   import { staticProbeStatuses } from '@mcpforge/gateway/scope';
 *   const probe = staticProbeStatuses(probeStatusMap(loadProbeReport(root)));
 */
export function probeStatusMap(report: ProbeReport): ReadonlyMap<string, ProbeStatus> {
  return new Map(report.tools.map((t) => [t.toolId, t.status]));
}
