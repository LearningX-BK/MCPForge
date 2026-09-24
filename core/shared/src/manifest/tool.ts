// MCPForge — `kind: Tool`. Field-for-field with the worked example at 02 §2.2,
// plus the Phase 5 addition `binding.credentialClass` (02 §11.5.1).

import type {
  Archetype,
  BindingType,
  ManifestBase,
  SemVer,
  Sensitivity,
  ToolId,
  Verb,
} from './common.js';

// --- binding -----------------------------------------------------------------

/**
 * ONLY the capability probe may ever write `verified`, and it writes it into
 * the probe report, never back into a manifest. A manifest asserting
 * `verified` fails validation. CLAUDE.md non-negotiable #2; 02 §2.2.
 */
export const IDENTITY_CARRIES = ['unverified', 'verified', 'no'] as const;
export type IdentityCarries = (typeof IDENTITY_CARRIES)[number];

/** The subset a hand-authored manifest is permitted to assert. */
export type AuthorableIdentityCarries = Exclude<IdentityCarries, 'verified'>;

/*
 * `binding.identity.onServiceAccount` is a field name fixed by 02 §2.2 and ids
 * there are immutable. It is the DETECTION of a service account — what the
 * gateway does when the probe reports the target saw one — and its only
 * permitted values are `block` and `readonly-lowsens`. It is the opposite of a
 * fallback: there is no value here that substitutes a shared credential for an
 * unresolved identity. The guard rule matches on the name shape alone and
 * cannot see that, so it is disabled for exactly these three lines and nowhere
 * else. Widening the rule belongs to its own file (W0-A3), not to this task.
 */
/* eslint-disable mcpforge/no-service-account-fallback -- spec-fixed field name; detection, never substitution (02 §2.2) */
export const ON_SERVICE_ACCOUNT = ['block', 'readonly-lowsens'] as const;
export type OnServiceAccountDisposition = (typeof ON_SERVICE_ACCOUNT)[number];
/* eslint-enable mcpforge/no-service-account-fallback */

export const IDENTITY_ECHO_ON = ['never', 'write', 'sampled', 'always'] as const;
export type IdentityEchoOn = (typeof IDENTITY_ECHO_ON)[number];

/**
 * 02 §11.5.1. `module-scoped-stored` is legitimate only when all four parts of
 * the stored-credential test hold; otherwise it is a service-account fallback
 * and CLAUDE.md non-negotiable #1 forbids it.
 */
export const CREDENTIAL_CLASSES = ['per-user-exchanged', 'module-scoped-stored', 'none'] as const;
export type CredentialClass = (typeof CREDENTIAL_CLASSES)[number];

export interface BindingIdentity {
  readonly carries: AuthorableIdentityCarries;
  readonly probe?: string;
  // eslint-disable-next-line mcpforge/no-service-account-fallback -- see ON_SERVICE_ACCOUNT above
  readonly onServiceAccount: OnServiceAccountDisposition;
  readonly echoOn: IdentityEchoOn;
}

export interface BindingExecution {
  readonly timeoutMs: number;
  readonly maxConcurrency: number;
  readonly responseBytesMax: number;
}

export interface ToolBinding {
  readonly type: BindingType;
  /** Free text naming the target technology, e.g. "JDE AIS Orchestration". */
  readonly technology: string;
  /** Allowlisted name; never taken from a parameter (02 §2.2). */
  readonly ref: string;
  readonly refVersion?: string;
  readonly identity: BindingIdentity;
  readonly execution: BindingExecution;
  /** Phase 5 (02 §11.5.1). */
  readonly credentialClass?: CredentialClass;
  /** Reference to the credential, never a value (02 §11.5). */
  readonly credentialRef?: string;
}

// --- inputs / outputs ---------------------------------------------------------

export const INPUT_TYPES = ['string', 'number', 'integer', 'boolean'] as const;
export type InputType = (typeof INPUT_TYPES)[number];

/** `desc` ≤12 words; enums >12 values must use `enumRef` (02 §5.3). */
export interface ToolInput {
  readonly name: string;
  readonly type: InputType;
  readonly required: boolean;
  readonly desc: string;
  readonly example?: string | number | boolean;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly format?: string;
  readonly enum?: readonly (string | number)[];
  readonly enumRef?: string;
}

/** A business key. These ARE the reversal handle (02 §2.2). */
export interface ResultKey {
  readonly name: string;
  /** JSONPath into the raw target response. */
  readonly path: string;
}

export interface ToolOutput {
  readonly summaryTemplate: string;
  readonly resultKeys: readonly ResultKey[];
}

// --- write safety -------------------------------------------------------------

