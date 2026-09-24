// MCPForge — the `SecretStore` seam. W0-N5, 02 §11.5 / 05 §4.3.
//
// The third pluggable seam, after `IdentityProvider` (02 §4.4) and `ChangeHost`
// (02 §10.1). Two Wave 0 implementations under one contract suite;
// `OciVaultStore` is a named Wave 1 task, see ./oci-vault.ts.

export {
  SECRET_REF_SCOPES,
  SECRET_STORE_KINDS,
  ROTATION_INTERVAL_DAYS,
  SecretRefError,
  SecretStoreError,
  SecretValue,
  isSecretRef,
  parseSecretRef,
  secretRef,
} from './types.js';
export type {
  SecretMetadata,
  SecretRef,
  SecretRefScope,
  SecretStore,
  SecretStoreKind,
} from './types.js';

// `./keychain.js`, `./encrypted-file.js`, `./os-keychain.js`, `./dependents.js`
// and `./revocation.js` are deliberately NOT re-exported here. Each touches
// `node:fs`, `node:crypto`, `node:child_process` or `node:process` directly,
// and this barrel is what portal `'use client'` code reaches through
// `@mcpforge/gateway/secrets` for client-safe pieces (`secretRef`,
// `rotationStatusFor`, …). Bundling them would drag Node builtins into the
// browser bundle and crash those routes — see `../store/index.ts` for the
// identical reasoning. Server code imports the full surface from
// `@mcpforge/gateway/secrets/server` (`./server.ts`).

export { OCI_VAULT_STORE_WAVE_1_TASK, ociVaultStoreUnavailable } from './oci-vault.js';

// W0-N6 — rotation status, the dual-key overlap window, and one-act revocation.
export { buildRotationReport, rotationStatusFor } from './status.js';
export type { SecretRotationState, SecretRotationStatus, SecretsRotationReport } from './status.js';

export {
  CONFIRM_HMAC_SECRET_REF,
  DualKeyRing,
  JWT_SIGNING_SECRET_REF,
  OVERLAP_MARGIN_SECONDS,
  SIGNING_KEY_ROTATION_DAYS,
  confirmKeyringAt,
  localSigningKeysAt,
  overlapWindowSeconds,
} from './rotation.js';
export type { KeyedMaterial, RetiredKey, RotateOptions } from './rotation.js';

// `findSecretDependents` (./dependents.js, node:fs) and `revokeSecret`
// (./revocation.js, which imports dependents.js) are server-only — see
// `./server.ts`.
