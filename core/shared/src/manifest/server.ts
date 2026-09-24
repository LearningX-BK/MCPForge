// MCPForge — `kind: Server` (a module server: `manifests/<app>/<module>/
// _servers/<id>.server.yaml`, 02 §1.4).
//
// UNDER-SPECIFIED, DELIBERATELY MINIMAL. 02 has no worked `kind: Server`
// example. Every field below is one 02 §4.1 states in prose about a module
// server — an independently versioned, independently releasable bundle with its
// own config namespace, credential scope, kill switch, version and release
// train, running in Mode A (in the gateway process, default) or Mode B
// (standalone). Nothing here is invented beyond that.
//
// The authoritative field list is a schema decision with blast radius, and it
// belongs to W0-B1 (`core/codegen/schema/**`) working from a worked example a
// human supplies. Raised as a needs_human by W0-A4 rather than guessed at.

import type { ManifestBase, SemVer } from './common.js';

/**
 * 02 §4.1. Mode A is the default; a bundle is PROMOTED to Mode B when any one
 * of the five promotion conditions holds. Promotion is cheap and reversible.
 */
export const SERVER_MODES = ['A', 'B'] as const;
export type ServerMode = (typeof SERVER_MODES)[number];

export interface ServerManifest extends ManifestBase<'Server'> {
  readonly label: string;
  readonly app: string;
  readonly module: string;
  /** Independently versioned — that is what makes it a deployable artefact. */
  readonly version: SemVer;
  readonly mode: ServerMode;
  /** The reason for Mode B, from 02 §4.1's five promotion conditions. */
  readonly promotionReason?: string;
  readonly owner: string;
  readonly steward: string;
}
