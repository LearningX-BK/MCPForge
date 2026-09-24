// MCPForge — Package compilation. W0-B8, 02 §6.1.
//
// "A package is a SELECTION, not a build." The compiled artefact
// `generated/packages/<id>.selection.json` therefore contains only what the
// package file already selected, expanded to explicit ids: the server list, the
// role list, and the union of those roles' compiled tool-id lists. No
// templating, no substitution, no per-customer transformation — 02 §6.2's
// invariant is that the packaging step performs selection and nothing else.
//
// The union is compiled here for the same reason the role scope is: adding a
// tool that a selected role's globs admit widens the slice, and that must be
// visible as a diff in this file rather than only in the role's.

import type { ProvenanceInfo } from '../emit/provenance.js';
import { provenanceJsonFields } from '../emit/provenance.js';
import type { PackageView } from './model.js';

export interface CompiledPackageSelection {
  readonly toolIds: readonly string[];
  readonly artefact: Record<string, unknown>;
}

export function compilePackageSelection(
  pkg: PackageView,
  /** roleId -> that role's compiled, explicit tool-id list. */
  roleScopes: ReadonlyMap<string, readonly string[]>,
  provenance: ProvenanceInfo,
): CompiledPackageSelection {
  const union = new Set<string>();
  const unresolved: string[] = [];
  for (const roleId of [...pkg.roles].sort()) {
    const scope = roleScopes.get(roleId);
    if (!scope) {
      // A package naming a role with no compiled scope contributes NOTHING.
      // `forge validate`'s ref.package-role-not-found (W0-B2) is what reports
      // it; compilation must not invent a selection to paper over it.
      unresolved.push(roleId);
      continue;
    }
    for (const id of scope) union.add(id);
  }
  const toolIds = [...union].sort();

  const artefact: Record<string, unknown> = {
    packageId: pkg.id,
    label: pkg.label,
    portal: pkg.portal,
    servers: [...pkg.servers].sort(),
    roles: [...pkg.roles].sort(),
    unresolvedRoles: unresolved.sort(),
    toolIds,
    ...provenanceJsonFields(provenance),
  };

  return { toolIds, artefact };
}
