// MCPForge — reading W0-B8's compiled governance artefacts. W0-E2.
//
// The three artefacts scope resolution consumes are JSON files produced by
// `forge codegen`:
//
//   generated/roles/<id>.scope.json               (02 §4.3)
//   generated/packages/<id>.selection.json        (02 §6.1)
//   generated/consumers/<id>.authorization.json   ([P5] 02 §11.2)
//
// They are a runtime boundary, so they are parsed with zod (CLAUDE.md §5) and
// never trusted structurally. A malformed grant artefact must fail loudly at
// load rather than silently resolve to a permissive shape — an artefact whose
// `toolIds` failed to parse and defaulted to `[]` would be a *narrowing*
// accident, but one whose `writeAllowed` defaulted to `true` would be a
// widening one, and the only way to be sure of neither is to refuse the file.
//
// These parsers read ALREADY-PARSED JSON. This module performs no file I/O:
// which files a deployment loads is the gateway's composition root's decision
// (a later task), not scope resolution's.

import { z } from 'zod';
import type { ConsumerAuthorizationView, DeploymentView, ToolId } from './types.js';

const toolIdList = z.array(z.string()).readonly();

/** The fields of `generated/roles/<id>.scope.json` that scope resolution reads. */
export const roleScopeArtefactSchema = z
  .object({
    roleId: z.string().min(1),
    toolIds: toolIdList,
  })
  .passthrough();

/** The fields of `generated/packages/<id>.selection.json` that scope resolution reads. */
export const packageSelectionArtefactSchema = z
  .object({
    packageId: z.string().min(1),
    toolIds: toolIdList,
  })
  .passthrough();

/** The fields of `generated/consumers/<id>.authorization.json` that scope resolution reads. */
export const consumerAuthorizationArtefactSchema = z
  .object({
    consumerId: z.string().min(1),
    effectiveStatus: z.string().min(1),
    authorizations: z.object({
      bindingTypes: z.array(z.string()).readonly(),
      maxSensitivity: z.string(),
      writeAllowed: z.boolean(),
      roles: z.array(z.string()).readonly(),
      packages: z.array(z.string()).readonly(),
    }),
    // The consumer's own attestation, compiled by W0-B8 from the reviewed git
    // record ([P5] 02 §11.2). `humanInTheLoop` is a STATED property of the
    // registration — `forge validate` requires it to be stated and never
    // merely absent — so it is required here too: a consumer artefact that
    // has lost it is refused rather than read as `false`, because "no human in
    // the loop" is a claim an audit row asserts and must not be a parse
    // default in either direction.
    attestation: z
      .object({
        humanInTheLoop: z.boolean(),
      })
      .passthrough(),
  })
  .passthrough();

/** roleId → compiled tool-id set, from a list of parsed role-scope artefacts. */
export function roleScopesFromArtefacts(
  artefacts: readonly unknown[],
): ReadonlyMap<string, ReadonlySet<ToolId>> {
  const out = new Map<string, ReadonlySet<ToolId>>();
  for (const raw of artefacts) {
    const parsed = roleScopeArtefactSchema.parse(raw);
    out.set(parsed.roleId, new Set(parsed.toolIds));
  }
  return out;
}

/** packageId → compiled selection, from a list of parsed package artefacts. */
export function packageSelectionsFromArtefacts(
  artefacts: readonly unknown[],
): ReadonlyMap<string, ReadonlySet<ToolId>> {
  const out = new Map<string, ReadonlySet<ToolId>>();
  for (const raw of artefacts) {
    const parsed = packageSelectionArtefactSchema.parse(raw);
    out.set(parsed.packageId, new Set(parsed.toolIds));
  }
  return out;
}

/**
 * The deployment's own view: its id and the packages selected into it. The
 * package ids are the deployment's config (02 §6.2, the overlay), not something
 * derivable from the compiled artefacts, so they are passed in.
 */
export function deploymentView(
  deploymentId: string,
  packageIds: readonly string[],
): DeploymentView {
  return { deploymentId, packageIds: [...packageIds] };
}

/** A `ConsumerAuthorizationView` from one parsed consumer-authorization artefact. */
export function consumerAuthorizationFromArtefact(raw: unknown): ConsumerAuthorizationView {
  const parsed = consumerAuthorizationArtefactSchema.parse(raw);
  return {
    consumerId: parsed.consumerId,
    effectiveStatus: parsed.effectiveStatus,
    authorizations: {
      bindingTypes: [...parsed.authorizations.bindingTypes],
      maxSensitivity: parsed.authorizations.maxSensitivity,
      writeAllowed: parsed.authorizations.writeAllowed,
      roles: [...parsed.authorizations.roles],
      packages: [...parsed.authorizations.packages],
    },
    attestation: { humanInTheLoop: parsed.attestation.humanInTheLoop },
  };
}
