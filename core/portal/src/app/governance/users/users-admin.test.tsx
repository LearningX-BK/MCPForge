// @vitest-environment jsdom
//
// W0-P28: the users view forwards each change to the server action and shows
// the gateway's answer with its `next`. It never shows a password back, and it
// offers no delete.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdminUser } from '@mcpforge/shared/api/v1';

import type { UserAdminState } from './actions';
import { UsersAdmin } from './users-admin';

afterEach(() => cleanup());

const ADMIN: AdminUser = {
  subject: 'local:admin',
  username: 'ops-admin',
  displayName: 'Ops Admin',
  email: null,
  active: true,
  totpEnrolled: false,
  lockedUntil: null,
  lastAuthenticatedAt: null,
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
  groups: ['mcpforge-admins'],
  identityAdmin: true,
};
const CLERK: AdminUser = {
  ...ADMIN,
  subject: 'local:clerk',
  username: 'ap-clerk',
  displayName: 'AP Clerk',
  groups: ['finance-ap-clerks'],
  identityAdmin: false,
  active: false,
};

type Action = (prev: UserAdminState, form: FormData) => Promise<UserAdminState>;

function renderView(action: Action) {
  return render(
    <UsersAdmin users={[ADMIN, CLERK]} identityAdminGroups={['mcpforge-admins']} action={action} />,
  );
}

describe('UsersAdmin', () => {
  it('lists accounts, marks the identity admin, and offers no delete', () => {
    renderView(() => Promise.resolve({ status: 'idle' }));
    const rows = screen.getAllByTestId('user-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByTestId('user-identity-admin')).toBeTruthy();
    expect(within(rows[1]!).getByTestId('user-status').textContent).toBe('Disabled');
    expect(within(rows[1]!).getByRole('button', { name: 'Enable' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
  });

  it('sends a disable for the row it was pressed in and shows the next', async () => {
    const action = vi.fn<Action>(() =>
      Promise.resolve({
        status: 'done',
        action: 'disable',
        username: 'ops-admin',
        auditCallId: 'call_1',
        next: 'Enable it again here if this was a mistake.',
      }),
    );
    renderView(action);
    const row = screen.getAllByTestId('user-row')[0]!;
    fireEvent.click(within(row).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(screen.getByTestId('user-admin-done')).toBeTruthy());
    const form = action.mock.calls[0]![1];
    expect(form.get('intent')).toBe('disable');
    expect(form.get('subject')).toBe('local:admin');
    expect(screen.getByTestId('user-admin-next').textContent).toContain('Enable it again');
  });

  it('shows a refusal with its code and next', async () => {
    renderView(() =>
      Promise.resolve({
        status: 'refused',
        code: 'POLICY_GUARDRAIL_BREACH',
        message: 'This is the last active identity admin.',
        next: 'Make another account an identity admin first.',
      }),
    );
    const row = screen.getAllByTestId('user-row')[0]!;
    fireEvent.click(within(row).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(screen.getByTestId('user-admin-refused')).toBeTruthy());
    expect(screen.getByTestId('user-admin-refused').textContent).toContain(
      'POLICY_GUARDRAIL_BREACH',
    );
    expect(screen.getByTestId('user-admin-next').textContent).toContain('another account');
  });

  it('never pre-fills a password field', () => {
    const { container } = renderView(() => Promise.resolve({ status: 'idle' }));
    const fields = container.querySelectorAll<HTMLInputElement>('input[type="password"]');
    expect(fields.length).toBe(3);
    for (const f of fields) expect(f.value).toBe('');
  });
});
