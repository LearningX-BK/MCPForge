// MCPForge — the four always-resident meta-tools. W0-G4, 02 §5.2, §5.8.
//
// `forge.find` · `forge.describe` · `forge.activate` · `forge.invoke`, ~440
// tokens resident, ordinary MCP tools with plain JSON inputs. No
// Claude-specific behaviour, no protocol extension, no REST facade — 02 §5.8's
// degradation ladder works at every rung and no rung fails.

export * from './types.js';
export * from './definitions.js';
export * from './vtc.js';
export * from './session.js';
export {
  resolveDiscovery,
  requiresGrantMessage,
  type DiscoveryVisibility,
  type ToolAccess,
} from './visibility.js';
export { forgeFind, FIND_DEFAULT_LIMIT, FIND_MAX_LIMIT, type FindInput } from './find.js';
export {
  forgeDescribe,
  DESCRIBE_MAX_TOOLS,
  type DescribeInput,
  type DescribeResponse,
  type DescribedTool,
} from './describe.js';
export {
  forgeActivate,
  type ActivateInput,
  type ActivateResponse,
  type ActivateResult,
} from './activate.js';
export { forgeInvoke, type InvokeInput } from './invoke.js';
