// MCPForge — shared manifest vocabulary. 02 §2.2, §2.6, §4.3, §6.1, §11.2.
//
// SCOPE NOTE (W0-A4): this module is the TYPE MODEL only. The JSON Schema and
// the ~40 `forge validate` rules are W0-B1/B2/B3 and live in core/codegen/**.
// Nothing here validates; these types describe the shape a validated manifest
// has. Deliberately no zod: a zod schema here would become a second, hand-
// written validator competing with the generated one, which CLAUDE.md §5
// forbids ("never a second hand-written validator").

/** Every manifest carries this, and an unknown value is rejected by name (02 §2.6). */
export const API_VERSION = 'mcpforge/v1' as const;
export type ApiVersion = typeof API_VERSION;

/**
 * The closed 19-item verb list. CLAUDE.md §5; 02 §2.2 id pattern.
 *
 * Widened from 17 to 19 (W0-I2) by owner decision: `get_receipt_status` and
 * `get_approval_status` are cited verbatim as tool ids across 01 §10.3, 02, 03,
 * the error-taxonomy tests and `seed/tools.yaml`. The list stays CLOSED — these
 * two were added deliberately, not derived, and nothing else may join without
 * the same decision.
 */
export const VERBS = [
  'search',
  'get',
  'list',
  'create',
  'update',
  'cancel',
  'submit',
  'approve',
  'release',
  'run_report',
  'run_process',
  'get_status',
  'get_receipt_status',
  'get_approval_status',
  'download',
  'simulate',
  'reconcile',
  'explain',
  'resolve',
] as const;
export type Verb = (typeof VERBS)[number];

/** `{app}.{module}.{entity}.{verb}`, lower snake, immutable (02 §2.2). */
export type ToolId = `${string}.${string}.${string}.${Verb}`;

/**
 * The structural id pattern from 02 §2.2, expressed once so the type model and
 * later the schema generator agree. The verb list is inlined structurally, not
 * looked up — that is the point of the rule.
 */
export const TOOL_ID_PATTERN = new RegExp(
  `^[a-z0-9_]+\\.[a-z0-9_]+\\.[a-z0-9_]+\\.(${VERBS.join('|')})$`,
);

/** 02 §2.2. */
export const SENSITIVITIES = [
  'public',
  'internal',
  'confidential',
  'financial',
  'personal',
] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

/** The five handshakes. 02 §3.7. */
export const BINDING_TYPES = ['rest', 'database', 'plsql', 'function', 'wrapped-vendor'] as const;
export type BindingType = (typeof BINDING_TYPES)[number];

/** 02 §2.2. */
export const ARCHETYPES = ['transactional', 'analytical', 'platform', 'wrapped'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/** `secretRef://<scope>/<subject>/<purpose>` — the only form a credential takes (02 §11.5). */
export type SecretRef = `secretRef://${string}`;
export const SECRET_REF_PATTERN = /^secretRef:\/\/[a-z0-9-]+\/[a-z0-9._-]+\/[a-z0-9._-]+$/;

/** Semver, e.g. `1.0.0`. Bump rules in 02 §2.6. */
export type SemVer = string;

/** ISO date, `YYYY-MM-DD`. */
export type IsoDate = string;

export type ManifestKind = 'Tool' | 'Server' | 'Role' | 'Package' | 'Consumer';

export interface ManifestBase<K extends ManifestKind> {
  readonly apiVersion: ApiVersion;
  readonly kind: K;
  readonly id: string;
}
