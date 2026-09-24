// MCPForge — one status vocabulary, two products. 03 §13.5.
//
// This file is the single place the human-facing label, the accessible
// (screen-reader) label, the semantic colour token and the icon name are
// defined for every closed enum in the system. The portal's chip family
// (W0-J5) and the `forge` CLI's human-mode rendering both read from here —
// a status that meant one thing in the portal and another in
// `forge audit --json` would erode trust in both (03 §13.5).
//
// `token` is always one of the six semantic status roles defined in
// `core/portal/src/design/tokens.semantic.css` (03 §4.4 "the meaning map"):
// status-read · status-ok · status-write · status-platform · status-neutral ·
// status-danger. This file does not invent a parallel vocabulary.
//
// `icon` names a `lucide-react` icon (03 §5.2's nav section: "use a real
// icon set (lucide-react, which ships with shadcn) rather than glyph
// characters"). shadcn/lucide is not vendored into the repo until W0-J4;
// this file only names the icon, it does not import the package.

import type { BindingType, Verb } from './manifest/common.js';
import type { ReversalClass } from './manifest/tool.js';
import type { ErrorCode } from './errors/codes.js';

/** One of the six semantic status colour roles (tokens.semantic.css). */
export type StatusToken =
  | 'status-read'
  | 'status-ok'
  | 'status-write'
  | 'status-platform'
  | 'status-neutral'
  | 'status-danger';

export interface StatusEntry {
  readonly token: StatusToken;
  /** Human-facing label, rendered on-screen and in CLI human mode. */
  readonly label: string;
  /** Screen-reader / accessible label. Never empty (accessibility requirement). */
  readonly srLabel: string;
  /** A `lucide-react` icon name. */
  readonly icon: string;
}

// ---------------------------------------------------------------------------
// PROBE_STATUS — the 7-member closed enum, W0-H4's `done:` criterion / 02 §4.5.
// ---------------------------------------------------------------------------

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

export const PROBE_STATUS: Readonly<Record<ProbeStatus, StatusEntry>> = {
  resolved: {
    token: 'status-ok',
    label: 'Resolved',
    srLabel: 'Probe status: resolved. This tool is callable.',
    icon: 'CircleCheck',
  },
  degraded_readonly: {
    token: 'status-write',
    label: 'Degraded (read-only)',
    srLabel: 'Probe status: degraded. Read-only; writes are disabled for this binding.',
    icon: 'TriangleAlert',
  },
  disabled_missing_binding: {
    token: 'status-danger',
    label: 'Disabled — missing binding',
    srLabel: 'Probe status: disabled. The binding executor for this tool is absent.',
    icon: 'CircleOff',
  },
  disabled_no_grant: {
    token: 'status-danger',
    label: 'Disabled — no grant',
    srLabel: 'Probe status: disabled. No elevated binding grant exists for this tool.',
    icon: 'ShieldOff',
  },
  disabled_identity_unverified: {
    token: 'status-danger',
    label: 'Disabled — identity unverified',
    srLabel: 'Probe status: disabled. Identity could not be verified for this binding.',
    icon: 'UserX',
  },
  disabled_schema_drift: {
    token: 'status-danger',
    label: 'Disabled — schema drift',
    srLabel: 'Probe status: disabled. The target schema no longer matches the manifest.',
    icon: 'GitCompareArrows',
  },
  disabled_kill_switch: {
    token: 'status-danger',
    label: 'Disabled — kill switch',
    srLabel: 'Probe status: disabled. A kill switch is active for this tool, server, binding type, consumer or deployment.',
    icon: 'Power',
  },
} as const;

// ---------------------------------------------------------------------------
// CHANGE_STATE — 03 §6.1's state machine.
//
// NEEDS_HUMAN, flagged rather than silently resolved (CLAUDE.md §8): 03 §6.1's
// diagram draws `WITHDRAWN` as a reachable terminal state (from IN REVIEW,
// alongside INVALID), but 03 §6.1's own state table and 03 §8's summary list
// ("draft · validating · invalid · in review · changes requested · approved ·
// merged · deployed") both omit it. That is a contradiction inside one
// document, not a silent gap, and it has schema blast radius — every
// consumer of `changeState` must agree on its member count. `WITHDRAWN` is
// included below because the diagram is the more precise artefact (it shows
// the transition, the table only lists rest-states) and because a
// git-PR-backed change model needs a closed state for "PR closed without
// merging" or `CHANGE_STATE` cannot represent that real, common event.
// A human owner should confirm this reading against 03 §6.1 and either
// amend the table/summary to include WITHDRAWN or strike it from the
// diagram.
// ---------------------------------------------------------------------------

