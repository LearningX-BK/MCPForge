// MCPForge — "every tool in the catalogue", read from the catalogue index.
// 02 §4.5, 02 §5.4.1. W0-H4.
//
// The probe enumerates W0-G1's `generated/index/catalogue-index.json` rather
// than re-deriving the deployed tool set from `manifests/**`. That matters for
// a reason beyond tidiness: if the probe walked the manifests and the gateway
// walked the index, the two could disagree about what is deployed, and the
// tool the probe never reported would be the one the gateway never disabled.
// One artefact, one enumeration.
//
// The index does not carry `binding.ref`, `refVersion` or the owning team — it
// carries filters and a lexical document (02 §5.4.1). Those three come from the
// caller (`forge probe`, from the manifests it already reads). Absent values
// are NOT defaulted into something plausible: a tool with no owning team gets
// the explicit `UNASSIGNED` marker the runner writes, so the enablement backlog
// shows an unowned tool as unowned instead of silently attributing it.

import type { CatalogueIndex } from '@mcpforge/registry/index';
import { BINDING_TYPES, type BindingType } from '@mcpforge/shared/manifest';
import type { ProbeToolInput } from './run/runner.js';
import type { CompiledBindingGrant } from './reconcile/binding-grants.js';

/** The per-tool facts the index cannot supply, keyed by tool id. */
export interface ProbeToolDetail {
  readonly ref: string;
  readonly refVersion: string | null;
  readonly owningTeam: string;
  readonly bindingGrants?: readonly CompiledBindingGrant[];
  /** W0-H5. `binding.identity.onServiceAccount`, manifest-derived. */
  readonly onNonCarriage?: string | null;
  /** W0-H5. The designated probe test user, echoed into the report. */
  readonly testIdentity?: string | null;
}

export class UnknownBindingType extends Error {
  constructor(toolId: string, value: string) {
    super(
      `Catalogue entry "${toolId}" declares binding type "${value}", which is not one of ${BINDING_TYPES.join(', ')}. ` +
        `The probe refuses to guess a binding type: a tool whose binding is unrecognised cannot be given a status honestly.`,
    );
    this.name = 'UnknownBindingType';
  }
}

function asBindingType(toolId: string, value: string): BindingType {
  if ((BINDING_TYPES as readonly string[]).includes(value)) return value as BindingType;
  throw new UnknownBindingType(toolId, value);
}

/**
 * Project the catalogue index into the runner's input. Every entry produces
 * exactly one `ProbeToolInput` — there is no filter here, by design.
 */
export function probeInputsFromCatalogue(
  index: CatalogueIndex,
  details: ReadonlyMap<string, ProbeToolDetail>,
): readonly ProbeToolInput[] {
  return index.tools.map((entry) => {
    const detail = details.get(entry.id);
    return {
      toolId: entry.id,
      bindingType: asBindingType(entry.id, entry.filters.bindingType),
      write: entry.filters.write,
      ref: detail?.ref ?? '',
      refVersion: detail?.refVersion ?? null,
      owningTeam: detail?.owningTeam ?? '',
      // W0-H5. `sensitivity` DOES come from the index (02 §5.4.1's filters), so
      // it is projected here rather than asked of the caller. The other two are
      // manifest-only facts, like `ref` and `owningTeam`, and are absent rather
      // than defaulted — absent means `block`, the strict direction.
      sensitivity: entry.filters.sensitivity,
      onNonCarriage: detail?.onNonCarriage ?? null,
      testIdentity: detail?.testIdentity ?? null,
      ...(detail?.bindingGrants ? { bindingGrants: detail.bindingGrants } : {}),
    };
  });
}