export const DRY_RUN_STRATEGIES = [
  'native',
  'validate-pair',
  'precondition-read',
  'shadow-write',
  'transactional',
  'none',
] as const;
export type DryRunStrategy = (typeof DRY_RUN_STRATEGIES)[number];

/** `write: true` requires a strategy that is NOT `none` (CLAUDE.md #4). */
export type WriteDryRunStrategy = Exclude<DryRunStrategy, 'none'>;

export interface DryRun {
  readonly strategy: WriteDryRunStrategy;
  readonly ref?: string;
}

export interface Confirm {
  readonly required: true;
  readonly tokenTtlSeconds: number;
  /**
   * The highest-stakes copy in the product: names the system, the object, the
   * amounts and the business consequence in plain words (CLAUDE.md §5).
   */
  readonly planTemplate: string;
}

export const REVERSAL_CLASSES = [
  'native-reverse',
  'compensating-tool',
  'transactional',
  'irreversible',
] as const;
export type ReversalClass = (typeof REVERSAL_CLASSES)[number];

/**
 * The fields every reversal class carries, whatever its class. 02 §3.1.4.
 *
 * `argMap` maps a **reversing-tool argument name** to a `"$.result.<field>"`
 * path into the ORIGINAL call's extracted result keys — the direction W0-B7's
 * generated contract test already resolves, and the direction
 * `core/gateway/reversal/` applies at `forge audit reverse` time. It is not the
 * other way round, and reading it backwards would construct a reversing call
 * out of the wrong values.
 */
export interface ReversalCommon {
  /** Required when `class: compensating-tool`. */
  readonly tool?: ToolId;
  /** Reversing-tool argument name -> `"$.result.<original result key>"`. */
  readonly argMap?: Readonly<Record<string, string>>;
  readonly windowHours?: number;
  readonly preconditions?: string;
}

/**
 * A class for which a way back exists. These three are the only classes
 * `forge audit reverse` will ever construct a call for.
 */
export interface ReversibleReversal extends ReversalCommon {
  readonly class: Exclude<ReversalClass, 'irreversible'>;
}

/**
 * `irreversible` — payment transmitted, EDI sent, email issued. There is no way
 * back, so the only remaining control is a human before the fact, which is why
 * `IrreversibleWriteSafety` below pins `humanApprovalRequired: true` in the type
 * rather than merely checking it at validate time.
 */
export interface IrreversibleReversal extends ReversalCommon {
  readonly class: 'irreversible';
}

export type Reversal = ReversibleReversal | IrreversibleReversal;

/** True for exactly the one class 02 §3.1.4 says has no way back. */
export function isIrreversible(reversal: Reversal): reversal is IrreversibleReversal {
  return reversal.class === 'irreversible';
}

export interface Idempotency {
  readonly scopeHours: number;
}

/**
 * 02 §3.1.3's five kinds, and ONLY those five — `maxNumeric`/`minNumeric`,
 * `allowedValues`, `rateLimit`, `sodConflict`, `timeWindow`.
 *
 * `minNumeric`, `rateLimit` and `timeWindow` were added by **W0-F4**, whose
 * `done:` clause requires all five to be implemented at the gateway: a kind the
 * runtime enforces but a manifest cannot declare would be an engine nobody can
 * reach.
 *
 * **`requiresField` was RETIRED by W0-F8.** W0-B1 added it, 02 §3.1.3 never
 * defined it, and no evaluator could therefore be written for it — so the
 * gateway refused every call to any tool that declared one, while
 * `forge validate` passed the manifest clean. That combination took
 * `jde.ap.voucher.cancel` off the air silently. Leaving the kind schema-legal
 * would let any future manifest reintroduce the identical outage, so the kind
 * is removed rather than given invented semantics (CLAUDE.md §8). The only
 * constraint it was ever used for — "this argument must be present" — is
 * already enforced completely by `input[].required` via the compiled Ajv
 * validator at stage 6e.
 */
export const GUARDRAIL_KINDS = [
  'maxNumeric',
  'minNumeric',
  'sodConflict',
  'allowedValues',
  'rateLimit',
  'timeWindow',
] as const;
export type GuardrailKind = (typeof GUARDRAIL_KINDS)[number];

export interface Guardrail {
  readonly kind: GuardrailKind;
  readonly field?: string;
  readonly value?: number | string | readonly (string | number)[];
  /** For `sodConflict`. */
  readonly with?: ToolId;
  readonly scope?: string;
  /** For `rateLimit`: N executes per caller per window. */
  readonly limit?: number;
  /** For `rateLimit`: the window the limit is counted over. */
  readonly windowSeconds?: number;
  /** For `timeWindow`: the named precondition read the window is evaluated from. */
  readonly ref?: string;
  readonly message?: string;
}

