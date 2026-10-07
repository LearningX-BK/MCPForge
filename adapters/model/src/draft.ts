// MCPForge — W0-Q9b: the two definitions-root reads every authoring surface
// shares. Lifted here from `forge suggest` (and the portal's former in-process
// actions) so the CLI and the gateway's authoring endpoints read the overlay
// and the sibling tools in exactly one way.
//
// Both read the DEFINITIONS root (manifests/, overlays/), never the install
// root: the overlay is config in git, and nothing here opens a secret store.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifestFiles } from '@mcpforge/codegen/validate';

import { UNCONFIGURED, parseAuthoringConfig, type AuthoringConfig } from './config.js';
import type { SiblingTool } from './payload.js';

/** `overlays/<deployment>/authoring.yaml`, relative to the definitions root. */
export function authoringOverlayPath(definitionsRoot: string, deployment: string): string {
  return join(definitionsRoot, 'overlays', deployment, 'authoring.yaml');
}

/**
 * The deployment's authoring overlay. An absent file is the feature-absent
 * config (`UNCONFIGURED`), never an error. A file that does not parse is a
 * failure with a `next`; each surface decides what that means (the CLI prints
 * it, the gateway treats the feature as not configured: absent, never half-on).
 */
export function loadAuthoringConfig(
  definitionsRoot: string,
  deployment: string,
): { ok: true; config: AuthoringConfig } | { ok: false; message: string; next: string } {
  const file = authoringOverlayPath(definitionsRoot, deployment);
  if (!existsSync(file)) return { ok: true, config: UNCONFIGURED };
  return parseAuthoringConfig(readFileSync(file, 'utf8'));
}

/**
 * The other tools sharing the draft's `{app}.{module}.{entity}`, with their
 * purpose (needed for `disambiguation`, note §4). Read from the definitions
 * root's manifests; the draft's own id is excluded.
 */
export function siblingsOf(
  definitionsRoot: string,
  doc: Readonly<Record<string, unknown>>,
): SiblingTool[] {
  const key = `${String(doc['app'])}.${String(doc['module'])}.${String(doc['entity'])}`;
  const out: SiblingTool[] = [];
  for (const m of loadManifestFiles(definitionsRoot)) {
    const d = m.doc as Record<string, unknown> | null | undefined;
    if (d?.['kind'] !== 'Tool' || typeof d['id'] !== 'string' || d['id'] === doc['id']) continue;
    if (`${String(d['app'])}.${String(d['module'])}.${String(d['entity'])}` === key) {
      out.push({ id: d['id'], purpose: typeof d['purpose'] === 'string' ? d['purpose'] : '' });
    }
  }
  return out;
}
