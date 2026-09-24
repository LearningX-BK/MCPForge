// MCPForge — `OciVaultStore` IS NOT IMPLEMENTED. W0-N5, 02 §11.5 / 05 §4.3.1.
//
// This file exists so that the absence is a NAMED, LOCATABLE Wave 1 task rather
// than a silence someone discovers at the Wave 1 boundary. W0-N5's done
// criterion is explicit that `OciVaultStore` must not be "a stub that silently
// returns nothing" — so there is no class here that implements `SecretStore`,
// no object that satisfies the interface, and nothing importable that could be
// wired into a store factory by mistake and then quietly resolve every
// credential to `undefined`.
//
// WHY IT IS NOT BUILT, which is a settled decision and not an oversight:
// building it would make an OCI service a Wave 0 prerequisite, contradicting
// 02 §10.1 item 2 and CLAUDE.md §3.1's local-first rule ("No cloud account, no
// OCI service and no managed database may become a prerequisite"). OCI is the
// eventual production target, not a Wave 0 dependency.
//
// WHY THE GAP IS SMALL, which is the point of doing the seam first: the
// CONTRACT SUITE is written in Wave 0 (`secrets.contract.test.ts`) and is
// implementation-agnostic. The OCI implementation is the only missing piece,
// and it arrives by adding one leg to that suite — exactly the discipline
// `W0-C5` applies to the Postgres dialect and `W0-D3` to the OIDC provider.
// Two precedents, same pattern.

import { SecretStoreError } from './types.js';

/**
 * The Wave 1 task this file stands in for. Referenced by `forge secrets status`
 * and by the environments screen so the production gap is visible in the
 * product, not only in a comment.
 */
export const OCI_VAULT_STORE_WAVE_1_TASK = {
  id: 'W1-SECRETS-OCI',
  title: 'OciVaultStore — the production SecretStore implementation',
  wave: 1,
  reason:
    'Not built in Wave 0 because it would make an OCI service a Wave 0 prerequisite (02 §10.1 item 2, CLAUDE.md §3.1).',
  acceptance:
    'Adds one leg to core/gateway/secrets/secrets.contract.test.ts and passes the existing suite unchanged. If the suite needs a special case to accommodate OCI, that special case is the news — the seam leaks and the fix is the implementation, not the suite.',
  blocks:
    'Any staging or prod deployment. Wave 0 environment classes local and probe are unaffected.',
} as const;

/**
 * Fails loudly and specifically. Present ONLY so that a configuration naming
 * `oci-vault` gets a precise, actionable refusal at startup instead of an
 * "unknown store kind" or, far worse, a silent fallback to a local store —
 * which would be a service-account fallback for the vault itself (CLAUDE.md #1).
 *
 * This is not an implementation and deliberately does not satisfy `SecretStore`.
 */
export function ociVaultStoreUnavailable(): never {
  throw new SecretStoreError(
    'OciVaultStore is not implemented in Wave 0.',
    `Use EncryptedFileStore (the Wave 0 default) or OsKeychainStore for local and probe environments. OCI Vault support is tracked as ${OCI_VAULT_STORE_WAVE_1_TASK.id} — ${OCI_VAULT_STORE_WAVE_1_TASK.title}. Do not substitute a local store in a staging or prod environment.`,
  );
}
