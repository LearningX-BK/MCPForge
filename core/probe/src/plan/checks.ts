// MCPForge — the check catalogue, one row per line of 02 §4.5's per-binding
// table. W0-H4.
//
// This is DATA, deliberately: a frozen table of literal specs, so what the
// probe checks for a binding type is reviewable in one screen and cannot be
// synthesised at run time from anything a caller controls.
//
// Every entry is `read-only` or `validate-only`. That is not a convention here
// either — `ProbeCheckSpec<NonMutatingClassification>` is the declared element
// type, so adding a `mutating` row to this table is a compile error.

import type { BindingType } from '@mcpforge/shared/manifest';
import type { NonMutatingClassification, ProbeCheckSpec } from './types.js';

type Spec = ProbeCheckSpec<NonMutatingClassification>;

function spec(s: Spec): Spec {
  return Object.freeze(s);
}

/** 02 §4.5, `rest` row. */
const REST: readonly Spec[] = [
  spec({
    name: 'token_acquisition',
    classification: 'read-only',
    bindingType: 'rest',
    failureStatus: 'disabled_identity_unverified',
    writeOnly: false,
    describe: 'Token acquisition for the test identity succeeds',
  }),
  spec({
    name: 'endpoint_resolves',
    classification: 'read-only',
    bindingType: 'rest',
    failureStatus: 'disabled_missing_binding',
    writeOnly: false,
    describe: 'The declared host/path resolves (OPTIONS, metadata endpoint or a bounded safe GET)',
  }),
  spec({
    name: 'response_shape',
    classification: 'read-only',
    bindingType: 'rest',
    failureStatus: 'disabled_schema_drift',
    writeOnly: false,
    describe: 'The response shape matches the declared output paths',
  }),
  spec({
    name: 'identity_me_resource',
    classification: 'read-only',
    bindingType: 'rest',
    failureStatus: 'disabled_identity_unverified',
    writeOnly: false,
    describe: 'Identity check against a /me-style resource where one exists',
  }),
];

/** 02 §4.5, `database` row. Read-only by binding type as well as by check. */
const DATABASE: readonly Spec[] = [
  spec({
    name: 'connect_and_select_1',
    classification: 'read-only',
    bindingType: 'database',
    failureStatus: 'disabled_missing_binding',
    writeOnly: false,
    describe: 'Connect as the module DB user and SELECT 1',
  }),
  spec({
    name: 'objects_exist_and_readable',
    classification: 'read-only',
    bindingType: 'database',
    failureStatus: 'disabled_missing_binding',
    writeOnly: false,
    describe: 'Every referenced object exists (ALL_OBJECTS) and is readable (ALL_TAB_PRIVS)',
  }),
  spec({
    name: 'no_write_grants_held',
    classification: 'read-only',
    bindingType: 'database',
    failureStatus: 'disabled_no_grant',
    writeOnly: false,
    describe:
      'No write grants are held by the module DB user (database bindings are read-only by policy)',
  }),
  spec({
    name: 'set_identifier_propagates',
    classification: 'read-only',
    bindingType: 'database',
    failureStatus: 'disabled_identity_unverified',
    writeOnly: false,
    describe: 'SET_IDENTIFIER propagates and reads back from V$SESSION',
  }),
];

