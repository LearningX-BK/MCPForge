// MCPForge — fixtures for the `[2a]` boundary. W0-N2.
//
// **What this is not.** It is not a bypass and it cannot be used as one:
// every function here builds INPUTS (a registry, a keypair, a signed
// assertion) that the real `ConsumerAuthenticator` then has to accept or
// refuse on its own terms. There is no "authenticated consumer" constructor
// and no gate that returns `ok: true` without a verification actually having
// happened. A test that wants a session has to present a credential that
// really verifies, exactly as a client would (CLAUDE.md non-negotiable 1).
//
// It lives beside the code rather than under `tests/` for the same reason
// `../../identity/oidc/keycloak.testkit.ts` does: it is intimate with the
// module's own shapes.

import { createHash } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import type { ConsumerRecord, ConsumerRegistry, LoadedConsumer } from '../../consumer/index.js';
import { consumerRecordPath, effectiveStatus, isoToday } from '../../consumer/types.js';

export interface TestKeypair {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly publicJwk: { kty: 'OKP'; crv: 'Ed25519'; x: string };
}

export async function generateTestConsumerKeypair(kid = 'test-a'): Promise<TestKeypair> {
  const { privateKey, publicKey } = await generateKeyPair('Ed25519', { extractable: true });
  const jwk = await exportJWK(publicKey);
  return {
    kid,
    privateKey: privateKey as CryptoKey,
    publicJwk: { kty: 'OKP', crv: 'Ed25519', x: String(jwk.x) },
  };
}

export interface TestConsumerOptions {
  readonly id?: string;
  readonly status?: ConsumerRecord['status'];
  readonly expiresAt?: string;
  readonly method?: ConsumerRecord['credential']['method'];
  readonly publicKeys?: ConsumerRecord['credential']['publicKeys'];
  readonly boundIssuers?: readonly string[];
  readonly writeAllowed?: boolean;
  readonly maxSensitivity?: ConsumerRecord['authorizations']['maxSensitivity'];
}

/** A record shaped exactly like 02 §11.2's worked example. */
export function testConsumerRecord(options: TestConsumerOptions = {}): ConsumerRecord {
  const id = options.id ?? 'test-agent';
  return {
    apiVersion: 'mcpforge/v1',
    kind: 'Consumer',
    id,
    label: `Test consumer ${id}`,
    class: 'interactive-client',
    owner: 'LTM Oracle AI Practice',
    steward: 'test-steward',
    status: options.status ?? 'active',
    expiresAt: options.expiresAt ?? '2099-01-01',
    credential: {
      method: options.method ?? 'private-key-jwt',
      ref: `secretRef://consumer/${id}/client`,
      ...(options.publicKeys === undefined ? {} : { publicKeys: options.publicKeys }),
      boundIssuers: [...(options.boundIssuers ?? ['local'])],
      rotation: { intervalDays: 90, lastRotatedAt: '2026-08-27' },
    },
    authorizations: {
      bindingTypes: ['rest'],
      maxSensitivity: options.maxSensitivity ?? 'internal',
      writeAllowed: options.writeAllowed ?? false,
      roles: ['p2p'],
      packages: ['jde-fin'],
    },
    limits: { callsPerMinute: 60, writesPerDay: 20, concurrentSessions: 4 },
    attestation: { humanInTheLoop: true },
  };
}

export function loadedTestConsumer(record: ConsumerRecord): LoadedConsumer {
  return {
    record,
    file: consumerRecordPath(record.id),
    recordSha: createHash('sha256').update(JSON.stringify(record), 'utf8').digest('hex'),
    effectiveStatus: effectiveStatus(record, isoToday()),
  };
}

export function testRegistry(records: readonly ConsumerRecord[]): ConsumerRegistry {
  return { consumers: records.map(loadedTestConsumer), failures: [] };
}

export interface SignAssertionOptions {
  readonly consumerId: string;
  readonly audience: string;
  readonly keypair: TestKeypair;
  readonly jti?: string;
  readonly issuedAt?: number;
  readonly expiresAt?: number;
  readonly algorithm?: string;
  readonly issuer?: string;
  readonly subject?: string;
  readonly includeKid?: boolean;
}

/** What the `forge connect` shim mints (05 §A.4 step 4). */
export async function signTestAssertion(options: SignAssertionOptions): Promise<string> {
  const iat = options.issuedAt ?? Math.floor(Date.now() / 1000);
  const exp = options.expiresAt ?? iat + 60;
  return new SignJWT({})
    .setProtectedHeader({
      alg: options.algorithm ?? 'Ed25519',
      ...(options.includeKid === false ? {} : { kid: options.keypair.kid }),
    })
    .setIssuer(options.issuer ?? options.consumerId)
    .setSubject(options.subject ?? options.consumerId)
    .setAudience(options.audience)
    .setJti(options.jti ?? `jti-${Math.random().toString(36).slice(2)}`)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(options.keypair.privateKey);
}
