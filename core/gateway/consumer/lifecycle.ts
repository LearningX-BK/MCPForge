// MCPForge — consumer registration and lifecycle, as change proposals. W0-N1.
//
// Every function here is PURE: it returns the proposal content. Nothing here
// touches the filesystem; `proposal.ts` stages it, and neither writes to
// `consumers/**` or `approvals/**` (02 §11.2, 05 §1.3.2).
//
// Lifecycle acts, and what each proposes:
//   new      — a new consumers/<id>.consumer.yaml + its approval record
//   suspend  — status: active   -> suspended   (+ approval record)
//   retire   — status: *        -> retired     (+ approval record)
//   rotate   — credential.rotation.lastRotatedAt := today (+ approval record)
//
// `rotate` moves the SCHEDULE, in git, and nothing else: the value itself
// lives in the secret store and never in the record (CLAUDE.md #8). Minting
// the new value is `forge consumer issue-credential`, and rotating a
// non-consumer secret is `forge secrets rotate` (W0-N5).
//
// Retire, not delete: a consumer id is immutable because audit rows and
// consumption edges reference it (CLAUDE.md §5). Renaming is a
// retire-and-register pair, both recorded — so nothing here removes a record.

import { stringify as stringifyYaml } from 'yaml';
import { buildApprovalRecord, approvalRecordPath, type ApprovalAction } from './approval.js';
import type { ChangeProposal, ConsumerChangeKind, ProposedFile } from './proposal.js';
import {
  consumerCredentialRef,
  consumerRecordPath,
  consumerRecordSchema,
  isoToday,
  type ConsumerClass,
  type ConsumerRecord,
} from './types.js';

/** 02 §11.5 rule 5 — consumer client credentials rotate at 90 days. */
export const CONSUMER_CREDENTIAL_ROTATION_DAYS = 90;
/** A registration EXPIRES; renewal is a re-approval. One year unless stated. */
export const DEFAULT_REGISTRATION_DAYS = 365;

