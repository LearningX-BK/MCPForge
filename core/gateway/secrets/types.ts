// MCPForge — `SecretStore`, the third pluggable seam. W0-N5.
// 02 §11.5 · 05 §4.3 · CLAUDE.md non-negotiable #8.
//
// This file exists to make one distinction impossible to get wrong by accident:
//
//   metadata()  is SAFE TO LOG.      It is plain data and carries no key material.
//   list()      is SAFE TO LOG.      It returns references, never values.
//   get()       is NOT SAFE TO LOG.  It returns the actual credential.
//
// 02 §11.5 states that distinction in prose. Prose is not enforcement, so it is
// built into the TYPES here rather than left to a reviewer's attention:
//
//   * `metadata()` returns a plain readonly record. There is no `value` field
//     on `SecretMetadata` and there is no code path that puts one there — the
//     contract suite asserts this by scanning the returned object for the known
//     secret material, not by trusting the declaration.
//
//   * `get()` returns a `SecretValue`, NOT a `string`. `SecretValue` is opaque:
//     `toString()`, `toJSON()` and Node's `util.inspect` custom hook all yield
//     the redaction marker, so `console.log(await store.get(ref))`,
//     `JSON.stringify({ v })` and a template literal ALL print
//     `[secret secretRef://…#3 — redacted]` and never the credential. Getting
//     the value out requires calling `.revealSecretValue()` — a deliberately
//     ugly, deliberately unique identifier that greps in one pass and that the
//     `no-secret-value-escape` lint rule matches by name.
//
// So a caller who logs the result of `get()` does not leak; a caller who
// REVEALS and then logs is doing something visibly wrong, in a form a lint
// rule, a code reviewer and a `git grep` all catch. That is the four-part-test
// discipline applied to the seam itself: make the illegitimate act require an
// explicit, named, greppable step rather than relying on nobody being careless.

// `Symbol.for('nodejs.util.inspect.custom')` rather than `import { inspect }
// from 'node:util'`: it is the well-known symbol Node's `util.inspect` (and
// therefore `console.log`) looks up, obtained without a Node builtin import
// so this module — which the portal reaches via `@mcpforge/gateway/secrets`
// from client code — never drags `node:util` into the browser bundle.
const NODE_INSPECT_CUSTOM = Symbol.for('nodejs.util.inspect.custom');

/** The redaction marker. Deliberately mentions the ref so a log line is still useful. */
const REDACTED = 'redacted';

// ---------------------------------------------------------------------------
// SecretRef — `secretRef://<scope>/<subject>/<purpose>` (02 §11.5, CLAUDE.md §5)
// ---------------------------------------------------------------------------

/**
 * 02 §11.5's scopes, as used by the refs the document itself gives as examples:
 * `secretRef://binding/ebs-p2p-ap/wrapper-schema`,
 * `secretRef://consumer/claude-desktop-coe/client`,
 * `secretRef://gateway/confirm-token/hmac`.
 */
export const SECRET_REF_SCOPES = ['binding', 'consumer', 'gateway'] as const;
export type SecretRefScope = (typeof SECRET_REF_SCOPES)[number];

const SEGMENT = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const SECRET_REF_RE = new RegExp(
  `^secretRef://(${SECRET_REF_SCOPES.join('|')})/(${SEGMENT})/(${SEGMENT})$`,
);

/**
 * A parsed, validated `secretRef://` URI.
 *
 * A ref is the ONLY form a credential takes in git, in a manifest, in an
 * overlay, in a consumer record, in an audit row, in a log line, in a portal
 * screen or in CLI output (02 §11.5). Refs are therefore always safe to print,
 * and every part of this type is inert text.
 */
export interface SecretRef {
  readonly uri: string;
  readonly scope: SecretRefScope;
  /** The module, consumer or gateway component the credential belongs to. */
  readonly subject: string;
  /** What the credential is FOR. Part of rule 4's one-credential-per-purpose. */
  readonly purpose: string;
}

export class SecretRefError extends Error {
  override readonly name = 'SecretRefError';
  readonly next: string;

  constructor(message: string, next: string) {
    super(message);
    this.next = next;
  }
}

/** Parse and validate. Throws `SecretRefError` with an actionable `next`. */
export function parseSecretRef(uri: string): SecretRef {
  const match = SECRET_REF_RE.exec(uri);
  if (match === null) {
    throw new SecretRefError(
      `"${uri}" is not a valid secretRef:// URI.`,
      `Write it as secretRef://<scope>/<subject>/<purpose> with scope one of ${SECRET_REF_SCOPES.join(
        ', ',
      )} and each segment lower-case alphanumeric with internal hyphens — for example secretRef://binding/ebs-p2p-ap/wrapper-schema (02 §11.5).`,
    );
  }
  // The regex has three capture groups and matched, so all three are present.
  const [, scope, subject, purpose] = match as unknown as [string, SecretRefScope, string, string];
  return { uri, scope, subject, purpose };
}

/** True when `uri` is a well-formed ref. Never throws — for validators and lints. */
export function isSecretRef(uri: unknown): uri is string {
  return typeof uri === 'string' && SECRET_REF_RE.test(uri);
}

/** Build a ref from its parts, validating the result. */
export function secretRef(scope: SecretRefScope, subject: string, purpose: string): SecretRef {
  return parseSecretRef(`secretRef://${scope}/${subject}/${purpose}`);
}

// ---------------------------------------------------------------------------
// SecretValue — the one type in this codebase that must not be logged
// ---------------------------------------------------------------------------

