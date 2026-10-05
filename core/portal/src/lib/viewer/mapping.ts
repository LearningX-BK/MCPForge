// MCPForge — W0-P5b: the personas a viewer holds, from the git mapping.
//
// SERVER-ONLY (`node:fs`, via the gateway's reader). W0-P4 §9 decision 2:
// personas come from the `personas:` block of
// `overlays/<deployment>/mappings/groups-to-roles.yaml`, the same file that
// grants roles, so both are reviewed in one diff.
//
// The portal uses the gateway's ONE mapping reader rather than a second
// parser, so it can never disagree with the gateway about what the file says.
// That is a DEFINITIONAL read of git, which W0-P2 §7 keeps on git. The two
// symbols are allowlisted per symbol in `tools/ci/src/portal-http-boundary.ts`.
//
// **Fails closed.** A mapping the gateway itself would refuse to start on
// yields NO personas, so no gated portal action is offered. It never yields a
// default persona.

import path from 'node:path';

import {
  isSuperAdmin,
  type MappingMember,
  loadDeploymentGroupRoleMapping,
  personasForPrincipal,
} from '@mcpforge/gateway/identity/group-role-mapping';

import { resolveRepoRoot } from '../../app/build/_lib/repo-root';
import type { Persona } from './personas';

export function deploymentId(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const d = env['MCPFORGE_DEPLOYMENT'];
  return d !== undefined && d.length > 0 ? d : 'local';
}

export function heldPersonas(
  member: MappingMember,
  options: { readonly repoRoot?: string; readonly deployment?: string } = {},
): readonly Persona[] {
  try {
    const mapping = loadDeploymentGroupRoleMapping(
      path.join(options.repoRoot ?? resolveRepoRoot(), 'overlays'),
      options.deployment ?? deploymentId(),
    );
    return personasForPrincipal(mapping, member);
  } catch {
    return [];
  }
}

/**
 * W0-P33b — whether the member holds a `superAdmins:` group of its OWN provider in
 * this deployment's git mapping (W0-P31, keyed per provider by W0-P23). Fails closed: an unreadable mapping is
 * `false`. Decides who may MERGE a definitional change in the portal; the
 * groups come from the gateway-verified session, never from a component.
 */
export function holdsSuperAdmin(
  member: MappingMember,
  options: { readonly repoRoot?: string; readonly deployment?: string } = {},
): boolean {
  try {
    const mapping = loadDeploymentGroupRoleMapping(
      path.join(options.repoRoot ?? resolveRepoRoot(), 'overlays'),
      options.deployment ?? deploymentId(),
    );
    return isSuperAdmin(mapping, member);
  } catch {
    return false;
  }
}
