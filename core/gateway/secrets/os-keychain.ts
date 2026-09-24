// MCPForge — `OsKeychainStore`. W0-N5, 02 §11.5 / 05 §4.3.1.
//
// "OsKeychainStore — a second Wave 0 implementation for interactive
// development, contract-tested against the same suite." (05 §4.3.1)
//
// The difference from `EncryptedFileStore` is where the VALUES live: here every
// version is its own OS keychain item and there is no sealed file at all, so
// there is no vault to lose, back up or leak, and the OS's own unlock policy
// (login keychain, DPAPI user binding, gnome-keyring) is the whole of the
// access control. That is why it is the interactive-development store and not
// the default: it cannot work headless, in CI, or in a container.
//
// THE INDEX IS PLAINTEXT, AND THAT IS DELIBERATE. Neither Credential Manager,
// `security` nor `secret-tool` offers a portable "list items matching a
// prefix", so `list()` needs an index of its own. It holds refs and timestamps
// — precisely the two things 02 §11.5 declares safe to log — and NEVER a value.
// The asymmetry with `EncryptedFileStore` (which seals its ref names inside the
// envelope) is a real, accepted trade: this store discloses WHICH credentials
// exist to anyone who can read the file, in exchange for the OS holding every
// value. Flagged rather than buried, because it is the kind of difference that
// should be a decision and not a surprise.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROTATION_INTERVAL_DAYS, SecretStoreError, SecretValue, parseSecretRef } from './types.js';
import type { SecretMetadata, SecretRef, SecretStore } from './types.js';
import { osKeychainBackend } from './keychain.js';
import type { KeychainBackend } from './keychain.js';

export const KEYCHAIN_INDEX_FILE = ['.mcpforge', 'secrets.keychain-index.json'];

/** The keychain item name for one version of one ref. */
export function keychainItemFor(ref: SecretRef, version: number): string {
  return `${ref.uri}#${version}`;
}

interface IndexEntry {
  readonly ref: string;
  readonly version: number;
  readonly createdAt: string;
  readonly rotatedAt?: string;
  readonly expiresAt?: string;
}

interface Index {
  readonly apiVersion: 'mcpforge/v1';
  /**
   * Refs and timestamps only. There is no `value` key in this type and the
   * contract suite scans the file on disk to prove none appears at runtime.
   */
  readonly entries: IndexEntry[];
}

export interface OsKeychainStoreOptions {
  readonly repoRoot: string;
  readonly keychain?: KeychainBackend;
  readonly now?: () => Date;
}

export class OsKeychainStore implements SecretStore {
  readonly kind = 'os-keychain' as const;
  readonly #indexPath: string;
  readonly #keychain: KeychainBackend;
  readonly #now: () => Date;

  constructor(options: OsKeychainStoreOptions) {
    this.#indexPath = join(options.repoRoot, ...KEYCHAIN_INDEX_FILE);
    this.#keychain = options.keychain ?? osKeychainBackend();
    this.#now = options.now ?? (() => new Date());
  }

  get indexPath(): string {
    return this.#indexPath;
  }

  #readIndex(): Index {
    if (!existsSync(this.#indexPath)) return { apiVersion: 'mcpforge/v1', entries: [] };
    const parsed: unknown = JSON.parse(readFileSync(this.#indexPath, 'utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as Index).entries)
    ) {
      throw new SecretStoreError(
        `${this.#indexPath} is not a MCPForge keychain index.`,
        'Delete the file and re-seed the credentials it indexed; the values themselves are still in the OS keychain but are no longer discoverable by list().',
      );
    }
    return parsed as Index;
  }

  #writeIndex(index: Index): void {
    mkdirSync(dirname(this.#indexPath), { recursive: true });
    writeFileSync(this.#indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  }

  #latest(ref: SecretRef): IndexEntry | undefined {
    return this.#readIndex()
      .entries.filter((e) => e.ref === ref.uri)
      .sort((a, b) => b.version - a.version)[0];
  }

  #missing(ref: SecretRef): SecretStoreError {
    return new SecretStoreError(
      `No credential is stored for ${ref.uri}.`,
      `Seed it with forge secrets put ${ref.uri}, or — for a consumer client credential — forge consumer issue-credential ${ref.subject}. A missing credential is never substituted with a default (CLAUDE.md #1).`,
      ref.uri,
    );
  }

  async get(ref: SecretRef): Promise<SecretValue> {
    const latest = this.#latest(ref);
    if (latest === undefined) throw this.#missing(ref);
    const value = await this.#keychain.get(keychainItemFor(ref, latest.version));
    if (value === undefined) {
      throw new SecretStoreError(
        `${ref.uri} is indexed at version ${latest.version} but the OS keychain has no such item.`,
        'Unlock the OS keychain and retry. If the item was deleted outside MCPForge, re-issue the credential — it is not recoverable from the index, which holds no values by design.',
        ref.uri,
      );
    }
    return new SecretValue(ref, latest.version, value);
  }

  async metadata(ref: SecretRef): Promise<SecretMetadata> {
    const latest = this.#latest(ref);
    if (latest === undefined) throw this.#missing(ref);
    return {
      ref: ref.uri,
      version: latest.version,
      createdAt: latest.createdAt,
      rotatedAt: latest.rotatedAt,
      expiresAt: latest.expiresAt,
    };
  }

  async list(): Promise<SecretRef[]> {
    const uris = new Set(this.#readIndex().entries.map((e) => e.ref));
    return [...uris].sort().map((uri) => parseSecretRef(uri));
  }

  async put(ref: SecretRef, value: string): Promise<SecretMetadata> {
    const index = this.#readIndex();
    const previous = this.#latest(ref);
    const version = (previous?.version ?? 0) + 1;
    const now = this.#now();

    // The OS write happens FIRST. If it fails, the index is untouched and the
    // store is consistent; the reverse order would index a version that does
    // not exist and turn a keychain hiccup into a permanent phantom entry.
    await this.#keychain.set(keychainItemFor(ref, version), value);

    const entry: IndexEntry = {
      ref: ref.uri,
      version,
      createdAt: previous?.createdAt ?? now.toISOString(),
      ...(previous === undefined ? {} : { rotatedAt: now.toISOString() }),
      expiresAt: new Date(
        now.getTime() + ROTATION_INTERVAL_DAYS[ref.scope] * 86_400_000,
      ).toISOString(),
    };
    this.#writeIndex({ ...index, entries: [...index.entries, entry] });
    return {
      ref: entry.ref,
      version: entry.version,
      createdAt: entry.createdAt,
      rotatedAt: entry.rotatedAt,
      expiresAt: entry.expiresAt,
    };
  }

  async rotate(ref: SecretRef): Promise<SecretRef> {
    if (this.#latest(ref) === undefined) throw this.#missing(ref);
    await this.put(ref, randomBytes(32).toString('base64url'));
    return ref;
  }

  async revoke(ref: SecretRef): Promise<void> {
    const index = this.#readIndex();
    const mine = index.entries.filter((e) => e.ref === ref.uri);
    if (mine.length === 0) throw this.#missing(ref);
    // Every version, not just the latest: a revocation that leaves version 2
    // readable while removing version 3 has revoked nothing (02 §11.5 rule 6).
    for (const entry of mine) {
      await this.#keychain.delete(keychainItemFor(ref, entry.version));
    }
    this.#writeIndex({ ...index, entries: index.entries.filter((e) => e.ref !== ref.uri) });
  }
}
