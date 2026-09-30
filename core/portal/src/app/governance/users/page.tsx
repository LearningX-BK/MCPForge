// MCPForge — W0-P28: `/governance/users` — local user administration.
//
// 02 §4.4's "Admin UI in the portal (Phase 3)", built on the owner's decisions
// of 30 Sep 2026. Live, read from `GET /api/v1/admin/users` as the signed-in
// viewer. Whether the viewer may see and change accounts is the GATEWAY's
// call (`identityAdmins:` in the git mapping); anyone else gets its refusal,
// rendered verbatim with its `next`. Persona never hides this route (03 §2).

import * as React from 'react';

import { LiveStateNotice } from '@/components/live/live-state-notice';
import { readAdminUsers } from '@/lib/gateway-client/read-client';

import { GovNav } from '../_components/gov-nav';
import { userAdminAction } from './actions';
import { UsersAdmin } from './users-admin';

export const dynamic = 'force-dynamic';

export default async function GovernanceUsersPage(): Promise<React.ReactElement> {
  const result = await readAdminUsers();

  return (
    <main className="flex flex-col gap-6 px-6 py-6">
      <div>
        <h1 className="mb-1 font-display text-xl text-text-1">Governance</h1>
        <p className="max-w-[80ch] text-[13px] text-text-2">
          Local accounts for this deployment. A person&rsquo;s roles come from their groups through
          the group mapping in git, so changing someone&rsquo;s groups here changes what they can do
          on their next request. Every change is recorded in the audit trail.
        </p>
      </div>

      <GovNav />

      {result.kind === 'ok' ? (
        <UsersAdmin
          users={result.data.users}
          identityAdminGroups={result.data.identityAdminGroups}
          action={userAdminAction}
        />
      ) : (
        <LiveStateNotice state={result} subject="Users" />
      )}
    </main>
  );
}
