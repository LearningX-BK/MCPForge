// MCPForge — capturing what `[2a]` established, for the audit trail. W0-N10,
// 02 §11.3.
//
// This module has exactly one job and one input type, and both are the point.
//
// **The input is a `ConsumerAuthSuccess`.** Not a consumer id, not a string,
// not a `LoadedConsumer` a caller found for itself — the discriminated success
// branch that `ConsumerAuthenticator.authenticate` returns and that cannot be
// constructed from a refusal. Provenance is therefore unobtainable without an
// authentication that succeeded, which is what makes "authenticated or absent"
// (02 §11.3) structural here rather than a convention. There is no overload
// taking a name, and none may be added: the moment a caller can hand this
// module a string, `consumption_edge` can carry a self-declared agent.
//
// **The sha is captured, never recomputed.** `LoadedConsumer.recordSha` is the
// sha256 of the exact bytes of `consumers/<id>.consumer.yaml` as the registry
// read them (`../../consumer/registry.ts`). Copying that VALUE here — once, at
// session establishment — is what makes the audit row's `consumer_record_sha`
// the version in force AT THAT CALL. Re-reading the record later, at write
// time, would silently answer a different question: what the registration says
// now. A row that reported today's authorizations for last Tuesday's call
// would be worse than a row with no sha at all, because it would look
// authoritative.

import type { ConsumerSessionProvenance } from '../../scope/types.js';
import type { ConsumerAuthSuccess } from './authenticate.js';

/** 64 lowercase hex — sha256, as `../../consumer/registry.ts` produces it. */
const RECORD_SHA_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Freeze one authenticated consumer's provenance for the life of its session.
 *
 * `consumerSessionId` is the transport's own identifier for the session this
 * consumer holds (the `Mcp-Session-Id`). It is a correlation handle, not an
 * identity: nothing downstream may authorize on it.
 */
export function consumerSessionProvenance(
  auth: ConsumerAuthSuccess,
  consumerSessionId: string,
): ConsumerSessionProvenance {
  const { record, recordSha } = auth.consumer;

  // Fail loudly rather than write a placeholder. Both of these are invariants
  // of `loadConsumerRegistry`, so a violation means the success branch was
  // synthesised rather than returned by `authenticate` — precisely the case
  // where a silent default would put an unverified identity into the trail.
  if (record.id.trim().length === 0) {
    throw new Error(
      'consumerSessionProvenance: the authenticated consumer carries no id. The audit trail records the authenticated consumer or nothing (02 §11.3).',
    );
  }
  if (!RECORD_SHA_PATTERN.test(recordSha)) {
    throw new Error(
      `consumerSessionProvenance: consumer "${record.id}" has no sha256 record hash (got "${recordSha}"). \`consumer_record_sha\` pins which version of the authorizations was in force for a call and may not be defaulted, blanked or recomputed later.`,
    );
  }

  return Object.freeze({
    consumerId: record.id,
    recordSha,
    authMethod: auth.authMethod,
    consumerSessionId,
  });
}
