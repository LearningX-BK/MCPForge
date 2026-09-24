// MCPForge — `kind: Package`. Field-for-field with 02 §6.1.
//
// A package is a SELECTION, not a build: a list of server ids and role ids that
// already exist in the base. No code, no manifests, no schemas, no
// transformation. No branch of MCPForge is ever created for a customer.

import type { ManifestBase } from './common.js';

/** Headless capability, not a commercial statement (02 §6.1). */
export const PORTAL_MODES = ['full', 'optional', 'none'] as const;
export type PortalMode = (typeof PORTAL_MODES)[number];

export interface PackageManifest extends ManifestBase<'Package'> {
  readonly label: string;
  readonly blurb: string;
  readonly servers: readonly string[];
  readonly roles: readonly string[];
  readonly portal: PortalMode;
}
