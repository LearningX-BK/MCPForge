// MCPForge — W0-J12: fixtures shared by the change-flow tests.
//
// The stub implements `ChangeHost` — the interface — precisely so the
// component tests prove the components work against the *seam* and not
// against git. It is not a third implementation of the product; it never
// leaves the test tree, and it is exported from a plain `.ts` module rather
// than a `.test.ts` so several suites can share it.
import type { ChangeDiffSet, ChangeHost, ChangeProposal } from '@/lib/change-host';

export function fixtureProposal(overrides: Partial<ChangeProposal> = {}): ChangeProposal {
  return {
    id: 'forge-W0-J12-add-create',
    title: 'Add jde.ap.voucher.create',
    branch: 'forge/W0-J12-add-create',
    baseBranch: 'main',
    state: 'draft',
    author: 'priya',
    createdAt: '2026-09-09T09:00:00.000Z',
    ...overrides,
  };
}

export function emptyDiff(): ChangeDiffSet {
  return { manifest: [], generated: [], roleScope: [], other: [] };
}

export function fixtureDiff(): ChangeDiffSet {
  return {
    manifest: [
      {
        path: 'manifests/jde/ap/voucher.create.tool.yaml',
        status: 'added',
        patch: '+id: jde.ap.voucher.create\n',
        additions: 12,
        deletions: 0,
      },
    ],
    generated: [
      {
        path: 'generated/tools/jde.ap.voucher.create/schema.json',
        status: 'added',
        patch: '+{}\n',
        additions: 40,
        deletions: 0,
      },
    ],
    roleScope: [
      {
        roleId: 'p2p',
        label: 'Procure-to-Pay',
        toolsAdded: ['jde.ap.voucher.create'],
        toolsRemoved: [],
        bindingGrantsAdded: [],
        bindingGrantsRemoved: [],
      },
    ],
    other: [],
  };
}

export interface StubHostOptions {
  diff?: ChangeDiffSet;
  proposal?: ChangeProposal;
  onPropose?: () => void;
  failDiff?: boolean;
}

export function stubHost(options: StubHostOptions = {}): ChangeHost {
  const proposal = options.proposal ?? fixtureProposal();
  return {
    currentBranch: () => Promise.resolve(proposal.branch),
    describeRemote: () => Promise.resolve({ configured: false as const }),
    saveDraft: () => Promise.resolve(proposal),
    propose: () => {
      options.onPropose?.();
      return Promise.resolve({ ...proposal, state: 'in_review' as const });
    },
    discard: () => Promise.resolve(),
    listProposals: () => Promise.resolve([proposal]),
    getProposal: () => Promise.resolve(proposal),
    diff: () =>
      options.failDiff === true
        ? Promise.reject(new Error('diff failed'))
        : Promise.resolve(options.diff ?? fixtureDiff()),
  };
}
