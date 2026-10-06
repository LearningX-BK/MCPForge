// MCPForge — W0-Q9: provenance for every ACCEPTED model-drafted field. Note §5
// step 7. It rides the change proposal as a sidecar at
// `provenance/<toolId>.authoring.yaml` (no manifest schema change, and the path
// is outside the trees codegen and `forge validate` read), so a reviewer sees in
// the diff which fields a model drafted and who accepted each one.
//
// Records the provider, model, request id and the acceptor. Never the prompt,
// never the key, never the response beyond what already sits in the manifest.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type { FieldTarget, Provenance } from './types.js';

export interface AcceptedField extends Provenance {
  readonly field: string;
  readonly inputName?: string;
  /** `Principal.subject` of the human who accepted this field. Never defaulted. */
  readonly acceptedBy: string;
  readonly acceptedAt: string;
}

export const provenancePath = (toolId: string): string => `provenance/${toolId}.authoring.yaml`;

export function recordAcceptance(
  existing: string | undefined,
  toolId: string,
  target: FieldTarget,
  provenance: Provenance,
  acceptedBy: string,
  acceptedAt: string,
): string {
  const prior = existing === undefined ? undefined : (parseYaml(existing) as { fields?: AcceptedField[] } | null);
  const key = (f: { field: string; inputName?: string | undefined }): string => `${f.field}#${f.inputName ?? ''}`;
  const entry: AcceptedField = {
    field: target.field,
    ...(target.inputName === undefined ? {} : { inputName: target.inputName }),
    provider: provenance.provider,
    model: provenance.model,
    requestId: provenance.requestId,
    acceptedBy,
    acceptedAt,
  };
  // Re-accepting a field replaces its entry: the record states who accepted what is there NOW.
  const fields = [...(prior?.fields ?? []).filter((f) => key(f) !== key(entry)), entry];
  return stringifyYaml({ apiVersion: 'mcpforge/v1', kind: 'AuthoringProvenance', toolId, fields }, { lineWidth: 0 });
}
