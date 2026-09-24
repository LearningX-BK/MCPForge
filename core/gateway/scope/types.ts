// MCPForge — scope resolution: the inputs. W0-E2, 02 §4.2 step [4], 02 §5.1,
// 02 §11.3.
//
//   visible(session) = Deployed(package)
//                    ∩ Granted(∪ caller roles)
//                    ∩ Activated(persona | default)
//                    ∩ ProbeEnabled(probe status = resolved | degraded_readonly)
//                    ∩ ¬KillSwitched
//                    ∩ ConsumerAuthorized(consumer)          [P5] 02 §11.3
//
// This module owns the SHAPES the six predicates read. It deliberately owns no
// I/O: nothing here opens a file, reads the store or talks to the registry.
// Scope resolution is a pure function of (catalogue, deployment, compiled
// grants, session, probe status, runtime flags), and keeping it pure is what
// makes "removing any one predicate widens the set" a testable claim rather
// than an assertion about a running system.
//
// WHAT THIS MODULE IS NOT. It is not the policy chain (02 §4.2 step [6],
// W0-E3). Step 4 decides what is *listed*; step 6a/6a′ re-check the same facts
// at call time, deliberately and independently (02 §4.2). `refusalFor` here
// exists so a caller naming an unlisted tool id — through `forge.invoke` or a
// direct `tools/call` — gets the right closed-taxonomy code with a real `next`,
// not so that W0-E3 can skip its own check.

import type { BindingType, Sensitivity } from '@mcpforge/shared';
import type { Principal } from '../identity/index.js';

/** A tool id. Structurally `{app}.{module}.{entity}.{verb}` (CLAUDE.md §5). */
export type ToolId = string;

/**
 * The gateway's minimal view of one catalogue entry — exactly the fields the
 * six predicates read, and no more. The registry (W0-G*) is the eventual
 * source; the shape is small on purpose so scope resolution does not acquire a
 * dependency on the full manifest view.
 */
export interface ScopeCatalogueEntry {
  readonly toolId: ToolId;
  /** The module server that owns this tool — a kill-switch granularity (02 §4.7). */
  readonly serverId: string;
  readonly bindingType: BindingType;
  readonly sensitivity: Sensitivity;
  readonly write: boolean;
}

/**
 * What is deployed here at all (02 §5.1, axis 1): this deployment's identity
 * and the packages selected into it. The package *contents* live in
 * `ScopeContext.packageSelections`, because a consumer's declared packages are
 * a property of its registration and are not necessarily deployed here — the
 * two must be resolvable independently or `Deployed` and `ConsumerAuthorized`
 * stop being separable predicates.
 */
export interface DeploymentView {
  readonly deploymentId: string;
  readonly packageIds: readonly string[];
}

/**
 * What this session is currently working on (02 §5.1, axis 3) — set by
 * `forge.activate`.
 *
 * `default` means "no persona chosen", which narrows nothing: the other five
 * predicates still apply. It is NOT a bypass — `Activated` is the only
 * predicate whose default is permissive, and it is permissive because
 * activation is a caller-chosen *lens*, not a grant. Every predicate that
 * expresses an authority (Deployed, Granted, ConsumerAuthorized, ProbeEnabled,
 * ¬KillSwitched) is fail-closed.
 */
export type SessionActivation =
  | { readonly mode: 'default' }
  | { readonly mode: 'explicit'; readonly toolIds: ReadonlySet<ToolId> };

/**
 * The consumer's compiled authorizations, as they appear in
 * `generated/consumers/<id>.authorization.json` (W0-B8, 02 §11.2).
 *
 * SEAM, stated plainly: `core/gateway/consumer/**` — the consumer registry that
 * authenticates a presenting client and loads its record at session
 * establishment (step `[2a]`) — does not exist yet and is NOT built by this
 * task. This is the read-only *view* of the compiled artefact that the
 * `ConsumerAuthorized` predicate needs, nothing more. No registry, no
 * credential handling, no `[2a]` check lives here.
 */
export interface ConsumerAuthorizationView {
  readonly consumerId: string;
  /**
   * The fail-closed reduction W0-B8 already computes: an `active` registration
   * whose `expiresAt` has passed compiles to `expired` (02 §11.2 — renewal is a
   * re-approval, not a no-op). Anything other than `active` means this consumer
   * holds no session and sees no catalogue.
   */
  readonly effectiveStatus: string;
  readonly authorizations: {
    readonly bindingTypes: readonly string[];
    readonly maxSensitivity: string;
    readonly writeAllowed: boolean;
    readonly roles: readonly string[];
    readonly packages: readonly string[];
  };
  /**
   * The registration's own attestation, NOT an authorization. It is separate
   * from `authorizations` on purpose: `humanInTheLoop` grants nothing and
   * withholds nothing — it is the consumer's stated claim about its own
   * operating shape, and its only job is to reach `audit_call.human_in_the_loop`
   * so a row can be read back as "a human was present for this" without the
   * gateway assuming one (non-negotiable 6). Scope's six predicates must never
   * read it.
   */
  readonly attestation: {
    readonly humanInTheLoop: boolean;
  };
}

/**
 * What `[2a]` established about THIS session's consumer, frozen at the moment
 * authentication succeeded. W0-N10, 02 §11.3.
 *
 * > "`consumer_record_sha` pins **which version of the consumer's
 * > authorizations was in force** for that call."
 *
 * **Why this is separate from `ConsumerAuthorizationView` above.** That view is
 * parsed from the compiled artefact `generated/consumers/<id>.authorization.json`
 * — a derived, regenerable file. This is provenance: the sha256 of the exact
 * bytes of the reviewed `consumers/<id>.consumer.yaml` record as the registry
 * read them when this session was authenticated
 * (`../consumer/registry.ts`'s `LoadedConsumer.recordSha`), plus how that
 * consumer proved itself and which session it holds. Keeping them apart is
 * what stops a later re-derivation from being mistaken for the historical
 * fact: the sha travels as a captured VALUE from `[2a]` to the audit row and
 * is never recomputed downstream, so a row written on Monday keeps Monday's
 * sha even after the record is amended on Tuesday. That is the whole content
 * of the done criterion's "in force at that call".
 */