export const CHANGE_STATES = [
  'draft',
  'validating',
  'invalid',
  'in_review',
  'changes_requested',
  'approved',
  'merged',
  'deployed',
  'withdrawn',
] as const;
export type ChangeState = (typeof CHANGE_STATES)[number];

export const CHANGE_STATE: Readonly<Record<ChangeState, StatusEntry>> = {
  draft: {
    token: 'status-neutral',
    label: 'Draft',
    srLabel: 'Change state: draft. Committed to a working branch, no pull request yet.',
    icon: 'FilePen',
  },
  validating: {
    token: 'status-neutral',
    label: 'Validating',
    srLabel: 'Change state: validating. CI is running forge validate, codegen and the budget gates.',
    icon: 'Loader',
  },
  invalid: {
    token: 'status-danger',
    label: 'Invalid',
    srLabel: 'Change state: invalid. A validate rule or a budget gate failed.',
    icon: 'CircleX',
  },
  in_review: {
    token: 'status-write',
    label: 'In review',
    srLabel: 'Change state: in review. A pull request is open.',
    icon: 'GitPullRequest',
  },
  changes_requested: {
    token: 'status-write',
    label: 'Changes requested',
    srLabel: 'Change state: changes requested. A reviewer asked for changes.',
    icon: 'MessageSquareWarning',
  },
  approved: {
    token: 'status-ok',
    label: 'Approved',
    srLabel: 'Change state: approved. Approved but not yet merged.',
    icon: 'BadgeCheck',
  },
  merged: {
    token: 'status-ok',
    label: 'Merged',
    srLabel: 'Change state: merged. In the main branch.',
    icon: 'GitMerge',
  },
  deployed: {
    token: 'status-ok',
    label: 'Deployed',
    srLabel: 'Change state: deployed. In the running catalogue artefact; see the probe status for whether it is callable.',
    icon: 'Rocket',
  },
  withdrawn: {
    token: 'status-neutral',
    label: 'Withdrawn',
    srLabel: 'Change state: withdrawn. The pull request was closed without merging.',
    icon: 'Archive',
  },
} as const;

// ---------------------------------------------------------------------------
// BINDING_TYPE — the five handshakes. 02 §3.7 / core/shared/src/manifest/common.ts.
// ---------------------------------------------------------------------------

export const BINDING_TYPE: Readonly<Record<BindingType, StatusEntry>> = {
  rest: {
    token: 'status-read',
    label: 'REST',
    srLabel: 'Binding type: REST / OAuth. Identity carries end to end natively.',
    icon: 'Globe',
  },
  database: {
    token: 'status-platform',
    label: 'DB / SQL',
    srLabel: 'Binding type: database. Read-only by policy; identity does not carry natively.',
    icon: 'Database',
  },
  plsql: {
    token: 'status-write',
    label: 'PL/SQL',
    srLabel:
      'Binding type: PL/SQL package. Identity does not carry natively; wrapper-schema attribution only. Elevated posture.',
    icon: 'Package',
  },
  function: {
    token: 'status-neutral',
    label: 'Function',
    srLabel: 'Binding type: function / orchestration script. Elevated posture.',
    icon: 'FunctionSquare',
  },
  'wrapped-vendor': {
    token: 'status-ok',
    label: 'Wrapped',
    srLabel: 'Binding type: wrapped vendor MCP server.',
    icon: 'Boxes',
  },
} as const;

// ---------------------------------------------------------------------------
// CALL_PHASE — 02 §4.6's audit `phase` column: plan | execute | reject | reverse.
// ---------------------------------------------------------------------------

export const CALL_PHASES = ['plan', 'execute', 'reject', 'reverse'] as const;
export type CallPhase = (typeof CALL_PHASES)[number];

