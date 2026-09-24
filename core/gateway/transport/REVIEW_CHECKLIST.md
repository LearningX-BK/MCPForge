# W0-E1 review checklist — MCP endpoint skeleton

Required by TASKS.md's `done:` criterion for W0-E1: *"nothing Claude-specific
and nothing outside the 2026-07-28 baseline is used, asserted by a review
checklist item in the commit."* There is no git history yet in this repo, so
this file is that checklist item, colocated with the code it covers.

- [x] **Transport is Streamable HTTP**, per 02 §4.2's request-path diagram
      ("Streamable HTTP, spec-baseline 2026-07-28"). One `/mcp` endpoint
      handling `POST` (RPC, including `initialize`), `GET` (optional
      server-initiated SSE) and implicit session lifecycle via
      `Mcp-Session-Id` — see `http.ts`. No HTTP+SSE (the transport this one
      replaced), no REST facade, no second endpoint shape.
- [x] **No Claude-specific assumption.** The server advertises only the
      `tools` capability it implements (`server.ts`); it does not assume a
      particular client, does not special-case any client `Implementation`
      name/version, does not do client-side progressive disclosure, and does
      not read any Claude-specific header, field or extension. The one client
      used to *prove* the handshake (`transport.e2e.test.ts`) is the official
      `@modelcontextprotocol/sdk` `Client` — a generic implementation of the
      spec used by every MCP client, not a Claude-specific one. This matches
      02 §5.0: "A client that does nothing but `initialize` -> `tools/list`
      -> `tools/call` gets the full benefit."
- [x] **No vector database, no client tool filtering, no `_meta` narrowing
      hints used.** This skeleton lists exactly one stub tool; none of §5's
      discovery mechanism (`forge.find`/`describe`/`activate`/`invoke`,
      role-scoped catalogues) is implemented here — that is explicitly out of
      this task's scope per TASKS.md.
- [ ] **Flag for human review — protocol version string mismatch.** 02 §4.2
      names the baseline "2026-07-28". The installed
      `@modelcontextprotocol/sdk` (current published release) implements
      `SUPPORTED_PROTOCOL_VERSIONS` up to `2025-11-25` and has no release
      advertising `2026-07-28`. This code does not hardcode either string —
      it negotiates whatever version the connecting client and the installed
      SDK agree on (the spec-correct behaviour) — but the literal
      "2026-07-28" cannot be produced by anything installable today. See the
      comment at the top of `http.ts`. **Not resolved by this task**; named
      here per CLAUDE.md §8 rather than silently substituted.
- [x] **No secret values, no credentials, no identity assertion.** This
      skeleton carries no `Principal`, no `identity.carries: verified`, no
      stored credential. Authentication (02 §4.2 step [2]) and identity
      resolution (step [3]) are explicitly later tasks; nothing here fakes
      either.
- [x] **Session state is in-memory**, a deliberate, documented Wave-0
      single-instance decision — see the module doc comment in `session.ts`.
      Not store-backed; flagged there as a follow-on decision for whichever
      task first needs multi-replica session survival.
