// MCPForge — the git-held group->role mapping. W0-D4, 02 §4.4.
//
// W0-P15 moved the implementation into the gateway
// (`core/gateway/identity/group-role-mapping.ts`), which must read it at
// session establishment and may not depend on the CLI. This re-export keeps the
// CLI's `forge identity remap` on the SAME code; there is no second copy.
export * from '@mcpforge/gateway/identity/group-role-mapping';
