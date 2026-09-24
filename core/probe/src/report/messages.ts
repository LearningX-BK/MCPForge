// MCPForge — `remediation` (human) and `agentMessage` (agent) for every status.
// 02 §4.5. W0-H4.
//
// Same discipline as non-negotiable #5's `next`: never "try again", always a
// named action and a named owner. Different surface, identical rule — the probe
// report is what the portal's enablement backlog and `forge.find`'s disabled-tool
// card are rendered from, so an empty string here becomes a dead end for a human
// and for an agent at the same time.
//
// Both strings are built from the FAILING CHECK, so they name the specific
// thing that failed rather than restating the status.

import type { ProbeStatus } from '../status.js';
import type { ProbeCheckResult } from '../plan/types.js';

export interface MessageInput {
  readonly toolId: string;
  readonly status: ProbeStatus;
  readonly owningTeam: string;
  /** The check whose failure selected this status; `null` only for `resolved`. */
  readonly failingCheck: ProbeCheckResult | null;
  /** The check's `describe` text, for the human-facing half. */
  readonly failingCheckDescription: string | null;
}

function failureClause(input: MessageInput): string {
  if (input.failingCheck === null) return 'no check failed';
  const described = input.failingCheckDescription ?? input.failingCheck.name;
  return `check "${input.failingCheck.name}" (${described}) failed: ${input.failingCheck.detail}`;
}

export function remediationFor(input: MessageInput): string {
  const owner = input.owningTeam;
  const clause = failureClause(input);
  switch (input.status) {
    case 'resolved':
      return `No action needed. Every probe check for ${input.toolId} passed. Owner: ${owner}.`;
    case 'degraded_readonly':
      return `${input.toolId} is available for reads only — ${clause}. Restore the write path (the dry-run sibling or the commit classification named above) or re-scope this tool to read-only. Owner: ${owner}.`;
    case 'disabled_missing_binding':
      return `${input.toolId} has no working binding — ${clause}. Deploy or repair the target object named in binding.ref, then re-run \`forge probe\`. Owner: ${owner}.`;
    case 'disabled_no_grant':
      return `${input.toolId} is missing a grant — ${clause}. Issue the grant through an approval record in approvals/ (a bindingGrant is named, expiring and approved — never widened in place), then re-run \`forge probe\`. Owner: ${owner}.`;
    case 'disabled_identity_unverified':
      return `${input.toolId} could not prove it carries the caller's identity — ${clause}. Configure the target's identity propagation for this binding, or re-scope this tool to read-only. Owner: ${owner}.`;
    case 'disabled_schema_drift':
      return `${input.toolId} has drifted from its manifest — ${clause}. Reconcile the manifest with the target (a version or shape change is a major bump and needs a fresh approval record), then re-run \`forge probe\`. Owner: ${owner}.`;
    case 'disabled_kill_switch':
      return `${input.toolId} is kill-switched — ${clause}. Lift the flag with the reason recorded (\`forge kill\` wrote it; the portal Governance kill-switch tab shows it) once the underlying cause is resolved. Owner: ${owner}.`;
  }
}

export function agentMessageFor(input: MessageInput): string {
  const owner = input.owningTeam;
  switch (input.status) {
    case 'resolved':
      return `${input.toolId} is available. Call it directly.`;
    case 'degraded_readonly':
      return `${input.toolId} is available for reads only; its write path is disabled. Do not attempt a write with it. Use its read verbs, or ask ${owner} to enable writes.`;
    case 'disabled_missing_binding':
      return `This capability exists but is disabled: its binding is not present or not reachable. Do not retry; it will not succeed until ${owner} deploys it.`;
    case 'disabled_no_grant':
      return `This capability exists but is disabled: the required grant is not held. Do not retry; it will not succeed until ${owner} records an approved grant.`;
    case 'disabled_identity_unverified':
      return `This capability exists but is disabled: identity could not be verified for this binding. Do not retry; it will not succeed until ${owner} enables it.`;
    case 'disabled_schema_drift':
      return `This capability exists but is disabled: the target no longer matches the declared schema. Do not retry; it will not succeed until ${owner} reconciles the manifest.`;
    case 'disabled_kill_switch':
      return `This capability exists but is switched off by a kill switch. Do not retry; it will not succeed until ${owner} lifts the flag.`;
  }
}