/** 02 §4.5, `plsql` row, extended by 02 §11.4.3's grant reconciliation. */
const PLSQL: readonly Spec[] = [
  spec({
    name: 'wrapper_package_valid',
    classification: 'read-only',
    bindingType: 'plsql',
    failureStatus: 'disabled_missing_binding',
    writeOnly: false,
    describe: 'The wrapper package exists and is VALID',
  }),
  spec({
    name: 'execute_granted_on_wrapper',
    classification: 'read-only',
    bindingType: 'plsql',
    failureStatus: 'disabled_no_grant',
    writeOnly: false,
    describe: 'EXECUTE is granted on the wrapper package',
  }),
  spec({
    name: 'no_execute_on_apps_objects',
    classification: 'read-only',
    bindingType: 'plsql',
    failureStatus: 'disabled_no_grant',
    writeOnly: false,
    describe: 'EXECUTE is NOT granted on any APPS-owned object',
  }),
  spec({
    name: 'probe_context',
    classification: 'read-only',
    bindingType: 'plsql',
    failureStatus: 'disabled_identity_unverified',
    writeOnly: false,
    describe: 'PROBE_CONTEXT returns the FND user/resp/org established for the test identity',
  }),
  spec({
    name: 'probe_commit_behaviour',
    classification: 'read-only',
    bindingType: 'plsql',
    failureStatus: 'degraded_readonly',
    writeOnly: false,
    describe: 'PROBE_COMMIT_BEHAVIOUR classifies commitsInternally (02 §3.4)',
  }),
  spec({
    name: 'binding_grant_reconciliation',
    classification: 'read-only',
    bindingType: 'plsql',
    failureStatus: 'disabled_no_grant',
    writeOnly: false,
    describe:
      'The compiled gateway bindingGrants and the database-side EXECUTE grants name the same wrapper packages (02 §11.4.3)',
  }),
];

/** 02 §4.5, `function` row. Wave 0's only live binding type. */
const FUNCTION: readonly Spec[] = [
  spec({
    name: 'auth_token_for_test_identity',
    classification: 'read-only',
    bindingType: 'function',
    failureStatus: 'disabled_identity_unverified',
    writeOnly: false,
    describe: 'The auth flow yields a token for the test identity',
  }),
  spec({
    name: 'whoami',
    classification: 'read-only',
    bindingType: 'function',
    failureStatus: 'disabled_identity_unverified',
    writeOnly: false,
    describe: 'MCPFORGE_PROBE_WHOAMI returns which identity actually executed',
  }),
  spec({
    name: 'validate_sibling',
    // validate-only: the *_VALIDATE orchestration is the target's own dry-run
    // sibling. It is not a write, and this is the reason the classification
    // union has a second non-mutating member at all.
    classification: 'validate-only',
    bindingType: 'function',
    failureStatus: 'degraded_readonly',
    writeOnly: true,
    describe:
      'For write tools, the *_VALIDATE sibling exists and returns the expected error structure',
  }),
  spec({
    name: 'orchestration_version',
    classification: 'read-only',
    bindingType: 'function',
    failureStatus: 'disabled_schema_drift',
    writeOnly: false,
    describe: 'The orchestration version matches binding.refVersion',
  }),
];

/** 02 §4.5, `wrapped-vendor` row. */
const WRAPPED_VENDOR: readonly Spec[] = [
  spec({
    name: 'vendor_handshake',
    classification: 'read-only',
    bindingType: 'wrapped-vendor',
    failureStatus: 'disabled_missing_binding',
    writeOnly: false,
    describe: 'Vendor initialize and tools/list succeed',
  }),
  spec({
    name: 'advertised_tool_set_diff',
    classification: 'read-only',
    bindingType: 'wrapped-vendor',
    failureStatus: 'disabled_schema_drift',
    writeOnly: false,
    describe: 'The advertised tool set matches the wrap manifests',
  }),
  spec({
    name: 'schema_hash_match',
    classification: 'read-only',
    bindingType: 'wrapped-vendor',
    failureStatus: 'disabled_schema_drift',
    writeOnly: false,
    describe: 'Schema hashes compare equal',
  }),
  spec({
    name: 'scope_narrowing_asserted',
    classification: 'read-only',
    bindingType: 'wrapped-vendor',
    failureStatus: 'disabled_no_grant',
    writeOnly: false,
    describe: 'Scope narrowing is asserted against the vendor server',
  }),
];

export const CHECK_CATALOGUE: Readonly<Record<BindingType, readonly Spec[]>> = Object.freeze({
  rest: REST,
  database: DATABASE,
  plsql: PLSQL,
  function: FUNCTION,
  'wrapped-vendor': WRAPPED_VENDOR,
});

/** Every declared check, flattened — for the structural tests and for docs. */
export const ALL_CHECKS: readonly Spec[] = Object.values(CHECK_CATALOGUE).flat();
