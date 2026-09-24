// MCPForge — the deterministic codegen emit engine. W0-B4.
// See writer.ts (deterministic file writer), provenance.ts (header format,
// 02 §2.3), hash.ts (`manifest-sha256`), version.ts (`codegen-version`) and
// pipeline.ts (the `forge codegen` orchestration entry point).

export { manifestSha256 } from './hash.js';
export {
  provenanceCommentHeader,
  provenanceJsonFields,
  provenanceLine1,
  provenanceLine2,
  type ProvenanceInfo,
} from './provenance.js';
export { codegenVersion } from './version.js';
export {
  formatTsDeterministic,
  readGeneratedFile,
  serializeJsonDeterministic,
  sortKeysDeep,
  writeGeneratedFile,
  writeGeneratedFiles,
  type GeneratedFile,
} from './writer.js';
export { findToolManifest, runCodegen, type CodegenReport } from './pipeline.js';
// W0-B5 — the three-file split, the contract-hash and --accept-contract (02 §2.4).
export {
  acceptContract,
  contractHash,
  contractSnapshot,
  contractSnapshotPath,
  customBindingPath,
  customBindingRepoPath,
  diffContracts,
  formatContractDriftHuman,
  hasCustomBinding,
  readContractHashComment,
  readContractSnapshot,
  renderCustomBindingStub,
  replaceContractHashComment,
  syncCustomBinding,
  CONTRACT_HASH_MARKER,
  CUSTOM_BINDING_CONTRACT_DRIFT,
  type AcceptContractResult,
  type AcceptContractRefusal,
  type AcceptContractSuccess,
  type ContractChange,
  type ContractDriftFailure,
  type ContractInput,
  type ContractResultKey,
  type ContractSnapshot,
  type CustomBindingAction,
  type CustomBindingResult,
} from './custom.js';
