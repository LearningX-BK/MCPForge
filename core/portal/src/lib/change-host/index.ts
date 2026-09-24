// MCPForge — W0-J12: the `ChangeHost` barrel.
//
// DELIBERATELY TYPES AND CONTEXT ONLY. `LocalGit` and `HostedGit` are NOT
// re-exported here: importing the barrel must never pull `node:child_process`
// into a client bundle, and more importantly nothing above the interface may
// name an implementation (02 §10.1 item 1). A server entry point that has to
// construct one imports `./local-git` directly, and exactly one file in the
// repo is allowed to do so — see `change-host.contract.test.ts`.
export {
  ChangeHostError,
  changeDiffSetSchema,
  changeHostErrorCodes,
  changeProposalSchema,
  diffFileSchema,
  diffFileStatuses,
  remoteInfoSchema,
  reviewRecordSchema,
  roleScopeDeltaSchema,
  type ChangeDiffSet,
  type ChangeHost,
  type ChangeHostErrorCode,
  type ChangeProposal,
  type ChangeState,
  type DiffFile,
  type DiffFileStatus,
  type ProposeInput,
  type RemoteInfo,
  type ReviewRecord,
  type RoleScopeDelta,
  type SaveDraftInput,
} from './types';

export {
  ChangeHostProvider,
  DEFAULT_REPO_STATE,
  useOptionalChangeHost,
  useRepoState,
  type ChangeHostProviderProps,
  type RepoState,
} from './context';

// The one composed, `LocalGit`-backed `ChangeHost` real routes get by
// default — see `default-host.ts`'s header for why this is safe to export
// from the barrel (it names no implementation, only server actions).
export { defaultChangeHost } from './default-host';
