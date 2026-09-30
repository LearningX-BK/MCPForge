// MCPForge — `/api/v1/admin/users`: local user administration. W0-P28.
//
// 02 §4.4 names an "Admin UI in the portal (Phase 3)" for the Wave 0 local
// user store; this is the gateway half of it. The owner took four decisions
// on 30 Sep 2026:
//
//  1. The PORTAL is the management path, so these endpoints sit under the
//     same `/api/v1` front door as the reads: a registered consumer AND a
//     signed-in human, every request (non-negotiable 6).
//  2. WHO MAY ADMINISTER is git: the groups listed under `identityAdmins:` in
//     `overlays/<deployment>/mappings/groups-to-roles.yaml`. The gateway checks
//     the signed-in human's groups against that list. A portal persona is a
//     lens and is never consulted here.
//  3. The FIRST admin comes from `forge identity bootstrap-admin`, not from
//     here. Nothing here can act until an admin exists.
//  4. EVIDENCE. Every change and every refused change attempt appends one
//     hash-chained `identity` audit row, in the same transaction as the
//     change. A row never carries a password, a hash of one, or its length.
//
// Two further rules, decided here as implementation (CLAUDE.md §8):
//
//  - A change is a write, so the consumer's registration must allow writes,
//    exactly as for an approval decision. Listing users is a read and needs
//    only the admin group.
//  - The last active identity admin cannot be disabled or moved out of every
//    admin group. Otherwise one click leaves a deployment that only a
//    re-bootstrap from the host can administer again.
//
// What this module does NOT do: delete an account (accounts are deactivated,
// never deleted, `identity/local/store.ts`), read or return a credential, or
// change `identityAdmins:` itself. That list is git and changes by review.

import {
  API_V1_PREFIX,
  adminCreateUserRequestSchema,
  adminUserActionRequestSchema,
  type AdminUser,
  type AdminUserAction,
  type AdminUserChangeResponse,
  type AdminUsersResponse,
} from '@mcpforge/shared/api/v1';
import { ForgeError } from '@mcpforge/shared/errors';
import type { EstablishedSession } from '../../assembly/session.js';
import type { LocalUserStore } from '../../identity/local/index.js';
import type { AppendAuditCallInput } from '../../store/audit/types.js';
import type { LocalUserRecord } from '../../store/identity/types.js';
import type { RuntimeStore } from '../../store/repository.js';
import { ApiRefusal } from './refusal.js';

export const ADMIN_USERS_PATH = `${API_V1_PREFIX}/admin/users`;

/** Largest admin request body accepted. A password is capped at 1 KiB. */
export const ADMIN_BODY_MAX_BYTES = 16 * 1024;

/** The pseudo tool id an `identity` audit row names, per action. */
export function identityPseudoToolId(action: AdminUserAction | 'unknown'): string {
  return `forge.identity.${action}`;
}

/** Which admin route `pathname` is: the collection, one user, or neither. */
export function adminUsersRoute(
  pathname: string,
):
  | { readonly kind: 'collection' }
  | { readonly kind: 'user'; readonly subject: string }
  | undefined {
  if (pathname === ADMIN_USERS_PATH) return { kind: 'collection' };
  if (!pathname.startsWith(`${ADMIN_USERS_PATH}/`)) return undefined;
  const rest = pathname.slice(ADMIN_USERS_PATH.length + 1);
  if (rest.length === 0 || rest.includes('/')) return undefined;
  try {
    return { kind: 'user', subject: decodeURIComponent(rest) };
  } catch {
    return undefined;
  }
}

export interface AdminActor {
  readonly session: EstablishedSession;
  readonly subject: string;
  readonly correlationId: string;
}

export interface UserAdminDeps {
  readonly store: Pick<RuntimeStore, 'audit' | 'transaction'>;
  readonly users: LocalUserStore;
  /** The `identityAdmins:` groups of THIS deployment, read from git at startup. */
  readonly identityAdminGroups: readonly string[];
  /** Every group the deployment's mapping names, so an unmapped group can be flagged. */
  readonly mappedGroups: ReadonlySet<string>;
  readonly gatewayVersion: string;
  readonly now: () => Date;
}

type DeniedRule =
  | 'identity.not_identity_admin'
  | 'identity.consumer_write_not_allowed'
  | 'identity.last_admin'
  | 'identity.no_such_user'
  | 'identity.invalid_state';

/** What an attempt is recorded as. Never a password. */
interface Attempt {
  readonly action: AdminUserAction;
  readonly targetSubject: string | undefined;
  readonly username?: string;
  readonly groups?: readonly string[];
}

