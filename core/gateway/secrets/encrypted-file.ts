// MCPForge — `EncryptedFileStore`, the Wave 0 default. W0-N5, 02 §11.5 / 05 §4.3.1.
//
// "An age/libsodium-sealed file at ./.mcpforge/secrets.age, alongside the
// runtime database and .gitignore'd with it, unlocked by a key held in the OS
// keychain, with an environment-variable key for CI only." (05 §4.3.1)
//
// WHY REAL age AND NOT A HAND-ROLLED AES ENVELOPE. The file is called
// `secrets.age`, so it had better be an age file — a file with that extension
// that only this codebase can open is a lie to whoever has to recover it at
// 3am. `age-encryption@0.3.1` is the reference TypeScript implementation and is
// pure JS over @noble/* — no native addon, no C toolchain, which is the same
// constraint that sent `W0-D2` to hash-wasm for Argon2id (CLAUDE.md §3.1). The
// output is decryptable by the stock `age` CLI with the same passphrase, so the
// escape hatch is a standard tool rather than this module.
//
// WHY scrypt-PASSPHRASE RATHER THAN AN X25519 RECIPIENT. The unlocking key is
// held in the OS keychain (or, in CI, an env var) — it is a passphrase-shaped
// thing, and age's scrypt recipient is exactly the passphrase mode. An X25519
// identity would mean storing a private key in the keychain instead, which is
// the same secret with an extra encoding step.
//
// WHAT IS IN THE FILE. One JSON document, sealed whole: every ref, every
// version, every value. Sealing the whole document rather than per-entry means
// the ref NAMES are inside the envelope too — the set of credentials a
// deployment holds is itself information, and a plaintext index of it beside a
// sealed blob gives that away for free.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Decrypter, Encrypter } from 'age-encryption';
import { randomBytes } from 'node:crypto';
import { ROTATION_INTERVAL_DAYS, SecretStoreError, SecretValue, parseSecretRef } from './types.js';
import type { SecretMetadata, SecretRef, SecretStore } from './types.js';
import { CI_KEY_ENV_VAR, envVarKey, osKeychainBackend } from './keychain.js';
import type { KeychainBackend } from './keychain.js';

export const SECRETS_FILE = ['.mcpforge', 'secrets.age'];

/** The keychain item holding the file-sealing passphrase. */
export const SEALING_KEY_ITEM = 'mcpforge:secrets-file-key';

/** age's scrypt work factor. 15 ≈ 0.1s — the file is opened per operation. */
const SCRYPT_WORK_FACTOR = 15;

interface StoredVersion {
  readonly version: number;
  readonly value: string;
  readonly createdAt: string;
  readonly rotatedAt?: string;
  readonly expiresAt?: string;
}

interface Vault {
  readonly apiVersion: 'mcpforge/v1';
  readonly entries: Record<string, StoredVersion[]>;
}

const EMPTY_VAULT: Vault = { apiVersion: 'mcpforge/v1', entries: {} };

