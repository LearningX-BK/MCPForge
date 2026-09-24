// MCPForge — W0-P7: the read-only consumer-RECORD surface.
//
// `@mcpforge/gateway/consumer` (./index.ts) is the whole consumer module:
// record model, registry reader, lifecycle proposals, the proposal WRITER
// (`proposal.ts`, `node:fs` writes) and credential ISSUANCE (`credential.ts`,
// `randomBytes` + secret files). A process that imports the barrel loads all
// of it. The portal needs none of the writing half — it reads `consumers/**`
// from git (a definitional read, which W0-P2 §7 keeps on git) and scaffolds a
// registration's starting text that reaches git only as a change proposal.
//
// This entry exposes exactly that and nothing else. Its module graph is
// `types.ts` (zod only), `registry.ts` (reads `consumers/**`), `lifecycle.ts`
// and `approval.ts` (both pure — they return objects and strings, write
// nothing). `records.test.ts` asserts `credential.ts` and `proposal.ts` are
// not reachable from here at runtime, so this entry cannot quietly grow into
// a second barrel. The portal may import from this subpath only the symbols
// `tools/ci/src/portal-http-boundary.ts` allowlists for it.

export * from './types.js';
export { loadConsumerRegistry } from './registry.js';
export {
  DEFAULT_REGISTRATION_DAYS,
  addDays,
  renderConsumerRecord,
  scaffoldConsumerRecord,
} from './lifecycle.js';