const NOT_ADMIN_NEXT =
  'Ask an existing identity admin to make this change in the portal (Governance, Users). Who may administer users is the identityAdmins list in overlays/<deployment>/mappings/groups-to-roles.yaml, widened only through a reviewed change proposal.';

// --- the list (a read) -----------------------------------------------------------

export async function listAdminUsers(
  deps: UserAdminDeps,
  actor: AdminActor,
): Promise<AdminUsersResponse> {
  if (!holdsAdminGroup(deps, actor.session.principal.groups)) {
    throw new ApiRefusal(
      'TOOL_NOT_IN_SCOPE',
      'Listing local users is limited to identity admins, and none of your groups is one.',
      NOT_ADMIN_NEXT,
    );
  }
  const users = await deps.users.listUsers({ includeInactive: true });
  return {
    asOf: deps.now().toISOString(),
    identityAdminGroups: [...deps.identityAdminGroups],
    users: users.map((u) => toAdminUser(deps, u)),
  };
}

// --- the changes (writes) ----------------------------------------------------------

/** `POST /api/v1/admin/users`: create one account. */
export async function createAdminUser(
  deps: UserAdminDeps,
  actor: AdminActor,
  rawBody: unknown,
): Promise<AdminUserChangeResponse> {
  const parsed = adminCreateUserRequestSchema.safeParse(rawBody);
  if (!parsed.success) throw invalidBody(parsed.error.issues);
  const body = parsed.data;
  const groups = normaliseGroups(body.groups);
  const attempt: Attempt = {
    action: 'create',
    targetSubject: undefined,
    username: body.username,
    groups,
  };
  await authorizeChange(deps, actor, attempt);

  const { user, row } = await commitOrRefuse(deps, actor, attempt, async () => {
    const created = await deps.users.createUser({
      username: body.username,
      displayName: body.displayName,
      ...(body.email === undefined ? {} : { email: body.email }),
      password: body.password,
      groups,
    });
    return created;
  });
  return {
    asOf: deps.now().toISOString(),
    action: 'create',
    user: toAdminUser(deps, user),
    auditCallId: row.id,
    next: changeNext(deps.mappedGroups, 'create', user.username, user.groups, groups),
  };
}

/** `POST /api/v1/admin/users/{subject}`: one change to one account. */
export async function changeAdminUser(
  deps: UserAdminDeps,
  actor: AdminActor,
  subject: string,
  rawBody: unknown,
): Promise<AdminUserChangeResponse> {
  const parsed = adminUserActionRequestSchema.safeParse(rawBody);
  if (!parsed.success) throw invalidBody(parsed.error.issues);
  const body = parsed.data;
  const groups = body.action === 'set_groups' ? normaliseGroups(body.groups) : undefined;
  const attempt: Attempt = {
    action: body.action,
    targetSubject: subject,
    ...(groups === undefined ? {} : { groups }),
  };
  await authorizeChange(deps, actor, attempt);

  const { user, row } = await commitOrRefuse(deps, actor, attempt, async () => {
    const current = await deps.users.getUser(subject);
    if (current === undefined) {
      throw new DeniedChange(
        'identity.no_such_user',
        new ApiRefusal(
          'NOT_FOUND',
          `No local account has subject ${subject}.`,
          `Open the user list at ${ADMIN_USERS_PATH} and choose an account that exists.`,
        ),
      );
    }
    // The last-admin guard runs INSIDE the transaction, so two admins
    // disabling each other at once cannot both pass it.
    const losesAdmin =
      current.active &&
      holdsAdminGroup(deps, current.groups) &&
      (body.action === 'disable' ||
        (body.action === 'set_groups' && !holdsAdminGroup(deps, groups ?? [])));
    if (losesAdmin) await refuseIfLastAdmin(deps, current.subject);

    switch (body.action) {
      case 'disable':
        return deps.users.deactivateUser(subject);
      case 'enable':
        return deps.users.reactivateUser(subject);
      case 'set_groups':
        return deps.users.setGroups(subject, groups ?? []);
      case 'reset_password':
        return deps.users.setPassword(subject, body.password);
    }
  });

  return {
    asOf: deps.now().toISOString(),
    action: body.action,
    user: toAdminUser(deps, user),
    auditCallId: row.id,
    next: changeNext(deps.mappedGroups, body.action, user.username, user.groups, groups),
  };
}

// --- authorization ----------------------------------------------------------------

function holdsAdminGroup(deps: UserAdminDeps, groups: readonly string[]): boolean {
  return groups.some((g) => deps.identityAdminGroups.includes(g));
}

/**
 * Both halves, in order: the human must hold an identity-admin group, and the
 * consumer's registration must allow writes. A refusal is audited, then thrown.
 */