/**
 * An opaque handle to a credential value.
 *
 * **Every ordinary way of observing this object yields the redaction marker.**
 * String coercion, `JSON.stringify`, `console.log`, `util.inspect`, template
 * literals and structured loggers that call any of those all print
 * `[secret secretRef://…#N — redacted]`.
 *
 * The value itself comes out of exactly one method — {@link revealSecretValue} —
 * which is why that name is long and unlovely: it is a name you cannot type by
 * accident, cannot reach by spreading or destructuring, and can find repo-wide
 * with one grep. Per 02 §11.5 rule 2 it may only be called inside `adapters/**`
 * and `core/gateway/identity/**`, and `no-secret-value-escape` enforces that.
 */
export class SecretValue {
  readonly #value: string;
  /** Safe to print: the ref and version this value came from. */
  readonly ref: SecretRef;
  readonly version: number;

  constructor(ref: SecretRef, version: number, value: string) {
    this.#value = value;
    this.ref = ref;
    this.version = version;
  }

  /**
   * THE ONLY WAY OUT. Returns the raw credential.
   *
   * 02 §11.5 rule 2: callable only from `adapters/**` and
   * `core/gateway/identity/**`. Anything this returns must go straight into the
   * outbound call being constructed — never into a variable that outlives it,
   * never into an error message, never into audit (audit takes the REF and the
   * VERSION, per rule 3), never into a log line at any level.
   */
  revealSecretValue(): string {
    return this.#value;
  }

  /** The redaction marker. Identifies WHICH secret without disclosing it. */
  get redacted(): string {
    return `[secret ${this.ref.uri}#${this.version} — ${REDACTED}]`;
  }

  // W0-N6: `override` removed. `SecretValue` extends nothing, so TS4112
  // rejects the modifier the moment this file is actually typechecked — which
  // it was not until `core/cli` imported the module. The redaction behaviour
  // is unchanged; see this task's report for the tsconfig gap that hid it.
  toString(): string {
    return this.redacted;
  }

  toJSON(): string {
    return this.redacted;
  }
}

// Attached via `defineProperty` with a runtime symbol, not a `[computed]`
// class member: TS only treats a `const` bound to `Symbol()` as a `unique
// symbol` (the type a computed class member name requires), not one bound to
// `Symbol.for(...)`. This is the same hook `[inspect.custom]` would have
// installed had `node:util` been imported for its literal `symbol` typing.
Object.defineProperty(SecretValue.prototype, NODE_INSPECT_CUSTOM, {
  value: function (this: SecretValue): string {
    return this.redacted;
  },
  enumerable: false,
  configurable: true,
});

// ---------------------------------------------------------------------------
// SecretMetadata — safe to log, by construction
// ---------------------------------------------------------------------------

/**
 * 02 §11.5: `metadata()` is "safe to log". Every field here is a timestamp, a
 * counter or a ref — there is no field that can hold key material, and adding
 * one would fail the contract suite's material-scan, not merely a review.
 */
export interface SecretMetadata {
  readonly ref: string;
  readonly version: number;
  readonly createdAt: string;
  readonly rotatedAt: string | undefined;
  readonly expiresAt: string | undefined;
}

/**
 * 02 §11.5 rule 5's rotation intervals, in days, by ref scope. Read by
 * `forge secrets status` (W0-N6); declared here because the store is what
 * stamps `expiresAt` when a value is written.
 */
export const ROTATION_INTERVAL_DAYS: Readonly<Record<SecretRefScope, number>> = {
  consumer: 90,
  binding: 180,
  gateway: 90,
};

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

export class SecretStoreError extends Error {
  override readonly name = 'SecretStoreError';
  readonly next: string;
  readonly ref: string | undefined;

  constructor(message: string, next: string, ref?: string) {
    super(message);
    this.next = next;
    this.ref = ref;
  }
}

/**
 * 02 §11.5 / 05 §4.3, verbatim in shape.
 *
 * Two Wave 0 implementations — `EncryptedFileStore` (the default) and
 * `OsKeychainStore` — are contract-tested against ONE suite, the same
 * discipline `W0-D3` applies to `IdentityProvider` and `W0-C5` to the Postgres
 * dialect. `OciVaultStore` is the named production target and is deliberately
 * NOT built in Wave 0; see `./oci-vault.ts`, which documents the Wave 1 task
 * rather than standing up a stub that silently returns nothing.
 */
export interface SecretStore {
  readonly kind: SecretStoreKind;

  /** NOT SAFE TO LOG. Resolvable only inside `adapters/**` and `core/gateway/identity/**`. */
  get(ref: SecretRef): Promise<SecretValue>;

  /** Safe to log. Never carries key material. */
  metadata(ref: SecretRef): Promise<SecretMetadata>;

  /** Writes a new version and returns the ref. The value never leaves the store. */
  rotate(ref: SecretRef): Promise<SecretRef>;

  /** Refs only, never values. */
  list(): Promise<SecretRef[]>;

  /**
   * Seed or replace a value. Not in 02 §11.5's four-method sketch because the
   * document describes the READ seam; something has to put the first version
   * in, and `rotate()` alone cannot (it needs a prior version to succeed). Kept
   * on the interface so both implementations are exercised by one suite.
   */
  put(ref: SecretRef, value: string): Promise<SecretMetadata>;

  /** 02 §11.5 rule 6's first half. The dependent kill-switching is W0-N6. */
  revoke(ref: SecretRef): Promise<void>;
}

export const SECRET_STORE_KINDS = ['encrypted-file', 'os-keychain', 'oci-vault'] as const;
export type SecretStoreKind = (typeof SECRET_STORE_KINDS)[number];