function expiryFor(ref: SecretRef, from: Date): string {
  const days = ROTATION_INTERVAL_DAYS[ref.scope];
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

function toMetadata(ref: SecretRef, v: StoredVersion): SecretMetadata {
  // Field-by-field, deliberately. A spread of `v` would carry `value` into
  // something documented as safe to log — the contract suite scans for exactly
  // that, but the code should not need the test to be correct.
  return {
    ref: ref.uri,
    version: v.version,
    createdAt: v.createdAt,
    rotatedAt: v.rotatedAt,
    expiresAt: v.expiresAt,
  };
}

export interface EncryptedFileStoreOptions {
  /** Repository root. `.mcpforge/secrets.age` is resolved beneath it. */
  readonly repoRoot: string;
  /** Overridden in tests and by the CI env-var path. */
  readonly keychain?: KeychainBackend;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
}

export class EncryptedFileStore implements SecretStore {
  readonly kind = 'encrypted-file' as const;
  readonly #path: string;
  readonly #keychain: KeychainBackend;
  readonly #env: NodeJS.ProcessEnv;
  readonly #now: () => Date;
  #passphrase: string | undefined;

  constructor(options: EncryptedFileStoreOptions) {
    this.#path = join(options.repoRoot, ...SECRETS_FILE);
    this.#keychain = options.keychain ?? osKeychainBackend();
    this.#env = options.env ?? process.env;
    this.#now = options.now ?? (() => new Date());
  }

  get path(): string {
    return this.#path;
  }

  /**
   * The sealing key: the CI env var if set, otherwise the OS keychain,
   * generating and storing one on first use.
   *
   * Order matters and is 05 §4.3.1's: the env var is "for CI only", so it wins
   * where it is set (a CI box has no keychain to consult) and is simply absent
   * everywhere else. There is no third branch — no default passphrase, no
   * derive-from-hostname, nothing that would let the file open without either
   * the OS or an explicit operator act. That branch would be a service-account
   * fallback for the vault itself (CLAUDE.md #1).
   */
  async #key(): Promise<string> {
    if (this.#passphrase !== undefined) return this.#passphrase;

    const fromEnv = envVarKey(this.#env);
    if (fromEnv !== undefined) {
      this.#passphrase = fromEnv;
      return fromEnv;
    }

    const existing = await this.#keychain.get(SEALING_KEY_ITEM);
    if (existing !== undefined) {
      this.#passphrase = existing;
      return existing;
    }

    const minted = randomBytes(32).toString('base64');
    await this.#keychain.set(SEALING_KEY_ITEM, minted);
    // Read back rather than trusting the write: if the keychain silently
    // dropped it, sealing the vault with a key nobody holds destroys it.
    const confirmed = await this.#keychain.get(SEALING_KEY_ITEM);
    if (confirmed !== minted) {
      throw new SecretStoreError(
        `The OS keychain did not retain the sealing key "${SEALING_KEY_ITEM}".`,
        `Unlock the OS keychain and retry, or set ${CI_KEY_ENV_VAR} to a passphrase you control (02 §11.5). The vault was NOT written.`,
      );
    }
    this.#passphrase = minted;
    return minted;
  }

  async #read(): Promise<Vault> {
    if (!existsSync(this.#path)) return EMPTY_VAULT;
    const sealed = readFileSync(this.#path);
    const decrypter = new Decrypter();
    decrypter.addPassphrase(await this.#key());
    let plaintext: string;
    try {
      plaintext = await decrypter.decrypt(new Uint8Array(sealed), 'text');
    } catch {
      // Deliberately no cause, no partial plaintext, no key fingerprint —
      // an error path is a log line waiting to happen.
      throw new SecretStoreError(
        `${this.#path} could not be opened with the current sealing key.`,
        `Confirm the OS keychain item "${SEALING_KEY_ITEM}" is the one this file was sealed with, or set ${CI_KEY_ENV_VAR} to the correct passphrase. If the key is lost the values are unrecoverable by design — re-issue them (forge consumer issue-credential) rather than trying to recover the file.`,
      );
    }
    const parsed: unknown = JSON.parse(plaintext);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Vault).entries !== 'object'
    ) {
      throw new SecretStoreError(
        `${this.#path} decrypted but is not a MCPForge vault document.`,
        'Restore the file from backup, or delete it and re-issue every credential it held. Do not hand-edit a sealed vault.',
      );
    }
    return parsed as Vault;
  }

  async #write(vault: Vault): Promise<void> {
    const encrypter = new Encrypter();
    encrypter.setPassphrase(await this.#key());
    encrypter.setScryptWorkFactor(SCRYPT_WORK_FACTOR);
    const sealed = await encrypter.encrypt(JSON.stringify(vault));
    mkdirSync(dirname(this.#path), { recursive: true });
    // Seal to a temp file and rename: a crash mid-write must not leave a
    // truncated vault, which would take every credential with it.
    const tmp = `${this.#path}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(tmp, sealed);
    renameSync(tmp, this.#path);
  }

  #latest(vault: Vault, ref: SecretRef): StoredVersion | undefined {
    const versions = vault.entries[ref.uri];
    if (versions === undefined || versions.length === 0) return undefined;
    return [...versions].sort((a, b) => b.version - a.version)[0];
  }

  #missing(ref: SecretRef): SecretStoreError {
    return new SecretStoreError(
      `No credential is stored for ${ref.uri}.`,
      `Seed it with forge secrets put ${ref.uri}, or — for a consumer client credential — forge consumer issue-credential ${ref.subject}. A missing credential is never substituted with a default (CLAUDE.md #1).`,
      ref.uri,
    );
  }

  async get(ref: SecretRef): Promise<SecretValue> {
    const latest = this.#latest(await this.#read(), ref);
    if (latest === undefined) throw this.#missing(ref);
    return new SecretValue(ref, latest.version, latest.value);
  }

  async metadata(ref: SecretRef): Promise<SecretMetadata> {
    const latest = this.#latest(await this.#read(), ref);
    if (latest === undefined) throw this.#missing(ref);
    return toMetadata(ref, latest);
  }

  async list(): Promise<SecretRef[]> {
    const vault = await this.#read();
    return Object.keys(vault.entries)
      .filter((uri) => (vault.entries[uri] ?? []).length > 0)
      .sort()
      .map((uri) => parseSecretRef(uri));
  }

  async put(ref: SecretRef, value: string): Promise<SecretMetadata> {
    const vault = await this.#read();
    const previous = this.#latest(vault, ref);
    const now = this.#now();
    const entry: StoredVersion = {
      version: (previous?.version ?? 0) + 1,
      value,
      createdAt: previous?.createdAt ?? now.toISOString(),
      ...(previous === undefined ? {} : { rotatedAt: now.toISOString() }),
      expiresAt: expiryFor(ref, now),
    };
    await this.#write({
      ...vault,
      entries: { ...vault.entries, [ref.uri]: [...(vault.entries[ref.uri] ?? []), entry] },
    });
    return toMetadata(ref, entry);
  }

  async rotate(ref: SecretRef): Promise<SecretRef> {
    const vault = await this.#read();
    if (this.#latest(vault, ref) === undefined) throw this.#missing(ref);
    // A rotation MINTS the new value here. The caller never supplies it and
    // never sees it — that is what separates rotate() from put().
    await this.put(ref, randomBytes(32).toString('base64url'));
    return ref;
  }

  async revoke(ref: SecretRef): Promise<void> {
    const vault = await this.#read();
    if (vault.entries[ref.uri] === undefined) throw this.#missing(ref);
    const remaining = { ...vault.entries };
    delete remaining[ref.uri];
    await this.#write({ ...vault, entries: remaining });
  }
}
