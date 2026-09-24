// MCPForge — `forge validate` engine. W0-B2.
//
// SCOPE: structure (delegated to the W0-B1 Ajv schema) plus referential
// integrity across manifest files — a Tool's `server` must name a real
// Server manifest, an `enumRef` must name a real file under `enums/`, and so
// on. The ~40 policy and safety rules (write-safety completeness, the
// `identity.carries: verified` rejection, etc.) are W0-B3 and live in
// `core/codegen/rules/**`; this module only provides the extension seam
// (`ValidationRule`) that W0-B3 plugs into, and implements none of them.

/** One failure, in the shape `forge validate --json` reports it. */
export interface ValidationFailure {
  /** A stable, dotted rule id — e.g. `structural.required-field`, `ref.server-not-found`. */
  readonly ruleId: string;
  /**
   * `error` (the default when absent) fails the build; `warning` is reported
   * and does not. Added by W0-B8 because 02 §4.3 requires exactly two
   * outcomes from segregation-of-duties detection — a build WARNING for a
   * declared conflict, a build FAILURE when its `disposition` is `block`.
   * ABSENT MEANS ERROR: a rule that forgets to say cannot accidentally
   * downgrade itself to a warning.
   */
  readonly severity?: 'error' | 'warning';
  /** Repo-relative, forward-slash path to the offending manifest file. */
  readonly file: string;
  /** JSON-Pointer-style path into the document, e.g. `/binding/identity/carries`. */
  readonly path: string;
  /** What was found to be wrong. */
  readonly message: string;
  /** An agent/human-actionable instruction for fixing it — never "try again" (CLAUDE.md #5's discipline, applied to authoring too). */
  readonly fix: string;
}

export interface ValidationReport {
  readonly ok: boolean;
  readonly filesChecked: number;
  /** Everything that FAILS the build. `ok` is `failures.length === 0`. */
  readonly failures: readonly ValidationFailure[];
  /** Reported, does not fail the build (W0-B8; 02 §4.3's warning half). */
  readonly warnings: readonly ValidationFailure[];
}

export const MANIFEST_EXTENSIONS = ['.yaml', '.yml'] as const;

/** One manifest file as loaded from disk, parsed if possible. */
export interface ManifestFile {
  /** Absolute path. */
  readonly absPath: string;
  /** Repo-relative, forward-slash path — what failures and fixes name. */
  readonly file: string;
  /** The parsed YAML document, or `undefined` if parsing failed. */
  readonly doc: unknown;
  /** Set when the file could not be parsed as YAML at all. */
  readonly parseError?: string;
}

/**
 * A manifest file whose `kind` and `id` were readable even if the document
 * did not fully pass schema validation — referential-integrity rules need
 * to know "does a Role named p2p exist at all", not "does it validate".
 */
export interface IndexedManifest {
  readonly file: ManifestFile;
  readonly kind: 'Tool' | 'Server' | 'Role' | 'Package' | 'Consumer';
  readonly id: string;
  /** The raw parsed document, for rules that need to read further fields. */
  readonly doc: Record<string, unknown>;
}

/** Everything a rule (structural or referential, W0-B2 or a future W0-B3 rule) needs. */
export interface RepoContext {
  readonly repoRoot: string;
  /** Every manifest file found under `manifests/`, `roles/`, `packages/`, `consumers/`. */
  readonly files: readonly ManifestFile[];
  /** The subset whose `kind`/`id` resolved, indexed for cross-file lookups. */
  readonly manifests: readonly IndexedManifest[];
  /** Enum lookup-list names available under `enums/` (02 §2.2's `enumRef`). */
  readonly enumNames: ReadonlySet<string>;
}

/**
 * The extension seam. W0-B2 implements the structural pass (via the W0-B1
 * Ajv validators) and the referential-integrity rules below as `ValidationRule`
 * instances; W0-B3's ~40 policy/safety rules are meant to plug in the same
 * way, against the same `RepoContext`, without this module changing shape.
 */
export interface ValidationRule {
  readonly id: string;
  check(ctx: RepoContext): readonly ValidationFailure[];
}
