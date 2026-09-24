// MCPForge — the secrets seam's SERVER-ONLY surface. `./index.ts` is safe to
// reach from a portal `'use client'` component; this file adds the pieces
// that touch `node:fs`, `node:crypto`, `node:child_process` or
// `node:process` directly — the OS keychain backends, the encrypted-file
// store, dependent scanning and revocation. Server code (the `forge` CLI,
// gateway server-side code, portal Route Handlers / Server Actions / Server
// Components) imports from `@mcpforge/gateway/secrets/server`.

export * from './index.js';

export { CI_KEY_ENV_VAR, envVarKey, osKeychainBackend, KeychainError } from './keychain.js';
export type { KeychainBackend } from './keychain.js';

export { EncryptedFileStore, SECRETS_FILE, SEALING_KEY_ITEM } from './encrypted-file.js';
export type { EncryptedFileStoreOptions } from './encrypted-file.js';

export { KEYCHAIN_INDEX_FILE, OsKeychainStore, keychainItemFor } from './os-keychain.js';
export type { OsKeychainStoreOptions } from './os-keychain.js';

export { findSecretDependents } from './dependents.js';
export type { DependentScanFailure, SecretDependent, SecretDependentScan } from './dependents.js';

export { revokeSecret, SecretRevocationError } from './revocation.js';
export type { RevokeSecretInput, RevokeSecretResult, RevokedDependent } from './revocation.js';
