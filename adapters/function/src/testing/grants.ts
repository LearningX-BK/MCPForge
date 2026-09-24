// MCPForge — W0-P9: the execution-grant check used by TESTS of this package.
//
// Strict, not permissive: it accepts exactly `TEST_EXECUTION_GRANT` and refuses
// a missing grant or any other string, so every executor test still proves the
// executor refuses what it should. What it does NOT test is the binding (tool,
// binding ref, arguments, caller, correlation id, expiry, signature). That is
// the real HMAC verifier's job, tested in
// `core/gateway/policy/execution-grant/grant.test.ts` and end to end in
// `tests/policy/escalation.trust-boundary.test.ts`.
//
// `@mcpforge/adapter-function/testing` must never be imported by production
// code; the trust-boundary suite asserts that statically.

import type { ExecutionGrantCheck } from '../types.js';

export const TEST_EXECUTION_GRANT = 'test-execution-grant';

export const TEST_GRANTS: ExecutionGrantCheck = {
  check(grant) {
    if (grant === TEST_EXECUTION_GRANT) return { ok: true };
    return { ok: false, reason: grant === undefined ? 'missing' : 'not the test grant' };
  },
};
