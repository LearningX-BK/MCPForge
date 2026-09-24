// MCPForge — W0-J18: `/governance` — the Roles tab (03 §5.3 "Governance" item 1).
//
// A server component: the role sources and their currently-merged compiled
// scopes are definitional data read from the repo, and turning that into a
// client fetch would be a round-trip for something the server already knows.
// The live compile below it is a Server Action, called by `RoleEditor`.
import * as React from 'react';

import { GovNav } from './_components/gov-nav';
import { RoleEditor } from './_components/role-editor';
import { compileRoleDraft } from './_lib/compile-role';
import { loadRoleSources } from './_lib/repo-roles';

export default function GovernanceRolesPage(): React.ReactElement {
  const sources = loadRoleSources();

  return (
    <main className="flex flex-col gap-6 px-6 py-6">
      <div>
        <h1 className="mb-1 font-display text-xl text-text-1">Governance</h1>
        <p className="max-w-[80ch] text-[13px] text-text-2">
          A role is a grant, not a runtime. Its globs compile to an explicit tool-id list, and that
          list is what a reviewer approves — so a widening is a diff, never a surprise.
        </p>
      </div>

      <GovNav />

      <RoleEditor sources={sources} compile={compileRoleDraft} />
    </main>
  );
}
