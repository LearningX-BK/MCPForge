// MCPForge — the store's SERVER-ONLY surface. `./index.ts` is safe to reach
// from a portal `'use client'` component (it never pulls in `./dialect.ts`,
// the only file that touches `better-sqlite3`/`pg`/`node:fs`). This file adds
// exactly one thing on top of that barrel: `openRuntimeStore`, which does
// reach `dialect.ts` and therefore must never be imported from client code.
//
// Anything that actually opens a store — `forge` CLI commands, gateway
// server-side code, portal Route Handlers / Server Actions / Server
// Components — imports from `@mcpforge/gateway/store/server`, not
// `@mcpforge/gateway/store`.

export * from './index.js';
export { openRuntimeStore } from './store.js';
// W0-C2 — the audit hash chain. `node:crypto`'s `createHash`, so server-only;
// see `./index.ts`'s comment on `./audit/hash.js`.
export {
  AUDIT_CHAIN_ALGORITHM,
  AUDIT_CHAIN_GENESIS,
  AUDIT_HASHED_COLUMNS,
  auditRowHash,
  canonicalAuditRow,
} from './audit/hash.js';
// W0-C3 — the write path's runtime state. `node:crypto`'s `createHash`, so
// server-only; see `./index.ts`'s comment on `./runtime/idempotency.js`.
export {
  DEFAULT_IDEMPOTENCY_SCOPE_HOURS,
  IDEMPOTENCY_KEY_ALGORITHM,
  confirmTokenHash,
  idempotencyKeyFor,
} from './runtime/idempotency.js';