async function authorizeChange(
  deps: UserAdminDeps,
  actor: AdminActor,
  attempt: Attempt,
): Promise<void> {
  if (!holdsAdminGroup(deps, actor.session.principal.groups)) {
    await auditRefusal(
      deps,
      actor,
      attempt,
      'identity.not_identity_admin',
      'TOOL_NOT_IN_SCOPE',
      'The actor holds no identity-admin group.',
    );
    throw new ApiRefusal(
      'TOOL_NOT_IN_SCOPE',
      'Changing local users is limited to identity admins, and none of your groups is one.',
      NOT_ADMIN_NEXT,
    );
  }
  const consumer = actor.session.scopeSession.consumer;
  if (!consumer.authorizations.writeAllowed) {
    await auditRefusal(
      deps,
      actor,
      attempt,
      'identity.consumer_write_not_allowed',
      'CONSUMER_NOT_AUTHORIZED',
      'The consumer is not authorized to write.',
    );
    throw new ApiRefusal(
      'CONSUMER_NOT_AUTHORIZED',
      `Consumer ${consumer.consumerId} is not authorized to write, and changing a user account is a write.`,
      'Make this change in the MCPForge portal, whose registration allows writes. A consumer registration is widened only through a reviewed change proposal.',
    );
  }
}

async function refuseIfLastAdmin(deps: UserAdminDeps, targetSubject: string): Promise<void> {
  const users = await deps.users.listUsers({ includeInactive: false });
  const others = users.filter(
    (u) => u.subject !== targetSubject && u.active && holdsAdminGroup(deps, u.groups),
  );
  if (others.length === 0) {
    throw new DeniedChange(
      'identity.last_admin',
      new ApiRefusal(
        'POLICY_GUARDRAIL_BREACH',
        'This is the last active identity admin; disabling it or removing its admin group would leave nobody able to administer users.',
        `Make another account an identity admin first (give it one of: ${deps.identityAdminGroups.join(', ')}), then make this change.`,
      ),
    );
  }
}

// --- the transaction ----------------------------------------------------------------

/** A refusal decided inside the change's transaction, audited after it rolls back. */
class DeniedChange extends Error {
  constructor(
    readonly rule: DeniedRule,
    readonly refusal: ApiRefusal,
  ) {
    super(refusal.message);
  }
}

/**
 * Run `change` and append its `ok` audit row in ONE transaction. When the
 * change refuses, the transaction rolls back and the refusal is recorded in
 * its own, so a refused attempt is evidence too.
 */
async function commitOrRefuse(
  deps: UserAdminDeps,
  actor: AdminActor,
  attempt: Attempt,
  change: () => Promise<LocalUserRecord>,
): Promise<{ user: LocalUserRecord; row: { id: string } }> {
  try {
    return await deps.store.transaction(async () => {
      const user = await change();
      const row = await deps.store.audit.append({
        ...baseRow(deps, actor, { ...attempt, targetSubject: user.subject }),
        outcome: 'ok',
      });
      return { user, row };
    });
  } catch (error) {
    const denied = toDenied(error);
    if (denied === undefined) throw error;
    await auditRefusal(
      deps,
      actor,
      attempt,
      denied.rule,
      denied.refusal.code,
      denied.refusal.message,
    );
    throw denied.refusal;
  }
}

/** The store's own admin refusals (username taken, too-short password…) become API refusals. */
function toDenied(error: unknown): DeniedChange | undefined {
  if (error instanceof DeniedChange) return error;
  if (error instanceof ForgeError) {
    const e = error.toJSON();
    return new DeniedChange('identity.invalid_state', new ApiRefusal(e.code, e.message, e.next));
  }
  return undefined;
}

// --- audit rows ------------------------------------------------------------------

async function auditRefusal(
  deps: UserAdminDeps,
  actor: AdminActor,
  attempt: Attempt,
  rule: DeniedRule,
  errorCode: string,
  message: string,
): Promise<void> {
  await deps.store.transaction(() =>
    deps.store.audit.append({
      ...baseRow(deps, actor, attempt),
      outcome: rule === 'identity.invalid_state' ? 'business_error' : 'policy_denied',
      errorCode,
      errorMessageAgent: message,
      deniedByRule: rule,
    }),
  );
}

/**
 * The columns every `identity` row carries: who acted, through which consumer,
 * and which account they acted on. `argsRedacted` is built field by field from
 * the attempt, which has no password field, so none can arrive by a spread.
 */
