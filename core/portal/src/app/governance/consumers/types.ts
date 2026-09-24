// MCPForge — W0-N12: `/governance/consumers` view types (03 §16.2, 02 §11.2/§11.4).
//
// Same discipline as `../types.ts`: where a field is rendered it mirrors a REAL
// type from the package that owns it, so a later live-wiring task changes a
// loader and never a component.
//
// THIS TAB IS TAB 1'S PATTERN, NOT A FIXTURE SURFACE. 03 §16.2: "edit on the
// left, the compiled authorization artefact rendered explicitly on the right,
// and nothing saves directly." So the right pane's every field is read out of
// `generated/consumers/<id>.authorization.json` as written by the REAL
// compiler (`compileConsumerAuthorization` via `runCodegen`) during a live
// compile of the edited record — see `_lib/compile-consumer.ts`. There is no
// second opinion in this directory about what a consumer may reach.
import type { StatusToken } from '@mcpforge/shared';

/**
 * One consumer as the editor opens it: the authored record plus the compiled
 * authorization artefact currently on the branch (the "merged" side of the
 * diff, read and never re-derived — for the reason `_lib/repo-consumers.ts`
 * states).
 */
export interface ConsumerSource {
  readonly consumerId: string;
  readonly label: string;
  /** Repo-relative path, e.g. `consumers/claude-desktop-fin.consumer.yaml`. */
  readonly path: string;
  /** The authored YAML, verbatim. The editor's left pane. */
  readonly yamlText: string;
  /** Repo-relative path of the compiled artefact. */
  readonly artefactPath: string;
  /** The merged compiled artefact's bytes. `''` when never compiled. */
  readonly mergedArtefactJson: string;
  /**
   * True for a record that does not exist in `consumers/` yet — 03 §16.2's
   * **Register** action, which is a change proposal like every other grant
   * here. Scaffolded by the REAL `scaffoldConsumerRecord`, never hand-built.
   */
  readonly isNew: boolean;
  /** The registry-table facts that live in the record and not in the artefact. */
  readonly row: ConsumerRowView;
}

/** 03 §16.2's registered-consumer table, column for column. */
export interface ConsumerRowView {
  readonly consumerId: string;
  readonly label: string;
  readonly consumerClass: string;
  readonly owner: string;
  readonly steward: string;
  /** The authored `status:`. */
  readonly status: string;
  /**
   * `effectiveStatus` — the fail-closed reduction (an `active` registration
   * past its `expiresAt` is `expired`). From the gateway's own
   * `effectiveStatus`, never re-derived here.
   */
  readonly effectiveStatus: string;
  readonly expiresAt: string;
  /** Days since `credential.rotation.lastRotatedAt`. `null` when unreadable. */
  readonly credentialAgeDays: number | null;
  /** `lastRotatedAt + intervalDays`, as an ISO date. `null` when unreadable. */
  readonly nextRotationDue: string | null;
  /** Days until `nextRotationDue`; negative when overdue. */
  readonly rotationDueInDays: number | null;
  /** A record under `consumers/` that could not be read at all. */
  readonly loadError?: string;
}

/**
 * How close a dated grant is to its end. 03 §16.2: chipped `--status-write`
 * within 30 days of expiry and `--status-danger` past it. `token` is one of
 * the six semantic roles in `status.ts` — this file introduces no colour.
 */
export type GrantExpiryState = 'live' | 'expiring' | 'expired' | 'undated';

export interface GrantExpiryView {
  readonly state: GrantExpiryState;
  /** Days until expiry; negative once past. `null` for an unusable date. */
  readonly daysRemaining: number | null;
  readonly token: StatusToken;
  readonly label: string;
  readonly srLabel: string;
}

/**
 * One `bindingGrant` as the COMPILED artefact records it (02 §11.4). Every
 * field is read out of the artefact: `expired` is the compiler's own
 * fail-closed verdict, and `standing` is the RESOLVED standing-authorization
 * block (`resolveStandingAuthorization`), not the bare ref it was authored as.
 */
export interface GrantRowView {
  readonly bindingType: string;
  readonly names: readonly string[];
  readonly approvalRef: string;
  readonly approver: string;
  readonly expiresAt: string;
  /** The compiler's verdict, not a re-derivation. */
  readonly expired: boolean;
  readonly expiry: GrantExpiryView;
  /** `null` when the grant declares no standing authorization. */
  readonly standing: StandingAuthorizationView | null;
}

export interface StandingAuthorizationView {
  readonly ref: string;
  /** The compiler's closed `StandingStatus` vocabulary. */
  readonly status: string;
  readonly approver: string;
  readonly expiresAt: string;
  readonly effective: boolean;
  readonly expiry: GrantExpiryView;
}

/** One list-valued authorization dimension, diffed against the merged artefact. */
export interface AuthorizationListDelta {
  readonly field: string;
  readonly values: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/** One named value rendered as itself — the artefact's `limits` block. */
export interface AuthorizationValueRow {
  readonly field: string;
  readonly value: string;
}

/** One scalar authorization field whose value this edit changes. */
export interface AuthorizationScalarDelta {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

/** What one live compile of an edited consumer record produced. */
export interface CompiledConsumerDraft {
  readonly consumerId: string;
  /** The compiled `generated/consumers/<id>.authorization.json` bytes this run wrote. */
  readonly artefactJson: string;
  readonly label: string;
  readonly consumerClass: string;
  readonly status: string;
  readonly effectiveStatus: string;
  readonly expiresAt: string;
  readonly expired: boolean;
  /** The five `authorizations` keys, explicitly, as the artefact carries them. */
  readonly bindingTypes: readonly string[];
  readonly maxSensitivity: string;
  readonly writeAllowed: boolean;
  readonly roles: readonly string[];
  readonly packages: readonly string[];
  readonly limits: readonly AuthorizationValueRow[];
  readonly humanInTheLoop: boolean;
  readonly networkOrigins: readonly string[];
  readonly grants: readonly GrantRowView[];
  readonly listDeltas: readonly AuthorizationListDelta[];
  readonly scalarDeltas: readonly AuthorizationScalarDelta[];
  /**
   * Set when the edited record could not be compiled at all. The right pane
   * then shows the reason and the LAST good compile is NOT silently reused —
   * a stale authorization presented as live is the same lie as a hidden one.
   * Always names an action (CLAUDE.md non-negotiable 5).
   */
  readonly error?: { readonly message: string; readonly next: string };
}
