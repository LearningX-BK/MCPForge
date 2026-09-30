// MCPForge — W0-P5b: the portal's action gates, W0-P4 §3 and §9 decision 3.
//
// Pure and client-safe. The server actions call these and refuse on
// `allowed: false`, which is the enforcement. The UI calls the same functions
// to render a disabled control with its reason, never to hide a control or a
// page (03 §2: "it never hides a page").
//
// **Every gate takes the personas the viewer HOLDS, never the selected pill.**
// There is no parameter through which the pill could reach a decision, and
// that is what makes the pill a lens rather than an escalation (the
// "cannot widen a grant" test in gates.test.ts).
//
// The copy is W0-P4 §3's table. Every refusal carries a human-form `next`
// (non-negotiable 5).

import type { Persona } from './personas';

/** What a gate needs to know about the viewer. `personas` are HELD personas. */
export interface GateViewer {
  readonly subject: string;
  readonly displayName: string;
  readonly personas: readonly Persona[];
}

export type GateResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly message: string; readonly next: string };

const ALLOWED: GateResult = { allowed: true };

function refuse(message: string, next: string): GateResult {
  return { allowed: false, message, next };
}

const NOT_SIGNED_IN = refuse(
  'You are not signed in.',
  'Sign in, then propose again; your draft is kept.',
);

/** Save draft and Propose: any signed-in viewer. The author is the session. */
export function gateSaveOrPropose(viewer: GateViewer | null): GateResult {
  return viewer === null ? NOT_SIGNED_IN : ALLOWED;
}

/** Discard: the proposal's author only. */
export function gateDiscard(viewer: GateViewer | null, author: string): GateResult {
  if (viewer === null) return NOT_SIGNED_IN;
  if (viewer.subject === author) return ALLOWED;
  return refuse(
    `Only the author, ${author}, can discard this change.`,
    `Ask ${author} to discard it, or request changes on the proposal instead.`,
  );
}

export type DefinitionalApproval =
  | { readonly allowed: true; readonly selfApproved: boolean }
  | { readonly allowed: false; readonly message: string; readonly next: string };

/**
 * Approve a definitional change (a role, consumer, binding grant, package or
 * manifest): an admin. The owner's decision (W0-P4 §9 decision 3): *"Admin can
 * do though as both."* An admin may approve their own proposal, and the record
 * then says so (`selfApproved: true`); anyone else who proposed a change may
 * not approve it. Runtime writes are not governed here: the gateway's approval
 * gate still refuses approver == requester for every runtime write.
 */
export function gateApproveDefinitional(
  viewer: GateViewer | null,
  requestedBy: string,
): DefinitionalApproval {
  if (viewer === null) {
    return {
      allowed: false,
      message: 'You are not signed in.',
      next: 'Sign in, then review the proposal again; it stays open.',
    };
  }
  const isAdmin = viewer.personas.includes('admin');
  const isProposer = viewer.subject === requestedBy;
  if (isAdmin) return { allowed: true, selfApproved: isProposer };
  if (isProposer) {
    return {
      allowed: false,
      message: 'You proposed this change, so you cannot approve it.',
      next: 'Ask another approver to review it; the proposal stays open.',
    };
  }
  return {
    allowed: false,
    message: 'Approving a definitional change needs the admin persona.',
    next: 'Ask an MCPForge admin to review it; the proposal stays open.',
  };
}

/**
 * W0-P33b — Merge an approved definitional change into the definitions the
 * gateway reads: a SUPER ADMIN only (owner decision, 30 Sep 2026, docs/
 * build-plan/w0-p33-portal-merge.md §2.2). `isSuperAdmin` is decided from the
 * viewer's gateway-verified groups against the git-held `superAdmins:` list,
 * never from a persona.
 */
export function gateMerge(viewer: GateViewer | null, isSuperAdmin: boolean): GateResult {
  if (viewer === null) return NOT_SIGNED_IN;
  if (isSuperAdmin) return ALLOWED;
  return refuse(
    'Merging a change into the definitions needs a super admin.',
    'Ask a super admin (a member of a superAdmins group in the git mapping) to merge it; the approved change stays open.',
  );
}

/**
 * Kill switches, all five granularities. W0-P4 §9 decision 4: the portal shows
 * the `forge kill` command now; a real write path is a later task. So
 * "allowed" means "show the command", and a refusal says who can run it.
 */
export function gateKill(viewer: GateViewer | null): GateResult {
  if (viewer !== null && viewer.personas.includes('admin')) return ALLOWED;
  return refuse(
    'Kill switches need the admin persona.',
    'Ask an MCPForge admin, or run `forge kill` if you hold the admin role locally.',
  );
}

/**
 * `issue-credential` is never offered in the portal (W0-P4 §3): there is no
 * button to refuse, only the command to run.
 */
export function issueCredentialNext(consumerId: string): string {
  return `Run \`forge consumer issue-credential ${consumerId}\` on the gateway host; it prints once and is refused when CI=true or in staging/prod.`;
}
