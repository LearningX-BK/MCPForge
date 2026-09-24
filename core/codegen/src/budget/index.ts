// MCPForge — the token-budget gate package. W0-G5, 02 §5.3.
// `forge ci` stage 9 (`tools/ci/src/stages.ts`) is this package's only
// caller today.

export { buildDescribeResponse } from './describe.js';
export { ACCESS_FIELD_TOKEN_BUDGET } from './access.js';
export type {
  BudgetFailure,
  TokenBudgetGateResult,
  ToolTokenMeasurement,
  RoleTokenMeasurement,
} from './gate.js';
// `runTokenBudgetGate` and `chooseDemotions` (./gate.js) are deliberately NOT
// re-exported as VALUES here — `gate.js` imports `../emit/version.js`'s
// `codegenVersion()`, which reads `package.json` off disk (`node:fs`/
// `node:path`/`node:url`) and so is server-only. This barrel is what the
// portal's `/build` live preview (`representations.ts`, W0-J14) reaches
// through `@mcpforge/codegen/budget` for the pure `buildDescribeResponse`.
// `forge ci` stage 9 imports the gate itself from
// `@mcpforge/codegen/budget/server`.