function baseRow(
  deps: UserAdminDeps,
  actor: AdminActor,
  attempt: Attempt,
): Omit<AppendAuditCallInput, 'outcome'> {
  const at = deps.now();
  const scope = actor.session.scopeAt(at);
  const session = actor.session.scopeSession;
  const principal = actor.session.principal;
  return {
    ts: at.toISOString(),
    correlationId: actor.correlationId,
    sessionId: actor.session.sessionId,
    callerSubject: principal.subject,
    ...(principal.displayName === undefined ? {} : { callerDisplay: principal.displayName }),
    ...(principal.idp === undefined ? {} : { callerIdp: principal.idp }),
    ...(principal.amr === undefined ? {} : { callerAmr: principal.amr.join(' ') }),
    callerRoles: [...session.heldRoleIds],

    consumerId: session.consumer.consumerId,
    consumerRecordSha: session.consumerSession.recordSha,
    consumerAuthMethod: session.consumerSession.authMethod,
    consumerSessionId: session.consumerSession.consumerSessionId,
    humanInTheLoop: session.consumer.attestation.humanInTheLoop,

    toolId: identityPseudoToolId(attempt.action),
    // A user change reaches no target system.
    isWrite: false,

    deploymentId: scope.deployment.deploymentId,
    gatewayVersion: deps.gatewayVersion,

    phase: 'identity',
    argsRedacted: {
      action: attempt.action,
      ...(attempt.targetSubject === undefined ? {} : { targetSubject: attempt.targetSubject }),
      ...(attempt.username === undefined ? {} : { username: attempt.username }),
      ...(attempt.groups === undefined ? {} : { groups: [...attempt.groups] }),
    },
    // Indexed, so "every change to this account" is one lookup.
    resultKeys:
      attempt.targetSubject === undefined
        ? []
        : [{ keyName: 'subject', keyValue: attempt.targetSubject }],
  };
}

// --- helpers ----------------------------------------------------------------------

function normaliseGroups(groups: readonly string[]): string[] {
  return [...new Set(groups.map((g) => g.trim()))].sort();
}

function toAdminUser(deps: UserAdminDeps, u: LocalUserRecord): AdminUser {
  return {
    subject: u.subject,
    username: u.username,
    displayName: u.displayName,
    email: u.email,
    active: u.active,
    totpEnrolled: u.totpEnrolled,
    lockedUntil: u.lockedUntil,
    lastAuthenticatedAt: u.lastAuthenticatedAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    groups: [...u.groups],
    identityAdmin: holdsAdminGroup(deps, u.groups),
  };
}

function withUnmappedNote(
  mappedGroups: ReadonlySet<string>,
  groups: readonly string[],
  sentence: string,
): string {
  const unmapped = groups.filter((g) => !mappedGroups.has(g));
  if (unmapped.length === 0) return sentence;
  return `${sentence} Note: ${unmapped.join(', ')} ${unmapped.length === 1 ? 'is' : 'are'} not in this deployment's group mapping, so ${unmapped.length === 1 ? 'it grants' : 'they grant'} nothing until a reviewed change adds ${unmapped.length === 1 ? 'it' : 'them'}.`;
}

/**
 * The `next` of a change that was made. Pure, and every branch is a fixed
 * sentence naming the account, so `errors/enumeration.test.ts` drives each
 * one. `requestedGroups` are the groups the admin sent, checked against the
 * mapping so a group that grants nothing is said so.
 */
export function changeNext(
  mappedGroups: ReadonlySet<string>,
  action: AdminUserAction,
  username: string,
  userGroups: readonly string[],
  requestedGroups: readonly string[] | undefined,
): string {
  switch (action) {
    case 'create':
      return withUnmappedNote(
        mappedGroups,
        requestedGroups ?? [],
        `Created ${username}. Give them the password through a channel other than this one; they sign in to the portal with it. Their roles come from their groups through the git mapping.`,
      );
    case 'disable':
      return `Disabled ${username}. Their next request is refused and every session they held has ended; the account and its audit history stay. Enable it again here if this was a mistake.`;
    case 'enable':
      return `Enabled ${username}. They can sign in again with their existing password.`;
    case 'set_groups':
      return withUnmappedNote(
        mappedGroups,
        requestedGroups ?? [],
        `Groups for ${username} are now: ${userGroups.length === 0 ? 'none' : userGroups.join(', ')}. Their roles follow on their next request.`,
      );
    case 'reset_password':
      return `Reset the password for ${username}. Give them the new one through a channel other than this one. Every session they held has ended, so they sign in again with the new password.`;
  }
}

function invalidBody(
  issues: readonly { path: (string | number)[]; message: string }[],
): ApiRefusal {
  // `path` names the field, never its value: a password is never echoed.
  return new ApiRefusal(
    'INPUT_INVALID',
    `The request body is not valid: ${issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')}.`,
    'Send {"username","displayName","password","groups"} to create, or {"action":"disable"|"enable"} / {"action":"set_groups","groups":[...]} / {"action":"reset_password","password":"..."} to change an account. A password is at least 12 characters.',
  );
}