export interface ConsumerSessionProvenance {
  /** The authenticated consumer id — the same value as `consumer.consumerId`. */
  readonly consumerId: string;
  /** sha256 of the record file's bytes, as loaded at authentication. 64 lowercase hex. */
  readonly recordSha: string;
  /** `private-key-jwt` | `client-secret` — how this consumer proved itself at `[2a]`. */
  readonly authMethod: string;
  /** The consumer's own session identifier, for `audit_call.consumer_session_id`. */
  readonly consumerSessionId: string;
}

/**
 * One session, as scope resolution sees it. `CallerContext = { consumer,
 * principal }` (02 §11.2) — there is no consumer-only path and no human-only
 * path, so both are required fields and neither is optional.
 */
export interface ScopeSession {
  readonly principal: Principal;
  /**
   * The roles this human holds, from the git-held group→role mapping (W0-D4).
   * These are the HUMAN's roles. The consumer's own `authorizations.roles`
   * intersect with them in `ConsumerAuthorized` — they never union.
   */
  readonly heldRoleIds: readonly string[];
  readonly consumer: ConsumerAuthorizationView;
  /**
   * W0-N10 — what `[2a]` established about this consumer, frozen. Required, not
   * optional: an audit row whose `consumer_record_sha` is absent cannot answer
   * "what was this agent allowed to do that day" from the row, which is the
   * one thing 02 §11.3 asks of the column. The six scope predicates must never
   * read this — it is provenance for the trail, not an authorization.
   */
  readonly consumerSession: ConsumerSessionProvenance;
  readonly activation: SessionActivation;
}

/** Everything the six predicates read, assembled once per resolution. */
export interface ScopeContext {
  readonly deployment: DeploymentView;
  /** packageId → the package's compiled selection (`generated/packages/<id>.selection.json`). */
  readonly packageSelections: ReadonlyMap<string, ReadonlySet<ToolId>>;
  /** roleId → the role's compiled explicit tool-id list (`generated/roles/<id>.scope.json`). */
  readonly roleScopes: ReadonlyMap<string, ReadonlySet<ToolId>>;
  readonly session: ScopeSession;
  readonly probe: ProbeStatusSource;
  readonly flags: RuntimeFlagSource;
  /** "Now", injectable so tests pin kill-switch `until` windows. */
  readonly now: Date;
}

// --- the two runtime seams -------------------------------------------------

/**
 * 02 §4.5's closed status enum. "There is no third state and no silent
 * failure" — every tool in the catalogue carries exactly one of these after
 * every probe run.
 */
export const PROBE_STATUSES = [
  'resolved',
  'degraded_readonly',
  'disabled_missing_binding',
  'disabled_no_grant',
  'disabled_identity_unverified',
  'disabled_schema_drift',
  'disabled_kill_switch',
] as const;
export type ProbeStatus = (typeof PROBE_STATUSES)[number];

/** 02 §5.1: `Enabled(probe status = resolved | degraded_readonly)`. */
export const PROBE_ENABLED_STATUSES: ReadonlySet<string> = new Set<string>([
  'resolved',
  'degraded_readonly',
]);

/**
 * Where a tool's probe status comes from.
 *
 * SEAM: `core/probe/**` and the schema-validated `probe-report.json` are
 * W0-H4's job and do not exist yet. This interface is the read side of that
 * artefact and is all `ProbeEnabled` needs; W0-H4 supplies an implementation
 * backed by the real report without any caller changing.
 *
 * `null` means "this tool has no probe status" and the predicate treats it as
 * NOT enabled. That is deliberate and fail-closed: a binding nobody has
 * confirmed works is not a binding a session may see, and non-negotiable #2
 * ("`verified` may only ever be written by the capability probe") is only true
 * if the absence of a probe result is never read as a pass.
 */
export interface ProbeStatusSource {
  statusFor(toolId: ToolId): ProbeStatus | null;
}

/** The five kill-switch granularities. 02 §4.7 as extended by 02 §11.2. */
export const KILL_SCOPES = [
  'tool',
  'moduleServer',
  'bindingType',
  'consumer',
  'deployment',
] as const;
export type KillScope = (typeof KILL_SCOPES)[number];

/** One `runtime_flags` row (02 §4.7). */
export interface RuntimeFlag {
  readonly scope: KillScope;
  /** The tool id, server id, binding type, consumer id or deployment id killed. */
  readonly target: string;
  /** The flag's own reason text — surfaced verbatim in `TOOL_DISABLED` (02 §4.7). */
  readonly reason: string;
  /** `--until`; `null` means indefinite. */
  readonly until?: Date | null;
}

/**
 * Where active kill-switch flags come from.
 *
 * SEAM: the `runtime_flags` table, its 5-second hot-reload poll, the
 * `notifications/tools/list_changed` emission and `forge kill` are **W0-E5's**
 * job (`touches: core/gateway/flags/**`) and are not built here. This is the
 * read side only, so `¬KillSwitched` is a real predicate today rather than a
 * placeholder that W0-E5 has to retrofit into the intersection.
 */
export interface RuntimeFlagSource {
  activeFlags(): readonly RuntimeFlag[];
}
