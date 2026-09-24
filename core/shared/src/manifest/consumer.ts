// MCPForge — `kind: Consumer`. Field-for-field with the worked example at
// 02 §11.2. The consumer record is a git artefact BECAUSE it is a grant.
//
// Authorization is the INTERSECTION of what the consumer may do and what the
// human may do — never the union, never a substitute (CLAUDE.md #6).

import type {
  BindingType,
  IsoDate,
  ManifestBase,
  SecretRef,
  Sensitivity,
  ToolId,
} from './common.js';
import type { BindingGrant } from './role.js';

export const CONSUMER_CLASSES = [
  'interactive-client',
  'autonomous-agent',
  'batch-service',
  'portal',
] as const;
export type ConsumerClass = (typeof CONSUMER_CLASSES)[number];

export const CONSUMER_STATUSES = ['active', 'suspended', 'retired'] as const;
export type ConsumerStatus = (typeof CONSUMER_STATUSES)[number];

export const CONSUMER_CREDENTIAL_METHODS = ['mtls', 'private-key-jwt', 'client-secret'] as const;
export type ConsumerCredentialMethod = (typeof CONSUMER_CREDENTIAL_METHODS)[number];

export interface RotationPolicy {
  readonly intervalDays: number;
  readonly lastRotatedAt: IsoDate;
}

export interface ConsumerCredential {
  readonly method: ConsumerCredentialMethod;
  /** A REFERENCE. Never a value. Ever. (02 §11.5) */
  readonly ref: SecretRef;
  /** Which identity issuers this consumer may present user tokens from. */
  readonly boundIssuers: readonly string[];
  readonly rotation: RotationPolicy;
}

export interface ConsumerAuthorizations {
  /** The Phase 5 gate — 02 §11.4. */
  readonly bindingTypes: readonly BindingType[];
  /** Intersects with the role's `sensitivityCeiling`. */
  readonly maxSensitivity: Sensitivity;
  /** Independent of, and intersected with, the human's role. */
  readonly writeAllowed: boolean;
  /** May act only within these roles even if the human holds more. */
  readonly roles: readonly string[];
  readonly packages: readonly string[];
}

export interface ConsumerLimits {
  readonly callsPerMinute: number;
  readonly writesPerDay: number;
  readonly concurrentSessions: number;
  /** Absent = 24/7, with a stated reason (02 §11.2). */
  readonly operatingWindow?: string;
}

export interface ConsumerAttestation {
  /** Optional CIDR or mTLS SAN pin. */
  readonly networkOrigins?: readonly string[];
  /**
   * Has teeth: `false` forces `humanApprovalRequired: true` on every write this
   * consumer attempts, regardless of the tool's own setting (02 §11.2).
   */
  readonly humanInTheLoop: boolean;
}

export interface ConsumerManifest extends ManifestBase<'Consumer'> {
  readonly label: string;
  readonly class: ConsumerClass;
  /** Accountable team; a named human is required at review. */
  readonly owner: string;
  readonly steward: string;
  readonly status: ConsumerStatus;
  /** Registrations EXPIRE. Renewal is a re-approval, not a no-op (02 §11.2). */
  readonly expiresAt: IsoDate;
  readonly credential: ConsumerCredential;
  readonly authorizations: ConsumerAuthorizations;
  readonly limits: ConsumerLimits;
  readonly attestation: ConsumerAttestation;
  /** Optional on the consumer as well as the role (02 §11.4). */
  readonly bindingGrants?: readonly BindingGrant[];
}

/**
 * 02 §11.3 — `ConsumerAuthorized`, the sixth term of the visibility
 * intersection, stated as a type so the gateway's predicate has one name.
 * The predicate itself lives in core/gateway/scope/** (W0-D-series).
 */
export interface ConsumerAuthorizedInput {
  readonly toolId: ToolId;
  readonly bindingType: BindingType;
  readonly sensitivity: Sensitivity;
  readonly write: boolean;
  readonly roles: readonly string[];
  readonly packages: readonly string[];
}
