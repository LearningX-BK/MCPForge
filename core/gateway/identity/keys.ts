// MCPForge — the gateway's own signing keys, resolved from the SecretStore.
// W0-P11, 02 §11.5, CLAUDE.md non-negotiable 8.
//
// OWNER DECISION, 25 Sep 2026: the launched gateway resolves its three signing
// keys HERE, inside `core/gateway/identity/**`, one of the two trees allowed to
// call `SecretStore.get()`. Nothing else in the gateway reads a secret value,
// and no value leaves this module: callers receive keyrings (`KeyObject` /
// `Buffer` holders with non-secret `kid` labels), never a string.
//
//   secretRef://gateway/local-issuer/jwt-signing   verifies (and, for the local
//                                                  issuer, signs) human tokens
//   secretRef://gateway/confirm-token/hmac         signs confirm tokens (6g)
//   secretRef://gateway/execution-grant/hmac       signs execution grants (W0-P9);
//                                                  never the confirm key
//
// FIRST START. These are the gateway's OWN keys, not credentials to anything
// outside it, and `rotate()` cannot create a first version. So a missing
// gateway key is minted here (32 random bytes, the store's own format) and
// stored; it is never defaulted, derived or shared. A key that exists but
// cannot be read is a startup refusal. Nothing here touches any other ref:
// binding credentials (`secretRef://binding/...`) are the operator's to seed.
//
// ROTATION. Only the store's CURRENT version is loaded. The dual-key overlap
// window (`../secrets/rotation.ts`) needs the retired version too, and the
// store does not yet expose one; until it does, a rotation invalidates tokens
// signed with the previous key at the next restart. Flagged in W0-P11's report.

import { randomBytes } from 'node:crypto';
import { secretRef, SecretStoreError, type SecretRef, type SecretStore } from '../secrets/index.js';
import type { ConfirmKeyring } from '../policy/confirm/token.js';
import { localSigningKeyFrom, type LocalSigningKey } from './jwt.js';

export const GATEWAY_JWT_SIGNING_REF: SecretRef = secretRef(
  'gateway',
  'local-issuer',
  'jwt-signing',
);
export const GATEWAY_CONFIRM_HMAC_REF: SecretRef = secretRef('gateway', 'confirm-token', 'hmac');
export const GATEWAY_EXECUTION_GRANT_HMAC_REF: SecretRef = secretRef(
  'gateway',
  'execution-grant',
  'hmac',
);

export interface GatewayKeys {
  readonly jwtSigning: LocalSigningKey;
  readonly confirm: ConfirmKeyring;
  /** Same shape as the confirm keyring; a different key (W0-P9). */
  readonly executionGrant: ConfirmKeyring;
  /** Refs minted by THIS start because they did not exist. Refs only. */
  readonly minted: readonly string[];
}

/** Thrown when a gateway key exists but cannot be resolved. */
export class GatewayKeysUnavailable extends Error {
  constructor(ref: string, cause: string) {
    super(
      `The gateway cannot resolve ${ref}: ${cause}. Run "forge secrets status" to inspect it; the gateway does not start without its own signing keys.`,
    );
    this.name = 'GatewayKeysUnavailable';
  }
}

async function material(
  store: SecretStore,
  ref: SecretRef,
  minted: string[],
): Promise<{ readonly keyId: string; readonly bytes: Buffer }> {
  let exists = true;
  try {
    await store.metadata(ref);
  } catch (error) {
    if (!(error instanceof SecretStoreError)) throw error;
    exists = false;
  }
  if (!exists) {
    await store.put(ref, randomBytes(32).toString('base64url'));
    minted.push(ref.uri);
  }
  try {
    const meta = await store.metadata(ref);
    const value = await store.get(ref);
    const bytes = Buffer.from(value.revealSecretValue(), 'base64url');
    if (bytes.length < 32) throw new Error('the stored key is shorter than 32 bytes');
    // The kid is the ref's purpose and version: non-secret, and distinct per version.
    return { keyId: `${ref.subject}-v${meta.version}`, bytes };
  } catch (error) {
    throw new GatewayKeysUnavailable(
      ref.uri,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Resolve (minting on first start) the gateway's three signing keys. */
export async function resolveGatewayKeys(store: SecretStore): Promise<GatewayKeys> {
  const minted: string[] = [];
  const jwt = await material(store, GATEWAY_JWT_SIGNING_REF, minted);
  const confirm = await material(store, GATEWAY_CONFIRM_HMAC_REF, minted);
  const grant = await material(store, GATEWAY_EXECUTION_GRANT_HMAC_REF, minted);

  const confirmKey = { keyId: confirm.keyId, key: confirm.bytes };
  const grantKey = { keyId: grant.keyId, key: grant.bytes };
  return {
    jwtSigning: localSigningKeyFrom(jwt.keyId, jwt.bytes),
    confirm: { active: confirmKey, accepted: [confirmKey] },
    executionGrant: { active: grantKey, accepted: [grantKey] },
    minted: Object.freeze(minted),
  };
}
