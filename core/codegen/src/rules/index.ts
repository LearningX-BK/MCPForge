// MCPForge — the W0-B3 policy and safety rule set for `forge validate`.
//
// These plug into the W0-B2 extension seam (`ValidationRule`,
// core/codegen/src/validate/types.ts) and run against the identical
// `RepoContext` the structural and referential passes do. There is no second
// validation engine and no second entry point: `validateRepo` runs these by
// DEFAULT, so a caller must pass an explicit rule array to get anything less
// — the fail-closed direction.
//
// Layout note: 02 and TASKS.md name this directory `core/codegen/rules/**`.
// The package compiles with rootDir `src`, so every TypeScript source in
// @mcpforge/codegen lives under `src/` and these rules sit at
// `core/codegen/src/rules/**` beside `src/validate/**`. The OPUS_GUARDED_PATHS
// entry is meant for this code wherever it physically sits.

import { SOD_RULES } from '../compile/sod.js';
import type { ValidationRule } from '../validate/types.js';
import { BINDING_RULES } from './binding.js';
import { COPY_RULES } from './copy.js';
import { CREDENTIAL_RULES } from './credentials.js';
import { EVAL_RULES } from './evals.js';
import { GRANT_RULES } from './grants.js';
import { WRITE_SAFETY_RULES } from './write-safety.js';

export { BINDING_RULES, PLSQL_WRAPPER_REF_RE, ELEVATED_BINDING_TYPES } from './binding.js';
export {
  COPY_RULES,
  INLINE_ENUM_MAX_VALUES,
  PARAM_DESC_MAX_WORDS,
  PURPOSE_MAX_WORDS,
} from './copy.js';
export { CREDENTIAL_RULES } from './credentials.js';
export { EVAL_RULES, loadEvalStrings } from './evals.js';
export { GRANT_RULES, WRAPPER_PACKAGE_RE, loadApprovalRefs } from './grants.js';
export { WRITE_SAFETY_RULES } from './write-safety.js';

/** Every W0-B3 policy and safety rule, in a stable order. */
export const POLICY_RULES: readonly ValidationRule[] = [
  ...WRITE_SAFETY_RULES,
  ...BINDING_RULES,
  ...COPY_RULES,
  ...EVAL_RULES,
  ...CREDENTIAL_RULES,
  ...GRANT_RULES,
  // W0-B8 — segregation of duties over compiled role scopes (02 §4.3). It
  // lives under src/compile/ with the compiler whose output it reasons about,
  // and joins the DEFAULT rule set here so `forge validate` runs it without
  // any caller opting in.
  ...SOD_RULES,
];
