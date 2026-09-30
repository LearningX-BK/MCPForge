'use server';
// MCPForge — W0-P28: the portal forwards an identity admin's change to a local
// account to the gateway, and decides nothing itself.
//
// Who may administer users is the gateway's call (`identityAdmins:` in the git
// mapping, checked against the signed-in human's groups). A persona is a lens
// and is not consulted here. A server action, so the viewer's token, the
// portal's consumer assertion and any password typed never reach the browser
// again: the state this returns carries no password, only the gateway's
// answer and its `next`.

import { revalidatePath } from 'next/cache';

import { ADMIN_USER_ACTIONS, type AdminUserAction } from '@mcpforge/shared/api/v1';

import {
  changeAdminUser,
  createAdminUser,
  type ReadResult,
} from '@/lib/gateway-client/read-client';

export type UserAdminState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'done';
      readonly action: AdminUserAction;
      readonly username: string;
      readonly auditCallId: string;
      readonly next: string;
    }
  | {
      readonly status: 'refused';
      readonly code?: string;
      readonly message: string;
      readonly next: string;
      readonly correlationId?: string;
    };

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/** "a, b  c" -> ["a", "b", "c"]: groups are typed as a comma or space separated list. */
function parseGroups(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
}

export async function userAdminAction(
  _prev: UserAdminState,
  form: FormData,
): Promise<UserAdminState> {
  const intent = field(form, 'intent');
  if (!(ADMIN_USER_ACTIONS as readonly string[]).includes(intent)) {
    return {
      status: 'refused',
      message: 'No change was chosen.',
      next: 'Use one of the buttons on this page: Create account, Disable, Enable, Update groups or Reset password.',
    };
  }
  const action = intent as AdminUserAction;

  let result: ReadResult<{
    readonly action: AdminUserAction;
    readonly user: { readonly username: string };
    readonly auditCallId: string;
    readonly next: string;
  }>;
  if (action === 'create') {
    const email = field(form, 'email').trim();
    result = await createAdminUser({
      username: field(form, 'username'),
      displayName: field(form, 'displayName'),
      ...(email.length === 0 ? {} : { email }),
      password: field(form, 'password'),
      groups: parseGroups(field(form, 'groups')),
    });
  } else {
    const subject = field(form, 'subject');
    result = await changeAdminUser(
      subject,
      action === 'set_groups'
        ? { action, groups: parseGroups(field(form, 'groups')) }
        : action === 'reset_password'
          ? { action, password: field(form, 'password') }
          : { action },
    );
  }

  switch (result.kind) {
    case 'ok':
      revalidatePath('/governance/users');
      return {
        status: 'done',
        action: result.data.action,
        username: result.data.user.username,
        auditCallId: result.data.auditCallId,
        next: result.data.next,
      };
    case 'signed-out':
      return {
        status: 'refused',
        message: 'You are not signed in, so this change cannot carry your name.',
        next: result.next,
      };
    case 'gateway-down':
      return {
        status: 'refused',
        message: `The portal could not reach the gateway at ${result.endpoint}. Nothing was changed.`,
        next: result.next,
      };
    case 'not-found':
      return { status: 'refused', code: 'NOT_FOUND', message: result.message, next: result.next };
    case 'refused':
      return {
        status: 'refused',
        code: result.code,
        message: result.message,
        next: result.next,
        ...(result.correlationId === undefined ? {} : { correlationId: result.correlationId }),
      };
  }
}
