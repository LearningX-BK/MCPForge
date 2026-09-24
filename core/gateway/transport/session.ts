// MCPForge — MCP session state for the transport skeleton. W0-E1, 02 §4.2 step [1].
//
// **Decision, explicitly made because the doc is silent on it (CLAUDE.md §8).**
// 02 §4.8 says the gateway is "stateless apart from session and plan-token
// state, both in Postgres" — but that sentence describes the *multi-replica*
// gateway (Wave-0-plus), and CLAUDE.md §3.1 is equally explicit that "the
// gateway runs as one instance at Wave 0 — multi-replica is a Postgres-era
// property." Nothing in `docs\build-plan\02_TECHNICAL_ARCHITECTURE.md` §4.2 or
// §5.0 (this task's `reads:`) specifies a session table, and
// `core/gateway/store/**` (W0-C1/C2) has no session schema today.
//
// So: **session state is in-memory for this skeleton task.** A single Wave 0
// gateway process can hold it safely; nothing here claims cross-replica
// survival. If/when the gateway is run with N replicas (02 §4.8), session
// state moves to the store — that is a follow-on task's decision, not this
// one's, and it is flagged in this task's final report rather than silently
// built either way.
//
// What a "session" is at this layer: the MCP protocol session created by
// `initialize` (an `Mcp-Session-Id`, per the Streamable HTTP transport spec)
// plus the negotiated protocol version. It carries **no identity** — step [2]
// (authentication) and step [3] (identity resolution) are later tasks
// (W0-E2 and the `[2a]` consumer-auth stage). Binding a stub, unauthenticated
// identity marker here would misstate the state of the security chain; this
// module deliberately does not do that.

export interface McpSessionRecord {
  readonly sessionId: string;
  readonly protocolVersion: string;
  readonly createdAt: Date;
}

/** The seam a store-backed implementation would satisfy later, unchanged by callers. */
export interface McpSessionStore {
  create(sessionId: string, protocolVersion: string): McpSessionRecord;
  get(sessionId: string): McpSessionRecord | undefined;
  delete(sessionId: string): void;
  readonly size: number;
}

/** Wave 0 skeleton implementation — see the module doc comment above. */
export function inMemorySessionStore(): McpSessionStore {
  const sessions = new Map<string, McpSessionRecord>();
  return {
    create(sessionId, protocolVersion) {
      const record: McpSessionRecord = { sessionId, protocolVersion, createdAt: new Date() };
      sessions.set(sessionId, record);
      return record;
    },
    get(sessionId) {
      return sessions.get(sessionId);
    },
    delete(sessionId) {
      sessions.delete(sessionId);
    },
    get size() {
      return sessions.size;
    },
  };
}
