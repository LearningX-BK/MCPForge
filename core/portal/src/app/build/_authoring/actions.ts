'use server';
// MCPForge — the portal's model-assisted authoring actions. Server-only.
// W0-Q9, moved behind the gateway by W0-Q9b (D7 of
// docs/build-plan/w0-q8-assisted-authoring.md).
//
// Thin relays: each one asks the gateway's `/api/v1/authoring/*` as the
// signed-in viewer, through the portal's registered consumer (./relay.ts). The
// portal opens no secret store and imports no model adapter. These actions take
// no transport options from the browser: only the payload crosses.

import {
  relayAccept,
  relayPreview,
  relayStatus,
  relaySuggest,
  type AcceptPayload,
  type ActionFailure,
  type AuthoringStatus,
  type Provenance,
  type SuggestPayload,
} from './relay';

export type { AcceptPayload, ActionFailure, AuthoringStatus, Provenance, SuggestPayload } from './relay';

/** Whether to show any authoring affordance at all. Absent, not broken, when it is off. */
export async function authoringStatus(): Promise<AuthoringStatus> {
  return relayStatus();
}

/** §4 "show before send": exactly what the gateway would send. Nothing is sent. */
export async function authoringPreview(
  payload: SuggestPayload,
): Promise<{ ok: true; provider: string; system: string; user: string } | ActionFailure> {
  return relayPreview(payload);
}

export async function authoringSuggest(
  payload: SuggestPayload,
): Promise<{ ok: true; text: string; provenance: Provenance; suggestionId: string } | ActionFailure> {
  return relaySuggest(payload);
}

/** A person accepts ONE field. The acceptor is the gateway's: it is never sent. */
export async function authoringAccept(
  payload: AcceptPayload,
): Promise<{ ok: true; yaml: string; provenanceYaml: string; provenancePath: string } | ActionFailure> {
  return relayAccept(payload);
}
