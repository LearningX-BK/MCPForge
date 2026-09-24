// MCPForge — artefact 6/6: `generated/cards/<id>.json`, the ≤60-token
// discovery card (02 §5.3(a)). What `forge.find` returns, what the
// disabled-tool path returns, what the portal's compact list renders.

import type { ProvenanceInfo } from '../emit/provenance.js';
import { provenanceJsonFields } from '../emit/provenance.js';
import type { ToolView } from './manifest-view.js';

/**
 * `status` (02 §5.1: "Probe + kill state — What actually works right now —
 * probe-report.json + runtime_flags — Who sets it: The system") is not
 * something codegen can know: no probe has run against a real instance at
 * codegen time. JUDGMENT CALL, documented rather than guessed (mirrors the
 * reasoning behind CLAUDE.md non-negotiable #2 — only the probe may assert a
 * tool works): the generated card defaults `status` to `"unresolved"`, never
 * `"resolved"`, until `forge probe` writes the real value into the catalogue
 * index/runtime flags that the live `forge.find` path actually serves this
 * field from. 02 §5.3's own worked example shows `"resolved"` because it is
 * illustrating a *live* card, not a freshly generated one.
 */
export const DEFAULT_STATUS = 'unresolved';

/** Build the card object. Not yet serialized/formatted/measured. */
export function buildDiscoveryCard(
  tool: ToolView,
  provenance: ProvenanceInfo,
): Record<string, unknown> {
  return {
    id: tool.id,
    purpose: tool.purpose,
    verb: tool.verb,
    entity: tool.entity,
    write: tool.write,
    binding: tool.bindingType,
    sensitivity: tool.sensitivity,
    roles: tool.coreForRoles,
    status: DEFAULT_STATUS,
    ...provenanceJsonFields(provenance),
  };
}

/**
 * The token-measurable subset — provenance's `//1`/`//2` pseudo-comment keys
 * are a codegen bookkeeping device, not part of what `forge.find` actually
 * returns over MCP, so they are excluded from the ≤60-token measurement
 * (measuring them would penalize the card for its own provenance, which no
 * wire response ever carries).
 */
export function cardWireShape(card: Record<string, unknown>): Record<string, unknown> {
  const wire = { ...card };
  delete wire['//1'];
  delete wire['//2'];
  return wire;
}
