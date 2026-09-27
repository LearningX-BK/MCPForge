// MCPForge — W0-P24: the portal server's consumer credential.
//
// The portal is a registered consumer (`portal-local`) and presents that
// registration on every gateway call (CLAUDE.md non-negotiable 6: consumer AND
// human, never one without the other). W0-P4 §7 / §9 decision 5: it does so by
// `private-key-jwt`, not a client secret, because non-negotiable 8 allows
// `SecretStore.get()` only in `adapters/**` and `core/gateway/identity/**`.
// So the portal holds no secret store and no shared secret. It holds ONE
// Ed25519 private key, minted on this machine by
// `forge consumer issue-credential portal-local --method private-key-jwt
// --key-file .mcpforge/portal/portal-local.private.jwk.json` into the
// git-ignored `.mcpforge/`. The registry holds only the matching public key.
//
// SERVER-ONLY. Never import from a client component: the private key must not
// reach the browser, and neither may an assertion (it is single-use, but it
// is still a credential for its 60 seconds).
//
// The assertion is exactly what the gateway's `[2a]` gate checks (05 §A.4
// step 4): `iss` = `sub` = the consumer id, `aud` = the gateway, a fresh
// single-use `jti`, `exp` 60 s after `iat`, and a `kid` naming the record's key.

import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { SignJWT, importJWK, type CryptoKey } from 'jose';
import { z } from 'zod';
import { resolveRepoRoot } from '../../app/build/_lib/repo-root';

/** The portal's registration id (`consumers/portal-local.consumer.yaml`). */
export const PORTAL_CONSUMER_ID = 'portal-local';

/** Where `forge consumer issue-credential ... --key-file` puts the portal's key. */
export const PORTAL_CONSUMER_KEY_FILE = '.mcpforge/portal/portal-local.private.jwk.json';

/**
 * The request header the gateway reads the assertion from. Restated rather
 * than imported (the gateway's transport module is not a portal runtime
 * import, R8); `consumer-assertion.test.ts` pins it to the gateway's constant.
 */
export const CONSUMER_ASSERTION_HEADER = 'mcpforge-consumer-assertion';

/** The gateway's default audience (`core/gateway/launch.ts`), unless the environment names another. */
export const DEFAULT_GATEWAY_AUDIENCE = 'https://mcpforge.local/mcp';

/** 05 §A.4: `exp` ≤ 60 s. The gateway refuses anything longer. */
export const ASSERTION_LIFETIME_SECONDS = 60;

const keyFileSchema = z.object({
  consumerId: z.string().min(1),
  kid: z.string().min(1),
  alg: z.literal('EdDSA'),
  createdAt: z.string(),
  privateJwk: z.object({
    kty: z.literal('OKP'),
    crv: z.literal('Ed25519'),
    x: z.string().min(1),
    d: z.string().min(1),
  }),
});

export type ConsumerCredentialErrorCode = 'CONSUMER_KEY_MISSING' | 'CONSUMER_KEY_INVALID';

/** The portal cannot present its consumer credential. Carries an actionable `next`. */
export class ConsumerCredentialError extends Error {
  readonly code: ConsumerCredentialErrorCode;
  readonly next: string;

  constructor(code: ConsumerCredentialErrorCode, message: string, next: string) {
    super(message);
    this.name = 'ConsumerCredentialError';
    this.code = code;
    this.next = next;
  }
}

/** A loaded signing key. Only the key id is readable; the key itself stays opaque. */
export interface PortalConsumerKey {
  readonly consumerId: string;
  readonly kid: string;
  readonly privateKey: CryptoKey;
}

type Env = Readonly<Record<string, string | undefined>>;

export interface ConsumerKeyOptions {
  readonly repoRoot?: string;
  /** Absolute, or relative to the repo root. Default: `MCPFORGE_PORTAL_CONSUMER_KEY_FILE`, then {@link PORTAL_CONSUMER_KEY_FILE}. */
  readonly keyFile?: string;
  readonly env?: Env;
}

