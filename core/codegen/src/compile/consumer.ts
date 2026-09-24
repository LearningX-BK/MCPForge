// MCPForge — [P5] Consumer compilation. W0-B8, 02 §11.2/§11.4.
//
// A Consumer record is "compiled like a role, approved like a role"
// (CLAUDE.md §3). Its compiled form is `generated/consumers/<id>.authorization.json`
// and it exists for the same governance reason a role scope does: widening
// what a piece of software may do must be a DIFF, not a silent runtime effect.
//
// SECRETS: the consumer's `credential` block is NOT compiled into the
// artefact. Its `ref` is only ever a `secretRef://` (rules/grants.ts enforces
// that), so copying it would not leak a value — but the compiled artefact is
// read by the portal, the CLI and the gateway, and the fewer places a
// credential reference is echoed, the smaller the surface for the mistake
// CLAUDE.md #8 forbids. The rotation *schedule* is not needed by any consumer
// of this artefact, so it is not compiled either.

import type { ProvenanceInfo } from '../emit/provenance.js';
import { provenanceJsonFields } from '../emit/provenance.js';
import type { ConsumerView } from './model.js';
import { compileGrants, grantIsExpired, type IsoDate } from './role.js';
import type { ApprovalRecordView } from './standing.js';

export interface CompiledConsumerAuthorization {
  readonly artefact: Record<string, unknown>;
}

/**
 * Compile one Consumer record.
 *
 * `effectiveStatus` is the fail-closed reduction the gateway's
 * `ConsumerAuthorized` predicate (W0-E2) needs: a registration whose
 * `expiresAt` has passed is `expired` regardless of what `status:` still
 * claims, because 02 §11.2 makes renewal a re-approval and not a no-op. It
 * can only ever narrow — nothing here can turn a `suspended` or `retired`
 * record back into an active one.
 */
export function compileConsumerAuthorization(
  consumer: ConsumerView,
  provenance: ProvenanceInfo,
  today: IsoDate,
  approvals: ReadonlyMap<string, ApprovalRecordView> = new Map(),
): CompiledConsumerAuthorization {
  const registrationExpired = grantIsExpired(consumer.expiresAt, today);
  const effectiveStatus =
    consumer.status === 'active' && registrationExpired ? 'expired' : consumer.status;

  const artefact: Record<string, unknown> = {
    consumerId: consumer.id,
    label: consumer.label,
    class: consumer.consumerClass,
    status: consumer.status,
    expiresAt: consumer.expiresAt,
    expired: registrationExpired,
    effectiveStatus,
    authorizations: {
      bindingTypes: [...consumer.bindingTypes].sort(),
      maxSensitivity: consumer.maxSensitivity,
      writeAllowed: consumer.writeAllowed,
      roles: [...consumer.roles].sort(),
      packages: [...consumer.packages].sort(),
    },
    limits: consumer.limits,
    attestation: {
      humanInTheLoop: consumer.humanInTheLoop,
      networkOrigins: [...consumer.networkOrigins].sort(),
    },
    bindingGrants: compileGrants(consumer.bindingGrants, today, approvals),
    ...provenanceJsonFields(provenance),
  };

  return { artefact };
}