export interface ScaffoldConsumerInput {
  readonly id: string;
  readonly consumerClass: ConsumerClass;
  readonly label: string;
  /** The accountable team. Never defaulted — a named human is required at review. */
  readonly owner: string;
  readonly steward: string;
  /**
   * Stated, never merely absent: `false` forces `humanApprovalRequired: true`
   * on every write this consumer attempts (02 §11.2). A default would be an
   * assertion about a human that nobody made.
   */
  readonly humanInTheLoop: boolean;
  readonly expiresAt?: string;
  readonly today?: string;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The scaffolded record. Every authorization starts EMPTY and every ceiling
 * starts at its narrowest: a scaffold that granted anything by default would
 * make the first registration the one grant nobody reviewed. Widening it is
 * then a visible diff in the change proposal, which is the whole point of the
 * record being a git artefact.
 */
export function scaffoldConsumerRecord(input: ScaffoldConsumerInput): ConsumerRecord {
  const today = input.today ?? isoToday();
  const record: ConsumerRecord = {
    apiVersion: 'mcpforge/v1',
    kind: 'Consumer',
    id: input.id,
    label: input.label,
    class: input.consumerClass,
    owner: input.owner,
    steward: input.steward,
    status: 'active',
    expiresAt: input.expiresAt ?? addDays(today, DEFAULT_REGISTRATION_DAYS),
    credential: {
      method: 'private-key-jwt',
      ref: consumerCredentialRef(input.id),
      boundIssuers: ['local'],
      rotation: { intervalDays: CONSUMER_CREDENTIAL_ROTATION_DAYS, lastRotatedAt: today },
    },
    authorizations: {
      bindingTypes: [],
      maxSensitivity: 'public',
      writeAllowed: false,
      roles: [],
      packages: [],
    },
    limits: { callsPerMinute: 60, writesPerDay: 0, concurrentSessions: 1 },
    attestation: { humanInTheLoop: input.humanInTheLoop },
  };
  // Fail loudly here rather than staging a proposal `forge validate` will
  // reject after review has already been asked for.
  return consumerRecordSchema.parse(record);
}

/** Deterministic YAML: same input, same bytes, so a proposal diff is stable. */
export function renderConsumerRecord(record: ConsumerRecord): string {
  const header = [
    '# MCPForge consumer registration — a GRANT, and therefore a git artefact.',
    '# Changed only through the change-proposal -> approval -> merge flow (02 §11.2).',
    '# credential.ref is a REFERENCE. Never a value. Ever (CLAUDE.md #8).',
    '',
  ].join('\n');
  return `${header}${stringifyYaml(record, { lineWidth: 0 })}`;
}

export interface ProposalActor {
  /** `Principal.subject` of the requester. Required; there is no default identity. */
  readonly requestedBy: string;
  readonly reason?: string;
  readonly today?: string;
  readonly now?: string;
}

const KIND_BY_ACTION: Readonly<Record<ApprovalAction, ConsumerChangeKind>> = {
  register: 'consumer-registration',
  suspend: 'consumer-suspend',
  retire: 'consumer-retire',
  'rotate-credential-schedule': 'consumer-rotate',
};

function proposalId(action: ApprovalAction, consumerId: string, today: string): string {
  return `${today}-${KIND_BY_ACTION[action]}-${consumerId}`;
}

function build(
  action: ApprovalAction,
  record: ConsumerRecord,
  summary: string,
  actor: ProposalActor,
): ChangeProposal {
  const today = actor.today ?? isoToday();
  const requestedAt = actor.now ?? new Date().toISOString();
  const approval = buildApprovalRecord({
    action,
    consumerId: record.id,
    summary,
    requestedBy: actor.requestedBy,
    requestedAt,
    ...(actor.reason === undefined ? {} : { reason: actor.reason }),
    today,
  });
  const files: ProposedFile[] = [
    { path: consumerRecordPath(record.id), content: renderConsumerRecord(record) },
    { path: approvalRecordPath(approval.id), content: approval.content },
  ];
  return {
    id: proposalId(action, record.id, today),
    kind: KIND_BY_ACTION[action],
    consumerId: record.id,
    summary,
    requestedBy: actor.requestedBy,
    requestedAt,
    ...(actor.reason === undefined ? {} : { reason: actor.reason }),
    files,
  };
}

export function proposeRegistration(record: ConsumerRecord, actor: ProposalActor): ChangeProposal {
  return build(
    'register',
    record,
    `Register consumer ${record.id} (${record.class}) with no binding types, no roles, no packages and writeAllowed: false.`,
    actor,
  );
}

export function proposeSuspension(record: ConsumerRecord, actor: ProposalActor): ChangeProposal {
  return build(
    'suspend',
    { ...record, status: 'suspended' },
    `Suspend consumer ${record.id}. It is refused at session establishment and served no tools/list.`,
    actor,
  );
}

export function proposeRetirement(record: ConsumerRecord, actor: ProposalActor): ChangeProposal {
  return build(
    'retire',
    { ...record, status: 'retired' },
    `Retire consumer ${record.id}. The id is never reused — audit rows and consumption edges reference it.`,
    actor,
  );
}

export function proposeCredentialRotation(
  record: ConsumerRecord,
  actor: ProposalActor,
): ChangeProposal {
  const today = actor.today ?? isoToday();
  const rotated: ConsumerRecord = {
    ...record,
    credential: {
      ...record.credential,
      rotation: { ...record.credential.rotation, lastRotatedAt: today },
    },
  };
  return build(
    'rotate-credential-schedule',
    rotated,
    `Record a credential rotation for consumer ${record.id} on ${today} (next due in ${record.credential.rotation.intervalDays} days). The value itself is minted by "forge consumer issue-credential" and never appears in this record.`,
    { ...actor, today },
  );
}