export function portalConsumerKeyPath(options: ConsumerKeyOptions = {}): string {
  const env = options.env ?? process.env;
  const configured =
    options.keyFile ?? env['MCPFORGE_PORTAL_CONSUMER_KEY_FILE'] ?? PORTAL_CONSUMER_KEY_FILE;
  return path.isAbsolute(configured)
    ? configured
    : path.join(options.repoRoot ?? resolveRepoRoot(), configured);
}

const ISSUE_NEXT = `Run "forge consumer issue-credential ${PORTAL_CONSUMER_ID} --method private-key-jwt --key-file ${PORTAL_CONSUMER_KEY_FILE} --by <your subject>", then have the owner approve and merge the staged proposal that carries the public key.`;

/** Cached by path and modification time, so a re-issued key is picked up without a restart. */
const cache = new Map<string, { mtimeMs: number; key: PortalConsumerKey }>();

export async function loadPortalConsumerKey(
  options: ConsumerKeyOptions = {},
): Promise<PortalConsumerKey> {
  const file = portalConsumerKeyPath(options);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    throw new ConsumerCredentialError(
      'CONSUMER_KEY_MISSING',
      `The portal has no consumer key at ${file}, so it cannot present its "${PORTAL_CONSUMER_ID}" registration to the gateway.`,
      ISSUE_NEXT,
    );
  }
  const cached = cache.get(file);
  if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached.key;

  let parsed: z.infer<typeof keyFileSchema>;
  try {
    parsed = keyFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    // The file's contents are a private key: never echo them into the error.
    throw new ConsumerCredentialError(
      'CONSUMER_KEY_INVALID',
      `The portal consumer key at ${file} is not a private-key-jwt key file.`,
      `Delete it and re-issue: ${ISSUE_NEXT}`,
    );
  }
  if (parsed.consumerId !== PORTAL_CONSUMER_ID) {
    throw new ConsumerCredentialError(
      'CONSUMER_KEY_INVALID',
      `The key at ${file} was issued to consumer "${parsed.consumerId}", not "${PORTAL_CONSUMER_ID}".`,
      `The portal signs only as ${PORTAL_CONSUMER_ID}. ${ISSUE_NEXT}`,
    );
  }
  const privateKey = (await importJWK(parsed.privateJwk, 'EdDSA')) as CryptoKey;
  const key: PortalConsumerKey = { consumerId: parsed.consumerId, kid: parsed.kid, privateKey };
  cache.set(file, { mtimeMs, key });
  return key;
}

export function gatewayAudience(env: Env = process.env): string {
  const configured = env['MCPFORGE_GATEWAY_AUDIENCE'];
  return configured !== undefined && configured.length > 0 ? configured : DEFAULT_GATEWAY_AUDIENCE;
}

export interface SignAssertionOptions {
  readonly audience: string;
  readonly now?: () => Date;
}

/** One single-use client assertion. Mint a new one per request; never cache or reuse it. */
export async function signConsumerAssertion(
  key: PortalConsumerKey,
  options: SignAssertionOptions,
): Promise<string> {
  const iat = Math.floor((options.now?.() ?? new Date()).getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid, typ: 'JWT' })
    .setIssuer(key.consumerId)
    .setSubject(key.consumerId)
    .setAudience(options.audience)
    .setJti(randomUUID())
    .setIssuedAt(iat)
    .setExpirationTime(iat + ASSERTION_LIFETIME_SECONDS)
    .sign(key.privateKey);
}

export interface ConsumerHeadersOptions extends ConsumerKeyOptions {
  readonly audience?: string;
  readonly now?: () => Date;
}

/**
 * The consumer half of a gateway request's headers. The human half (the
 * `Authorization: Bearer` access token) comes from the viewer session; the
 * caller sends both, because the gateway requires both (non-negotiable 6).
 */
export async function consumerAssertionHeaders(
  options: ConsumerHeadersOptions = {},
): Promise<Record<string, string>> {
  const key = await loadPortalConsumerKey(options);
  const assertion = await signConsumerAssertion(key, {
    audience: options.audience ?? gatewayAudience(options.env),
    ...(options.now ? { now: options.now } : {}),
  });
  return { [CONSUMER_ASSERTION_HEADER]: assertion };
}
