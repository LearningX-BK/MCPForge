// MCPForge — the audit repository's types. W0-C2.
//
// One TypeScript field per `audit_call` column in 02 §4.6 (as extended by
// §11.3), in the same block order, so a reviewer can read this file and the
// spec side by side. Nothing here is optional-by-accident: a column that may
// not be null in `schema/spec.ts` is required here, and a nullable column is
// `| null` on the record and `?` on the input.

import type { AuditChainVerification } from './verify.js';

/** One normalised business key from `result_keys` (02 §10.4 item 2). */
export interface AuditResultKey {
  readonly keyName: string;
  readonly keyValue: string;
}

/**
 * One credential reference used by a call (02 §11.3).
 *
 * `secretRef` is a `secretRef://<scope>/<subject>/<purpose>` string. A secret
 * VALUE never appears here, or anywhere else a human or a log can see it
 * (CLAUDE.md non-negotiable 8).
 */
export interface AuditCredentialRef {
  readonly secretRef: string;
  readonly version: string | null;
}

/** 02 §4.6 — `plan | execute | reject | reverse`. */
export type AuditPhase = 'plan' | 'execute' | 'reject' | 'reverse';

/** 02 §4.6 — `ok | business_error | policy_denied | binding_error | timeout`. */
export type AuditOutcome = 'ok' | 'business_error' | 'policy_denied' | 'binding_error' | 'timeout';

/** 02 §4.6 — `'client_identifier' | 'wrapper_schema' | 'none'`. */
export type CompensatingControl = 'client_identifier' | 'wrapper_schema' | 'none';

/** A written audit row, satellites included, exactly as it sits in the store. */
export interface AuditCallRecord {
  readonly id: string;
  readonly ts: string;
  readonly correlationId: string | null;
  readonly sessionId: string | null;
  readonly parentCallId: string | null;

  // -- who
  readonly callerSubject: string;
  readonly callerDisplay: string | null;
  readonly callerIdp: string | null;
  readonly callerAmr: string | null;
  /** The JSON column, round-tripped. Also normalised into `audit_call_role`. */
  readonly callerRoles: readonly string[];
  readonly onBehalfOf: string | null;

  // -- who, Phase 5 (02 §11.3)
  readonly consumerId: string;
  readonly consumerRecordSha: string | null;
  readonly consumerAuthMethod: string | null;
  readonly consumerSessionId: string | null;
  readonly humanInTheLoop: boolean;

  // -- what
  readonly toolId: string;
  readonly toolVersion: string | null;
  readonly manifestSha: string | null;
  readonly serverId: string | null;
  readonly packageId: string | null;
  readonly bindingType: string | null;
  readonly archetype: string | null;
  readonly verb: string | null;
  readonly entity: string | null;
  readonly sensitivityClass: string | null;
  readonly isWrite: boolean;

  // -- where
  readonly targetSystem: string | null;
  readonly targetEnv: string | null;
  readonly targetObject: string | null;
  readonly deploymentId: string;
  readonly gatewayVersion: string | null;
  readonly bundleVersion: string | null;

  // -- phase
  readonly phase: AuditPhase;
  readonly confirmTokenHash: string | null;
  readonly planHash: string | null;
  readonly argsHash: string | null;
  readonly idempotencyKey: string | null;
  readonly replayed: boolean | null;

  // -- inputs and outputs
  readonly argsRedacted: unknown;
  readonly resultKeys: readonly AuditResultKey[];
  readonly rowCount: number | null;
  readonly bytesOut: number | null;

  // -- outcome
  readonly outcome: AuditOutcome;
  readonly errorCode: string | null;
  readonly errorMessageAgent: string | null;
  readonly deniedByRule: string | null;

  // -- identity honesty
  readonly identityCarrying: boolean | null;
  readonly targetIdentityObserved: string | null;
  readonly identityMatch: boolean | null;
  readonly compensatingControl: CompensatingControl | null;

  // -- reversal (02 §3.1.4)
  readonly reversalClass: string | null;
  /** The reversing tool id, frozen from the manifest at execute time (W0-F5). */
  readonly reversalToolId: string | null;
  readonly reversesCallId: string | null;
  /**
   * RESOLVED, never stored — `audit_call` is append-only, so the original row
   * cannot be rewritten when its reversal arrives. `get()` and `reversalLinks()`
   * fill this from the `reverses_call_id` index; `listChain()` and the hash walk
   * deliberately do not, because they read the stored row verbatim.
   */
  readonly reversedByCallId: string | null;

  // -- performance
  readonly latencyMsTotal: number | null;
  readonly latencyMsGateway: number | null;
  readonly latencyMsTarget: number | null;

  // -- integrity (02 §4.6; on SQLite detectable, not preventable — ./hash.ts)
  readonly prevHash: string;
  readonly rowHash: string;

  // -- satellite (02 §11.3)
  readonly credentialRefs: readonly AuditCredentialRef[];
}

/**
 * What a caller supplies. `id`, `prevHash` and `rowHash` are never supplied —
 * the repository computes all three, because a caller-supplied hash would be a
 * caller-forgeable chain.
 */
export interface AppendAuditCallInput {
  /** Injectable clock, so tests do not depend on wall time. Defaults to now. */
  readonly ts?: string;
  readonly correlationId?: string;
  readonly sessionId?: string;
  readonly parentCallId?: string;

