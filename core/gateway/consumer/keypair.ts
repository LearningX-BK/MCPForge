// MCPForge — issuing a `private-key-jwt` consumer credential. W0-P24, 05 §A.4.
//
// "An Ed25519 keypair is generated locally. The private key never leaves the
// consumer's machine. The public key goes into the consumer's git record."
// (05 §A.2 / §A.4 step 2)
//
// The split is the whole point, so it is structural here:
//
//  - `mintConsumerKeypair` returns the two halves as two different types. The
//    PUBLIC half is a `ConsumerPublicKey`, the exact `.strict()` shape the
//    record schema accepts, which has no `d` and so cannot carry a private key
//    into git (05 §A.5). The PRIVATE half is a `ConsumerPrivateKeyFile`, which
//    only `writeConsumerPrivateKeyFile` persists, and only under the
//    git-ignored `.mcpforge/`.
//  - The record change is a change PROPOSAL (lifecycle.ts), never a write to
//    `consumers/**` — the public key reaches the registry only through review.
//
// No `SecretStore` is involved on either side. The gateway never holds the
// private key at all (it verifies against `credential.publicKeys[]`), and the
// portal reads its own key from its own file (W0-P4 §7, decision 5), so no
// `SecretStore.get()` call is needed outside `adapters/**` and
// `core/gateway/identity/**` (CLAUDE.md non-negotiable 8).

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { isoToday, type ConsumerPublicKey } from './types.js';

/** The consumer's private key as the holder stores it. Never committed, never logged. */
export interface ConsumerPrivateKeyFile {
  readonly consumerId: string;
  readonly kid: string;
  /** The JWS `alg` the holder signs with. The gateway accepts `Ed25519` and `EdDSA`. */
  readonly alg: 'EdDSA';
  readonly createdAt: string;
  readonly privateJwk: {
    readonly kty: 'OKP';
    readonly crv: 'Ed25519';
    readonly x: string;
    readonly d: string;
  };
}

export interface MintedConsumerKeypair {
  /** Safe to commit, log and render. This is what the record carries. */
  readonly publicKey: ConsumerPublicKey;
  /** The holder's secret. Persist with `writeConsumerPrivateKeyFile` or print once. */
  readonly privateKey: ConsumerPrivateKeyFile;
}

export interface MintConsumerKeypairInput {
  readonly consumerId: string;
  readonly today?: string;
}

/**
 * One Ed25519 keypair. The `kid` is the issue date plus four random hex
 * characters, so two keys issued on the same day (a rotation overlap) never
 * collide and a reviewer can read a key's age off its id.
 */
export function mintConsumerKeypair(input: MintConsumerKeypairInput): MintedConsumerKeypair {
  const today = input.today ?? isoToday();
  const kid = `${today}-${randomBytes(2).toString('hex')}`;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  if (typeof pub.x !== 'string' || typeof priv.d !== 'string') {
    throw new Error('Ed25519 key export returned no x/d component.');
  }
  return {
    publicKey: { kid, kty: 'OKP', crv: 'Ed25519', x: pub.x, addedAt: today },
    privateKey: {
      consumerId: input.consumerId,
      kid,
      alg: 'EdDSA',
      createdAt: today,
      privateJwk: { kty: 'OKP', crv: 'Ed25519', x: pub.x, d: priv.d },
    },
  };
}

/** Where a private key file may live: under the git-ignored `.mcpforge/`, and nowhere else. */
export const PRIVATE_KEY_ROOT = '.mcpforge';

/** The portal's own key (W0-P4 §7): the portal server signs `portal-local`'s assertion with it. */
export const PORTAL_CONSUMER_KEY_FILE = '.mcpforge/portal/portal-local.private.jwk.json';

export class PrivateKeyFileRefusedError extends Error {
  readonly next: string;
  constructor(message: string, next: string) {
    super(message);
    this.name = 'PrivateKeyFileRefusedError';
    this.next = next;
  }
}

/**
 * Write the private key to `repoRoot/<relPath>`, owner-read-only. Refused
 * outside `.mcpforge/` (it would be one `git add .` from being committed) and
 * refused over an existing file: overwriting a working key would break the
 * holder before the new public key is approved. Rotation writes a new file
 * beside the old one, and the old one is deleted after the overlap.
 */
export function writeConsumerPrivateKeyFile(
  repoRoot: string,
  relPath: string,
  key: ConsumerPrivateKeyFile,
): string {
  const root = join(repoRoot, PRIVATE_KEY_ROOT);
  const abs = normalize(isAbsolute(relPath) ? relPath : join(repoRoot, relPath));
  const inside = relative(root, abs);
  if (inside === '' || inside.split(sep)[0] === '..' || isAbsolute(inside)) {
    throw new PrivateKeyFileRefusedError(
      `Refused to write a private key to ${JSON.stringify(relPath)}: it is outside ${PRIVATE_KEY_ROOT}/.`,
      `Pass --key-file under ${PRIVATE_KEY_ROOT}/ (git-ignored), e.g. ${PORTAL_CONSUMER_KEY_FILE}. A private key anywhere else is one \`git add\` from being committed (CLAUDE.md non-negotiable 8).`,
    );
  }
  if (existsSync(abs)) {
    throw new PrivateKeyFileRefusedError(
      `Refused to overwrite the existing private key at ${JSON.stringify(relPath)}.`,
      'The key there may still be the one the approved record verifies. Pass a new --key-file path for the new key, and delete the old file only once the proposal carrying the new public key is merged.',
    );
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(key, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  return abs;
}