/** The parts of `writeSafety` that do not vary with the reversal class. */
export interface WriteSafetyCommon {
  readonly dryRun: DryRun;
  readonly confirm: Confirm;
  readonly idempotency: Idempotency;
  readonly guardrails?: readonly Guardrail[];
}

/** A write with a declared way back. Human approval is the steward's choice. */
export interface ReversibleWriteSafety extends WriteSafetyCommon {
  /** `true` forces an out-of-band portal approval before a token is minted. */
  readonly humanApprovalRequired: boolean;
  readonly reversal: ReversibleReversal;
}

/**
 * 02 §3.1.4: "`irreversible` forces `humanApprovalRequired: true` and
 * `reviewPath: standard`."
 *
 * The first half is pinned HERE, in the type: `humanApprovalRequired` is the
 * literal `true`, so an irreversible write-safety block that does not require a
 * human does not type-check, in this repo, at compile time — it is not merely
 * refused by `policy.irreversible-approval` at `forge validate` time. The second
 * half lives on `governance`, which is a sibling of `writeSafety` rather than
 * part of it, and is pinned one level up on `IrreversibleWriteToolManifest`.
 */
export interface IrreversibleWriteSafety extends WriteSafetyCommon {
  readonly humanApprovalRequired: true;
  readonly reversal: IrreversibleReversal;
}

/** Required whenever `write: true` (02 §2.2, CLAUDE.md #4). */
export type WriteSafety = ReversibleWriteSafety | IrreversibleWriteSafety;

// --- governance / eval --------------------------------------------------------

export const REVIEW_PATHS = ['standard', 'expedited'] as const;
export type ReviewPath = (typeof REVIEW_PATHS)[number];

export interface Governance {
  readonly reviewPath: ReviewPath;
  readonly owner: string;
  /** A named person, filled at intake. Never an agent's invention. */
  readonly steward: string;
  /** 02 §3.3 / §11.4.7 — any tool carrying one is elevated posture. */
  readonly policyException?: string;
}

export interface ToolEval {
  readonly intentsFile: string;
  readonly minIntents: number;
}

// --- the manifest -------------------------------------------------------------

export interface ToolManifest extends ManifestBase<'Tool'> {
  readonly id: ToolId;
  readonly version: SemVer;
  /** The module server this tool belongs to. */
  readonly server: string;
  readonly title: string;

  // discovery surface — feeds the token budgets of 02 §5.3
  /** ≤14 words, verb-first (CLAUDE.md §5). */
  readonly purpose: string;
  /** ≤8 entries (02 §2.2). */
  readonly aliases?: readonly string[];
  /** Mandatory and mutual on any two tools sharing `{app}.{module}.{entity}`. */
  readonly disambiguation?: string;
  readonly archetype: Archetype;
  readonly verb: Verb;
  readonly entity: string;
  readonly app: string;
  readonly module: string;
  readonly functionalArea: string;
  readonly processTags?: readonly string[];
  readonly sensitivity: Sensitivity;
  readonly write: boolean;
  /** Counts against each named role's resident token budget (02 §5.3(d)). */
  readonly coreForRoles?: readonly string[];

  readonly binding: ToolBinding;
  readonly input: readonly ToolInput[];
  readonly output: ToolOutput;
  /** Present iff `write: true`. */
  readonly writeSafety?: WriteSafety;
  readonly governance: Governance;
  readonly eval: ToolEval;
}

/** A write tool whose declared reversal is one of the three that have a way back. */
export type ReversibleWriteToolManifest = ToolManifest & {
  readonly write: true;
  readonly writeSafety: ReversibleWriteSafety;
};

/**
 * A write tool with `reversal.class: irreversible`, with BOTH halves of
 * 02 §3.1.4's forcing rule pinned in the type: `writeSafety` must be an
 * `IrreversibleWriteSafety` (so `humanApprovalRequired` is the literal `true`)
 * and `governance.reviewPath` must be the literal `'standard'`. The expedited
 * path is structurally unavailable here, not merely discouraged.
 */
export type IrreversibleWriteToolManifest = ToolManifest & {
  readonly write: true;
  readonly writeSafety: IrreversibleWriteSafety;
  readonly governance: Governance & { readonly reviewPath: 'standard' };
};

/** A write tool, with `writeSafety` made structurally required. */
export type WriteToolManifest = ReversibleWriteToolManifest | IrreversibleWriteToolManifest;

export function isWriteTool(tool: ToolManifest): tool is WriteToolManifest {
  return tool.write === true && tool.writeSafety !== undefined;
}