  readonly callerSubject: string;
  readonly callerDisplay?: string;
  readonly callerIdp?: string;
  readonly callerAmr?: string;
  readonly callerRoles?: readonly string[];
  readonly onBehalfOf?: string;

  readonly consumerId: string;
  readonly consumerRecordSha?: string;
  readonly consumerAuthMethod?: string;
  readonly consumerSessionId?: string;
  readonly humanInTheLoop: boolean;

  readonly toolId: string;
  readonly toolVersion?: string;
  readonly manifestSha?: string;
  readonly serverId?: string;
  readonly packageId?: string;
  readonly bindingType?: string;
  readonly archetype?: string;
  readonly verb?: string;
  readonly entity?: string;
  readonly sensitivityClass?: string;
  readonly isWrite: boolean;

  readonly targetSystem?: string;
  readonly targetEnv?: string;
  readonly targetObject?: string;
  readonly deploymentId: string;
  readonly gatewayVersion?: string;
  readonly bundleVersion?: string;

  readonly phase: AuditPhase;
  readonly confirmTokenHash?: string;
  readonly planHash?: string;
  readonly argsHash?: string;
  readonly idempotencyKey?: string;
  readonly replayed?: boolean;

  readonly argsRedacted?: unknown;
  readonly resultKeys?: readonly AuditResultKey[];
  readonly rowCount?: number;
  readonly bytesOut?: number;

  readonly outcome: AuditOutcome;
  readonly errorCode?: string;
  readonly errorMessageAgent?: string;
  readonly deniedByRule?: string;

  readonly identityCarrying?: boolean;
  readonly targetIdentityObserved?: string;
  readonly identityMatch?: boolean;
  readonly compensatingControl?: CompensatingControl;

  readonly reversalClass?: string;
  readonly reversalToolId?: string;
  readonly reversesCallId?: string;
  /**
   * Accepted for completeness of the column set, but the write path never
   * supplies it: at the moment a call is appended its reversal does not exist
   * yet, and the row can never be updated afterwards. See `reversalLinks`.
   */
  readonly reversedByCallId?: string;

  readonly latencyMsTotal?: number;
  readonly latencyMsGateway?: number;
  readonly latencyMsTarget?: number;

  readonly credentialRefs?: readonly AuditCredentialRef[];
}

/**
 * Both ends of one reversal edge (03 §7.5: "a reversal that is invisible from
 * the original call is a broken audit story").
 */
export interface AuditReversalLinks {
  readonly callId: string;
  /** The call THIS call reverses, when this row is itself a reversal. */
  readonly reversesCallId: string | null;
  /** The call that reversed THIS one, resolved from the index. */
  readonly reversedByCallId: string | null;
}

/**
 * The audit repository. Append and read only — there is no `update` and no
 * `delete` on this interface, and that absence is deliberate: the type system
 * is the first of the layers that keep the trail append-only, ahead of the
 * triggers and ahead of the hash chain. Retention (W0-C4) is the single
 * exception and reaches the store through its own gated path, not through
 * here.
 */
export interface AuditRepository {
  /**
   * Write one audit row and all of its satellites **inside one transaction**,
   * computing `prev_hash` from the deployment's current chain head and
   * `row_hash` over the row's own content.
   */
  append(input: AppendAuditCallInput): Promise<AuditCallRecord>;
  get(id: string): Promise<AuditCallRecord | undefined>;
  /** The current chain head for a deployment, or undefined before genesis. */
  chainHead(deploymentId: string): Promise<AuditCallRecord | undefined>;
  /** Chain order — oldest first — for `forge audit verify` (W0-C4). */
  listChain(deploymentId: string, limit?: number): Promise<AuditCallRecord[]>;
  /**
   * 02 §4.6 query 2 — "who created document 12345". One indexed hop on
   * `audit_result_key (key_value, key_name)`.
   */
  listByResultKey(keyName: string, keyValue: string): Promise<AuditCallRecord[]>;
  /**
   * 02 §11.3 — "which calls used this credential version". One indexed hop on
   * `audit_credential_ref (secret_ref, version)`. Omit `version` for every
   * version of the reference.
   */
  listByCredentialRef(secretRef: string, version?: string): Promise<AuditCallRecord[]>;
  /** Membership query over the `audit_call_role` side table (02 §10.4 item 3). */
  listByRole(roleId: string): Promise<AuditCallRecord[]>;
  /**
   * W0-F5, 02 §3.1.4 / 03 §7.5 — the reversal link, in BOTH directions, for one
   * call. `reversesCallId` is read from the row; `reversedByCallId` is resolved
   * from the `reverses_call_id` index, because an append-only table cannot have
   * the original row rewritten when its reversal lands.
   *
   * Returns `undefined` when the call id is not in the store.
   */
  reversalLinks(callId: string): Promise<AuditReversalLinks | undefined>;
  /**
   * Every deployment that has ever written a row — what `forge audit verify`
   * iterates when it is given no `--deployment` (W0-C4).
   */
  listDeployments(): Promise<string[]>;
  /**
   * Re-walk one deployment's chain and report the FIRST break, if any
   * (02 §4.6). Read-only, and it lives here rather than in the CLI because the
   * recomputation has to run over the raw stored columns, which never leave
   * `core/gateway/store/`. See `./verify.ts`.
   */
  verifyChain(deploymentId: string): Promise<AuditChainVerification>;
}
