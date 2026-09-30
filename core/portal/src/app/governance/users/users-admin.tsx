'use client';
// MCPForge — W0-P28: the identity admin's view of local accounts.
//
// Every control posts to one server action (`./actions.ts`), which forwards
// to the gateway. The gateway decides whether the viewer may make the change
// and refuses the last admin's removal; this component only renders its
// answer, `next` included. A password field is never pre-filled and never
// shown back. Accounts are disabled, never deleted.

import * as React from 'react';

import type { AdminUser } from '@mcpforge/shared/api/v1';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { UserAdminState } from './actions';

export interface UsersAdminProps {
  readonly users: readonly AdminUser[];
  readonly identityAdminGroups: readonly string[];
  /** The server action. Injected so a test can drive the view without a server. */
  readonly action: (prev: UserAdminState, form: FormData) => Promise<UserAdminState>;
}

const IDLE: UserAdminState = { status: 'idle' };

const ACTION_LABEL: Record<string, string> = {
  create: 'Account created',
  disable: 'Account disabled',
  enable: 'Account enabled',
  set_groups: 'Groups updated',
  reset_password: 'Password reset',
};

function Outcome({ state }: { state: UserAdminState }) {
  if (state.status === 'done') {
    return (
      <section
        role="status"
        data-testid="user-admin-done"
        className="flex flex-col gap-1 rounded-lg border border-status-ok-border bg-status-ok-bg p-3 text-[13px] text-status-ok-strong"
      >
        <p className="font-semibold">
          {ACTION_LABEL[state.action] ?? 'Done'}: {state.username}.
        </p>
        <p data-testid="user-admin-next">
          <span className="font-semibold">Next: </span>
          {state.next}
        </p>
        <p className="text-[12px] opacity-80">
          Audit call <code className="font-mono">{state.auditCallId}</code>
        </p>
      </section>
    );
  }
  if (state.status === 'refused') {
    return (
      <section
        role="alert"
        data-testid="user-admin-refused"
        className="flex flex-col gap-1 rounded-lg border border-status-write-border bg-status-write-bg p-3 text-[13px] text-status-write-strong"
      >
        <p className="font-semibold">
          Not changed{state.code === undefined ? '' : ` (${state.code})`}: {state.message}
        </p>
        <p data-testid="user-admin-next">
          <span className="font-semibold">Next: </span>
          {state.next}
        </p>
        {state.correlationId === undefined ? null : (
          <p className="text-[12px] opacity-80">
            Correlation id <code className="font-mono">{state.correlationId}</code>
          </p>
        )}
      </section>
    );
  }
  return null;
}

function statusText(u: AdminUser): string {
  if (!u.active) return 'Disabled';
  if (u.lockedUntil !== null && new Date(u.lockedUntil) > new Date()) return 'Locked';
  return 'Active';
}

function UserRow({
  user,
  formAction,
  pending,
}: {
  user: AdminUser;
  formAction: (form: FormData) => void;
  pending: boolean;
}) {
  const id = React.useId();
  return (
    <li
      data-testid="user-row"
      data-subject={user.subject}
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold text-text-1">{user.displayName}</span>
        <span className="font-mono text-[12.5px] text-text-2">{user.username}</span>
        <span data-testid="user-status" className="text-[12.5px] text-text-2">
          {statusText(user)}
        </span>
        {user.identityAdmin ? (
          <span
            data-testid="user-identity-admin"
            className="rounded-full border border-accent-border bg-accent-tint px-2 text-[11.5px] font-semibold text-accent"
          >
            Identity admin
          </span>
        ) : null}
        {user.totpEnrolled ? <span className="text-[12px] text-text-2">Two-factor on</span> : null}
      </div>
      <p className="text-[12.5px] text-text-2">
        Groups: {user.groups.length === 0 ? 'none' : user.groups.join(', ')}
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <form action={formAction} className="flex items-end gap-2">
          <input type="hidden" name="subject" value={user.subject} />
          <input type="hidden" name="intent" value={user.active ? 'disable' : 'enable'} />
          <Button type="submit" variant="outline" disabled={pending}>
            {user.active ? 'Disable' : 'Enable'}
          </Button>
        </form>

        <form action={formAction} className="flex items-end gap-2">
          <input type="hidden" name="subject" value={user.subject} />
          <input type="hidden" name="intent" value="set_groups" />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-groups`}>Groups for {user.username}</Label>
            <Input
              id={`${id}-groups`}
              name="groups"
              defaultValue={user.groups.join(', ')}
              disabled={pending}
            />
          </div>
          <Button type="submit" variant="outline" disabled={pending}>
            Update groups
          </Button>
        </form>

        <form action={formAction} className="flex items-end gap-2">
          <input type="hidden" name="subject" value={user.subject} />
          <input type="hidden" name="intent" value="reset_password" />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-password`}>New password for {user.username}</Label>
            <Input
              id={`${id}-password`}
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              disabled={pending}
            />
          </div>
          <Button type="submit" variant="outline" disabled={pending}>
            Reset password
          </Button>
        </form>
      </div>
    </li>
  );
}

export function UsersAdmin({ users, identityAdminGroups, action }: UsersAdminProps) {
  const [state, formAction, pending] = React.useActionState(action, IDLE);
  const id = React.useId();

  return (
    <div className="flex flex-col gap-6" data-testid="users-admin">
      <Outcome state={state} />

      <section aria-labelledby={`${id}-list`} className="flex flex-col gap-3">
        <h2 id={`${id}-list`} className="text-[14px] font-semibold text-text-1">
          Accounts ({users.length})
        </h2>
        <p className="text-[12.5px] text-text-2">
          Identity admin groups, from git: {identityAdminGroups.join(', ')}. Changing who is an
          identity admin means giving someone one of these groups; changing the list itself is a
          reviewed change to the group mapping.
        </p>
        {users.length === 0 ? (
          <p className="text-[13px] text-text-2">No local accounts yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {users.map((u) => (
              <UserRow key={u.subject} user={u} formAction={formAction} pending={pending} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${id}-create`} className="flex flex-col gap-3">
        <h2 id={`${id}-create`} className="text-[14px] font-semibold text-text-1">
          Create an account
        </h2>
        <form
          action={formAction}
          data-testid="user-create-form"
          className="grid max-w-2xl grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
        >
          <input type="hidden" name="intent" value="create" />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-username`}>Username</Label>
            <Input id={`${id}-username`} name="username" required disabled={pending} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-display`}>Display name</Label>
            <Input id={`${id}-display`} name="displayName" required disabled={pending} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-email`}>Email (optional)</Label>
            <Input id={`${id}-email`} name="email" type="email" disabled={pending} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-new-groups`}>Groups (comma separated)</Label>
            <Input id={`${id}-new-groups`} name="groups" disabled={pending} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-new-password`}>Password (at least 12 characters)</Label>
            <Input
              id={`${id}-new-password`}
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              disabled={pending}
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={pending}>
              Create account
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
