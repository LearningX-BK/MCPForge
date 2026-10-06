// MCPForge — W0-Q9: the AuthoringModel seam. docs/build-plan/w0-q8-assisted-authoring.md.
//
// The fourth pluggable seam after IdentityProvider, ChangeHost and SecretStore.
// A model returns TEXT FOR ONE NAMED FIELD. It never returns YAML, a patch, or a
// choice of which field to write: the caller names the field, from a closed
// list, and only `applySuggestion` (./apply.ts) ever writes into a draft.

/**
 * §1 allow-list: the only manifest fields a model may propose text for. Closed,
 * in code, and tested. Everything else (binding.*, writeSafety.* except the plan
 * template, identity.*, sensitivity, write, governance.*, grants, version, id,
 * server, generated/) is refused before a provider is ever called.
 *
 * The note also listed error-map `next` copy. The tool manifest has no error-map
 * field (core/shared/src/manifest/tool.ts), so there is nowhere to write it and
 * it is NOT on this list. If an error map joins the manifest, extending this
 * list is a deliberate, tested change.
 */
export const ALLOWED_FIELDS = [
  'purpose',
  'disambiguation',
  'aliases',
  'input.desc',
  'input.example',
  'output.summaryTemplate',
  'writeSafety.confirm.planTemplate',
] as const;
export type AllowedField = (typeof ALLOWED_FIELDS)[number];

export function isAllowedField(field: unknown): field is AllowedField {
  return typeof field === 'string' && (ALLOWED_FIELDS as readonly string[]).includes(field);
}

/** Which one input (by name) a per-input field targets. */
export interface FieldTarget {
  readonly field: AllowedField;
  /** Required for `input.desc` / `input.example`: the input's `name`. */
  readonly inputName?: string;
}

/** The constraint the text must meet, handed to the model and re-checked by the gate. */
export interface FieldConstraint {
  readonly maxWords?: number;
  readonly maxItems?: number;
  readonly mustMention?: readonly string[];
  readonly mustNotBe?: readonly string[];
  readonly description: string;
}

/** What the model is told. Built by ./payload.ts, which owns the never-sent list. */
export interface SuggestRequest {
  readonly target: FieldTarget;
  readonly constraint: FieldConstraint;
  /** The minimised context (§4). Plain strings only. */
  readonly context: Readonly<Record<string, string>>;
}

export const SUGGEST_ERROR_CODES = [
  'AUTHORING_NOT_CONFIGURED',
  'AUTHORING_FIELD_NOT_ALLOWED',
  'AUTHORING_SENSITIVITY_BLOCKED',
  'AUTHORING_PROVIDER_UNKNOWN',
  'AUTHORING_PROVIDER_UNAVAILABLE',
  'AUTHORING_KEY_MISSING',
  'AUTHORING_PROVIDER_FAILED',
  'AUTHORING_RESPONSE_UNRECOGNISED',
  'AUTHORING_GATE_REFUSED',
] as const;
export type SuggestErrorCode = (typeof SUGGEST_ERROR_CODES)[number];

/** Closed taxonomy, always with a `next` (CLAUDE.md non-negotiable 5). Never carries a key. */
export interface SuggestFailure {
  readonly ok: false;
  readonly code: SuggestErrorCode;
  readonly message: string;
  readonly next: string;
}

export interface Provenance {
  readonly provider: string;
  readonly model: string;
  readonly requestId: string;
}

export interface SuggestSuccess {
  readonly ok: true;
  readonly text: string;
  readonly provenance: Provenance;
}
export type SuggestResult = SuggestSuccess | SuggestFailure;

/** The exact text sent to a provider. */
export interface Prompt {
  readonly system: string;
  readonly user: string;
}

export interface AuthoringModel {
  /** The overlay entry's id. */
  readonly id: string;
  /** False when unconfigured or its key is missing: the feature is then ABSENT, not broken. */
  readonly available: boolean;
  /** Draft one allow-listed field. */
  suggest(request: SuggestRequest): Promise<SuggestResult>;
  /** Complete a prompt. Used by `suggest` and by eval-intent suggestion (a separate call, note §6). */
  complete(prompt: Prompt): Promise<SuggestResult>;
}

export function failure(code: SuggestErrorCode, message: string, next: string): SuggestFailure {
  return { ok: false, code, message, next };
}
