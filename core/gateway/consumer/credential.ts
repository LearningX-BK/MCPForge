// MCPForge — issuing a consumer's client credential. W0-N1, 02 §11.2 / §11.5.
//
// "forge consumer issue-credential <id> mints the credential into the local
// secret store and prints it exactly once. Refused when CI=true and refused
// when the environment class is staging or prod — there, registration goes
// through the portal and produces an approval record." (02 §11.2)
//
// CLAUDE.md #8, held to literally: the ONLY place a credential value exists
// outside the caller's terminal is the single string this module returns for
// that one print. It is never written to the consumer record, never to the
// change proposal, never to the approval record, never to a log line and
// never to any JSON envelope this CLI emits.
//
// PRINT-ONCE IS STRUCTURAL, NOT A PROMISE. What is persisted is a VERIFIER —
// a salted SHA-256 of the value — so the value is unrecoverable from disk by
// anyone, including this codebase. Re-running the command mints a NEW value
// and supersedes the old verifier; it cannot re-print the old one.
//
// THE SEAM, AND WHAT IS DEFERRED. 02 §11.5's `SecretStore` (`EncryptedFileStore`
// / `OsKeychainStore`, `secretRef://` addressing, rotation and revocation) is
// W0-N5 and does not exist yet. Rather than stand up a half-store here and
// have W0-N5 inherit it, this file defines the narrow port the issue path
// actually needs — `put one verifier for one secretRef` — with a Wave-0
// local-only implementation. W0-N5 replaces `LocalVerifierFile` with the real
// store; nothing above this port changes. Note the deliberate asymmetry: this
// stores a verifier rather than the value, so it is NOT a general secret
// store and must not be used as one.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { consumerCredentialRef, isoToday } from './types.js';

/** 02 §7.1's four classes. `staging` and `prod` refuse issuance. */
export type EnvironmentClass = 'local' | 'probe' | 'staging' | 'prod';
const ISSUANCE_REFUSED_ENVIRONMENTS: readonly EnvironmentClass[] = ['staging', 'prod'];

export interface CredentialVerifier {
  readonly secretRef: string;
  readonly consumerId: string;
  readonly algorithm: 'sha256';
  readonly salt: string;
  readonly verifier: string;
  readonly version: number;
  readonly issuedAt: string;
  readonly issuedBy: string;
}

/**
 * The one write this issue path needs. Implementations store the VERIFIER;
 * none of them can return the value, because none of them is given it.
 */
export interface ConsumerVerifierStore {
  put(entry: CredentialVerifier): void;
  find(secretRef: string): CredentialVerifier | undefined;
}

const LOCAL_VERIFIER_FILE = ['.mcpforge', 'consumer-credential-verifiers.json'];

/**
 * Wave 0, environment class `local` only — and issuance is refused everywhere
 * else anyway, so this store is never the production path. `.mcpforge/` is
 * gitignored, so nothing here crosses the git boundary (02 §11.5 rule 1).
 */
export class LocalVerifierFile implements ConsumerVerifierStore {
  readonly #path: string;

  constructor(repoRoot: string) {
    this.#path = join(repoRoot, ...LOCAL_VERIFIER_FILE);
  }

  get path(): string {
    return this.#path;
  }

  #read(): CredentialVerifier[] {
    if (!existsSync(this.#path)) return [];
    const parsed: unknown = JSON.parse(readFileSync(this.#path, 'utf8'));
    return Array.isArray(parsed) ? (parsed as CredentialVerifier[]) : [];
  }

  find(secretRef: string): CredentialVerifier | undefined {
    return this.#read()
      .filter((e) => e.secretRef === secretRef)
      .sort((a, b) => b.version - a.version)[0];
  }

  put(entry: CredentialVerifier): void {
    const all = this.#read().filter((e) => e.secretRef !== entry.secretRef);
    all.push(entry);
    all.sort((a, b) => a.secretRef.localeCompare(b.secretRef));
    mkdirSync(dirname(this.#path), { recursive: true });
    writeFileSync(this.#path, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
  }
}

function saltedHash(salt: string, value: string): string {
  return createHash('sha256').update(`${salt}:${value}`, 'utf8').digest('hex');
}

/** Constant-time check, for W0-N2's transport-boundary verification. */
export function verifyConsumerCredential(entry: CredentialVerifier, presented: string): boolean {
  const expected = Buffer.from(entry.verifier, 'hex');
  const actual = Buffer.from(saltedHash(entry.salt, presented), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export type IssuanceRefusalReason = 'ci' | 'environment-class';

export interface IssuanceRefusal {
  readonly reason: IssuanceRefusalReason;
  readonly message: string;
  readonly next: string;
}

/**
 * The two refusals, both from 02 §11.2, checked BEFORE any value is minted —
 * a refused issuance must never have generated a secret in the first place.
 */
export function refuseIssuance(
  environmentClass: EnvironmentClass,
  env: NodeJS.ProcessEnv = process.env,
): IssuanceRefusal | undefined {
  if (env['CI'] === 'true') {
    return {
      reason: 'ci',
      message: 'forge consumer issue-credential is refused when CI=true.',
      next: 'Mint the credential on a developer machine, or — for any shared environment — register the consumer through the portal, which produces the approval record. A CI job printing a client credential is a credential in a build log.',
    };
  }
  if (ISSUANCE_REFUSED_ENVIRONMENTS.includes(environmentClass)) {
    return {
      reason: 'environment-class',
      message: `forge consumer issue-credential is refused when the environment class is "${environmentClass}".`,
      next: 'Register the consumer through the portal in staging and prod: that path produces the approval record (02 §11.2). Use --env local for a developer machine.',
    };
  }
  return undefined;
}

export interface IssueCredentialInput {
  readonly consumerId: string;
  readonly environmentClass: EnvironmentClass;
  /** `Principal.subject` of whoever ran the command. Never defaulted. */
  readonly issuedBy: string;
  readonly store: ConsumerVerifierStore;
  readonly env?: NodeJS.ProcessEnv;
  readonly today?: string;
}

export interface IssuedCredential {
  readonly secretRef: string;
  readonly version: number;
  readonly issuedAt: string;
  /**
   * THE ONLY VALUE. The caller prints this exactly once and drops it; it is
   * not stored, not logged, not returned by any later call, and cannot be
   * recovered from the verifier that was persisted.
   */
  readonly value: string;
}

export function issueConsumerCredential(input: IssueCredentialInput): IssuedCredential {
  const refusal = refuseIssuance(input.environmentClass, input.env);
  if (refusal) {
    throw new Error(`${refusal.message} ${refusal.next}`);
  }
  const secretRef = consumerCredentialRef(input.consumerId);
  const previous = input.store.find(secretRef);
  const value = randomBytes(32).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const issuedAt = `${input.today ?? isoToday()}T00:00:00Z`;
  input.store.put({
    secretRef,
    consumerId: input.consumerId,
    algorithm: 'sha256',
    salt,
    verifier: saltedHash(salt, value),
    version: (previous?.version ?? 0) + 1,
    issuedAt,
    issuedBy: input.issuedBy,
  });
  return { secretRef, version: (previous?.version ?? 0) + 1, issuedAt, value };
}