export const CALL_PHASE: Readonly<Record<CallPhase, StatusEntry>> = {
  plan: {
    token: 'status-read',
    label: 'Plan',
    srLabel: 'Call phase: plan. A dry-run plan was produced; no target action was taken.',
    icon: 'FileText',
  },
  execute: {
    token: 'status-write',
    label: 'Execute',
    srLabel: 'Call phase: execute. The confirmed call reached the target system.',
    icon: 'Play',
  },
  reject: {
    token: 'status-danger',
    label: 'Reject',
    srLabel: 'Call phase: reject. The call was refused before reaching the target system.',
    icon: 'CircleSlash',
  },
  reverse: {
    token: 'status-platform',
    label: 'Reverse',
    srLabel: 'Call phase: reverse. This call reverses an earlier execute.',
    icon: 'Undo2',
  },
} as const;

// ---------------------------------------------------------------------------
// CALL_OUTCOME — 02 §4.6's audit `outcome` column.
// ---------------------------------------------------------------------------

export const CALL_OUTCOMES = [
  'ok',
  'business_error',
  'policy_denied',
  'binding_error',
  'timeout',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME: Readonly<Record<CallOutcome, StatusEntry>> = {
  ok: {
    token: 'status-ok',
    label: 'OK',
    srLabel: 'Call outcome: ok. The call completed successfully.',
    icon: 'CircleCheck',
  },
  business_error: {
    token: 'status-write',
    label: 'Business error',
    srLabel: 'Call outcome: business error. The target system returned an application-level error.',
    icon: 'TriangleAlert',
  },
  policy_denied: {
    token: 'status-danger',
    label: 'Policy denied',
    srLabel: 'Call outcome: policy denied. A policy-chain rule refused this call.',
    icon: 'ShieldOff',
  },
  binding_error: {
    token: 'status-danger',
    label: 'Binding error',
    srLabel: 'Call outcome: binding error. The binding executor failed.',
    icon: 'PlugZap',
  },
  timeout: {
    token: 'status-danger',
    label: 'Timeout',
    srLabel: 'Call outcome: timeout. The target exceeded its declared timeout; the outcome is unknown.',
    icon: 'Clock',
  },
} as const;

// ---------------------------------------------------------------------------
// ERROR_CODE — the closed 21-code taxonomy, core/shared/src/errors/codes.ts (W0-A4).
// ---------------------------------------------------------------------------

export const ERROR_CODE: Readonly<Record<ErrorCode, StatusEntry>> = {
  INPUT_INVALID: {
    token: 'status-danger',
    label: 'Invalid input',
    srLabel: 'Error: invalid input. Arguments failed the tool schema.',
    icon: 'CircleAlert',
  },
  AUTH_REQUIRED: {
    token: 'status-danger',
    label: 'Authentication required',
    srLabel: 'Error: authentication required. The session presented no valid authentication.',
    icon: 'LogIn',
  },
  IDENTITY_UNRESOLVED: {
    token: 'status-danger',
    label: 'Identity unresolved',
    srLabel: 'Error: identity unresolved. No target-identity mapping exists for this subject. There is no fallback.',
    icon: 'UserX',
  },
  TOOL_NOT_IN_SCOPE: {
    token: 'status-danger',
    label: 'Not in scope',
    srLabel: 'Error: tool not in scope. The tool is not in the resolved scope of any role you hold.',
    icon: 'Ban',
  },
  TOOL_DISABLED: {
    token: 'status-danger',
    label: 'Tool disabled',
    srLabel: 'Error: tool disabled. The tool is kill-switched, or the probe reports it unresolved.',
    icon: 'Power',
  },
  POLICY_GUARDRAIL_BREACH: {
    token: 'status-danger',
    label: 'Guardrail breach',
    srLabel: 'Error: policy guardrail breach. A declared guardrail refused the call.',
    icon: 'ShieldAlert',
  },
  APPROVAL_REQUIRED: {
    token: 'status-write',
    label: 'Approval required',
    srLabel: 'Error: approval required. The write requires an out-of-band human approval before a confirm token is minted.',
    icon: 'UserCheck',
  },
  PLAN_REQUIRED: {
    token: 'status-write',
    label: 'Plan required',
    srLabel: 'Error: plan required. A write tool was called without a confirm token.',
    icon: 'FileText',
  },
  PLAN_EXPIRED: {
    token: 'status-write',
    label: 'Plan expired',
    srLabel: 'Error: plan expired. The confirm token is past its TTL.',
    icon: 'TimerOff',
  },
  PLAN_ARGUMENT_MISMATCH: {
    token: 'status-danger',
    label: 'Plan argument mismatch',
    srLabel: 'Error: plan argument mismatch. The arguments do not match the canonical argument hash the confirm token was bound to.',
    icon: 'FileWarning',
  },
  TARGET_PRECONDITION_FAILED: {
    token: 'status-write',
    label: 'Precondition failed',
    srLabel: 'Error: target precondition failed. The target system refused because a business precondition does not hold.',
    icon: 'ListChecks',
  },
  TARGET_ERROR: {
    token: 'status-danger',
    label: 'Target error',
    srLabel: 'Error: target error. The target system returned an application error.',
    icon: 'ServerCrash',
  },
  TARGET_TIMEOUT: {
    token: 'status-danger',
    label: 'Target timeout',
    srLabel: 'Error: target timeout. The target exceeded its declared timeout; the outcome is unknown.',
    icon: 'Clock',
  },
  TARGET_UNAVAILABLE: {
    token: 'status-danger',
    label: 'Target unavailable',
    srLabel: 'Error: target unavailable. The target system is unreachable or refusing connections.',
    icon: 'CloudOff',
  },
  ROW_CAP_EXCEEDED: {
    token: 'status-write',
    label: 'Row cap exceeded',
    srLabel: 'Error: row cap exceeded. The result set exceeded the mandatory row cap for this binding.',
    icon: 'Rows3',
  },
  RATE_LIMITED: {
    token: 'status-write',
    label: 'Rate limited',
    srLabel: 'Error: rate limited. The consumer or session exceeded its declared calls or writes limit for the window.',
    icon: 'Gauge',
  },
  INTERNAL: {
    token: 'status-danger',
    label: 'Internal error',
    srLabel: 'Error: internal error. MCPForge itself failed. No target action was attempted.',
    icon: 'Bug',
  },
  CONSUMER_UNREGISTERED: {
    token: 'status-danger',
    label: 'Consumer unregistered',
    srLabel: 'Error: consumer unregistered. The presenting consumer has no registration record, or none matching its credential.',
    icon: 'UserRoundX',
  },
  CONSUMER_SUSPENDED: {
    token: 'status-danger',
    label: 'Consumer suspended',
    srLabel: 'Error: consumer suspended. The consumer is registered but currently suspended, expired or retired.',
    icon: 'UserRoundMinus',
  },
  CONSUMER_NOT_AUTHORIZED: {
    token: 'status-danger',
    label: 'Consumer not authorized',
    srLabel: "Error: consumer not authorized. The consumer's own declared authorizations do not permit this call.",
    icon: 'ShieldOff',
  },
  ELEVATED_GRANT_REQUIRED: {
    token: 'status-write',
    label: 'Elevated grant required',
    srLabel: "Error: elevated grant required. The tool is elevated posture and the caller's role or consumer holds no binding grant for it.",
    icon: 'KeyRound',
  },
} as const;

// ---------------------------------------------------------------------------
// REVERSAL_CLASS — the closed 4-member registry. 02 §3.1.4.
// ---------------------------------------------------------------------------

export const REVERSAL_CLASS: Readonly<Record<ReversalClass, StatusEntry>> = {
  'native-reverse': {
    token: 'status-ok',
    label: 'Native reverse',
    srLabel: 'Reversal class: native reverse. The target system has a first-class reversal for this exact operation.',
    icon: 'RotateCcw',
  },
  'compensating-tool': {
    token: 'status-platform',
    label: 'Compensating tool',
    srLabel: 'Reversal class: compensating tool. Reversal is a different tool in the catalogue, with a stated window and preconditions.',
    icon: 'Wrench',
  },
  transactional: {
    token: 'status-read',
    label: 'Transactional',
    srLabel: 'Reversal class: transactional. The whole unit of work is one transaction the wrapper controls and can roll back before commit.',
    icon: 'Undo2',
  },
  irreversible: {
    token: 'status-danger',
    label: 'Irreversible',
    srLabel: 'Reversal class: irreversible. No reversal exists. This cannot be undone.',
    icon: 'TriangleAlert',
  },
} as const;

// ---------------------------------------------------------------------------
// VERB — the closed 19-item verb list. CLAUDE.md §5 / core/shared/src/manifest/common.ts.
// ---------------------------------------------------------------------------

const READ_VERBS = new Set<Verb>([
  'search',
  'get',
  'list',
  'get_status',
  'get_receipt_status',
  'get_approval_status',
  'download',
  'simulate',
  'reconcile',
  'explain',
  'resolve',
]);

function verbEntry(verb: Verb, label: string, icon: string): StatusEntry {
  const isRead = READ_VERBS.has(verb);
  return {
    token: isRead ? 'status-read' : 'status-write',
    label,
    srLabel: `Verb: ${label}. ${isRead ? 'Read.' : 'Write.'}`,
    icon,
  };
}

export const VERB: Readonly<Record<Verb, StatusEntry>> = {
  search: verbEntry('search', 'Search', 'Search'),
  get: verbEntry('get', 'Get', 'FileSearch'),
  list: verbEntry('list', 'List', 'List'),
  create: verbEntry('create', 'Create', 'Plus'),
  update: verbEntry('update', 'Update', 'Pencil'),
  cancel: verbEntry('cancel', 'Cancel', 'CircleSlash'),
  submit: verbEntry('submit', 'Submit', 'Send'),
  approve: verbEntry('approve', 'Approve', 'BadgeCheck'),
  release: verbEntry('release', 'Release', 'Unlock'),
  run_report: verbEntry('run_report', 'Run report', 'FileBarChart'),
  run_process: verbEntry('run_process', 'Run process', 'PlayCircle'),
  get_status: verbEntry('get_status', 'Get status', 'CircleDot'),
  get_receipt_status: verbEntry('get_receipt_status', 'Get receipt status', 'PackageCheck'),
  get_approval_status: verbEntry('get_approval_status', 'Get approval status', 'ClipboardCheck'),
  download: verbEntry('download', 'Download', 'Download'),
  simulate: verbEntry('simulate', 'Simulate', 'FlaskConical'),
  reconcile: verbEntry('reconcile', 'Reconcile', 'Scale'),
  explain: verbEntry('explain', 'Explain', 'MessageCircleQuestion'),
  resolve: verbEntry('resolve', 'Resolve', 'CheckCheck'),
} as const;

// ---------------------------------------------------------------------------
// ENV_CLASS — the four-member closed enum, 03 §11.1 / 02 §7.1. Added for
// W0-J5's `EnvChip` so the portal's environment chip and any future CLI
// environment banner read one vocabulary, same discipline as every other
// entry in this file. `prod`'s `token` intentionally does not distinguish
// "filled" from "outline" treatment — that is a rendering choice the chip
// component makes per 03 §11.1's table (prod is the only class filled),
// not a status-vocabulary concern.
// ---------------------------------------------------------------------------

export const ENV_CLASSES = ['local', 'probe', 'staging', 'prod'] as const;
export type EnvClass = (typeof ENV_CLASSES)[number];

export const ENV_CLASS: Readonly<Record<EnvClass, StatusEntry>> = {
  local: {
    token: 'status-platform',
    label: 'Local dev',
    srLabel: 'Environment: local dev.',
    icon: 'Laptop',
  },
  probe: {
    token: 'status-read',
    label: 'Probe',
    srLabel: 'Environment: probe. Destructive classification checks run here.',
    icon: 'Radar',
  },
  staging: {
    token: 'status-write',
    label: 'Staging',
    srLabel: 'Environment: staging.',
    icon: 'FlaskConical',
  },
  prod: {
    token: 'status-danger',
    label: 'Production',
    srLabel: 'Environment: production.',
    icon: 'ServerCog',
  },
} as const;

// NOTE: `BINDING_TYPES`, `VERBS` and `ERROR_CODES` are already exported by
// `./manifest/index.js` and `./errors/index.js` respectively (re-exported by
// `./index.js`) and stay the single source of truth for membership — this
// file does not re-export or fork those lists, only maps them.
