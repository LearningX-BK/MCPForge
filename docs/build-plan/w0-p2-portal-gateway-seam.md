# W0-P2 — The portal↔gateway read seam

**Status: DECIDED 25 Sep 2026 — Option C adopted by the owner. See §7.** This note is the whole of `W0-P2`; no code was written.
Author: build lane (Opus), 24 Sep 2026.

---

## 0. The one-paragraph version

The portal has no connection to the gateway. It has **zero** API routes and **zero** `fetch` calls, so 13 of its 22 pages read hand-written fixtures. The specification assumed otherwise — 03 §1 and 02 §6.5 (R8) both state that *"the portal talks to the gateway only over its HTTP API"* — but **that HTTP API was never specified and does not exist**: the gateway serves exactly `/mcp`, two metadata paths and a deliberate 403. So R8 is not being violated by a shortcut; it is unimplementable as written, because the surface it names is absent. Closing the gap needs a decision that only the owner can make, because every option trades against a different written commitment. **My recommendation is Option C (a read-only governance HTTP API on the gateway, same process, separate path prefix, consumer-authenticated).**

---

## 1. What exists today, verified in source

| Claim | Evidence |
|---|---|
| Portal has no API routes | `find core/portal/src/app -name route.ts` → 0 files |
| Portal never calls the gateway | 0 `fetch` call sites; the only 3 mentions are comments deferring the work (`components/palette/find-client.ts:23`, `command-palette.tsx:14`) |
| Gateway serves one door | `core/gateway/transport/http.ts` routes `MCP_PATH`, the AS/PR metadata paths, and the DCR 403. Nothing else. |
| 13 pages are fixture-backed | Home, Approvals, Approval detail, Activity, Activity→Consumers, Call detail, Insights, Requests, Build, Environments ×3 |
| Fixtures are layered | `home/fixtures.ts` imports `approvals/`, `activity/`, `catalog/`, `requests/` fixtures — Home is a fixture of fixtures |
| The definitional half is genuinely real | Governance reads `roles/`/`consumers/` and compiles them; Build's checks pane runs a real `forge validate` in a sandbox; propose/discard is a real `LocalGit` |
| The runtime half has no source at all | audit rows, calls, approvals, integrity chain, consumer usage, probe status |
| A consumer already exists for this | `consumers/portal-local.consumer.yaml` — `class: interactive-client`, `credential.method: client-secret`, `roles: [p2p]`, `writeAllowed: true` |

**The seams were built for this swap and are unused.** `HomeSource` and its siblings exist precisely so a live client can replace a fixture without touching a component. That is the one piece of good news in this note: the refactor surface is small and was anticipated.

---

## 2. The constraint that makes this hard

Three written commitments point in different directions.

1. **R8 (02 §6.5, 02 §11.5 rule 7, 03 §1):** the portal reads gateway data *"through the same HTTP/API surface an external client would, never through in-process access to gateway internals."* Rationale: *"if the portal can only work by reaching inside the gateway, headless mode is a fiction"* — and headless mode is what prices D1 sub-question 2.
2. **"No REST facade" (CLAUDE.md §3, 02 §5):** discovery is strictly spec-baseline MCP. **Read this scope carefully** — in every place it appears it governs *discovery for agents* (no REST discovery endpoint, no client-side progressive disclosure, no vector DB). It is not, on my reading, a blanket prohibition on the gateway serving any non-MCP HTTP. A reviewer who reads it as blanket will reject Option C, which is exactly why this is the owner's call and not mine.
3. **The token budget (CLAUDE.md §5):** role core set ≤1,300 tokens, enforced at codegen. Anything added to the agent-visible tool catalogue costs against it.

There is also an enforcement fact worth knowing before choosing: `tools/ci/src/portal-http-boundary.ts` (stage 1) statically scans the portal for runtime `@mcpforge/gateway` imports and permits only a small allowlist of pure helpers. **Whatever is decided here, that check is the thing that will police it** — and it is currently failing for 11 unrelated violations (`W0-P7`).

---

## 3. The options

### Option A — the portal becomes an MCP client

The portal opens an MCP session as `portal-local` and reads everything through `/mcp`.

- **For:** perfectly R8-compliant by construction — it literally is "the same surface an external client would use". Uses the consumer record that already exists. Adds no new door, so no new attack surface.
- **Against, and this is fatal:** MCP gives `tools/list` plus the four meta-tools. **It has no vocabulary for audit rows, an approval queue, a hash-chain verification, consumer usage or probe status.** Serving those would mean minting new MCP tools (`forge.audit.list`, `forge.approvals.pending`, …), which (a) puts audit and approval data into the **agent-visible** catalogue, where every registered agent can discover it — a sensitivity decision nobody has taken; (b) spends the ≤1,300-token role budget on tools no agent should call; (c) inverts the product's own model, in which governance data is something humans review *about* agents, not something agents enumerate.
- **Verdict:** rejected. It satisfies the letter of R8 by corrupting the tool catalogue.

### Option B — Next server components read the SQLite store directly

Portal server components open `./.mcpforge/runtime.db` through `core/gateway/store/`.

- **For:** trivial to build; no new HTTP; naturally fast; reuses the existing Drizzle layer.
- **Against:** **this is the exact thing R8 forbids**, and the consequence is concrete rather than theoretical — in `MCPFORGE_MODE=headless` the portal is not running, and in Mode B (own-process module servers) or the eventual Postgres/multi-replica era the portal may not share a filesystem with the gateway at all. It also routes around the gateway's policy chain: a portal page could read an audit row the caller's own grants would not permit, and there would be nothing in the way. `portal-http-boundary.ts` would have to be gutted to allow it.
- **Verdict:** rejected. It makes headless mode a fiction, which is the sentence R8 was written to prevent.

### Option C — a read-only governance HTTP API on the gateway ★ recommended

The gateway serves a second path prefix — say `/api/v1/**` — alongside `/mcp`: **read-only**, consumer-authenticated, identity-resolved, policy-filtered, and serving exactly the governance reads the portal's pages need (audit calls, approval queue, integrity verification, consumer usage, probe/enablement status, kill-switch state).

- **For:** it is a real HTTP API, so R8 holds in substance and headless mode stays honest — the portal is an ordinary client of a documented surface and can be switched off, moved to another host, or replaced. It keeps governance data **out** of the agent tool catalogue, so the token budget and the sensitivity model are untouched. It runs the same authentication and identity chain, so non-negotiable #6's consumer ∩ human intersection applies to portal reads too — which is the precondition for `W0-P4`'s viewer identity work to mean anything. And it gives `portal-http-boundary.ts` something coherent to enforce: the portal imports **nothing** from the gateway at runtime.
- **Against:** it is a new HTTP surface on the security-critical process, so it needs its own authn/authz tests and its own kill-switch respect; and a reviewer who reads "no REST facade" as absolute will object. Mitigations: read-only by construction (no POST/PUT/DELETE — writes continue to go through `/mcp` and the write-path, and through git for definitions), one prefix, versioned, and documented as *governance reads for registered consumers*, never as an agent-facing discovery or invocation surface.
- **Cost:** the largest of the three, and the honest reason it is still the recommendation is that the other two are not merely more expensive later — they are wrong.

---

## 4. What the note must decide — the four questions `W0-P2` asks

**(a) Which surface, and how does it exist at all?**
Recommendation: **Option C.** A read-only `/api/v1/**` prefix on the gateway process, consumer-authenticated exactly as `/mcp` is (`portal-local`'s `client-secret`), identity-resolved per request, and policy-filtered so a response never contains a row the caller's own grants would not permit. **R8 consequence, stated as the task requires:** the portal imports nothing from `@mcpforge/gateway` at runtime, so `tools/ci/src/portal-http-boundary.ts` needs **no new allowlist entries** — the allowlist should shrink, not grow. That is the test of whether this was done right.

**(b) How are the existing `*Source` interfaces satisfied?**
One client module, `core/portal/src/lib/gateway-client/`, exporting one typed function per source interface and nothing else. Each existing `HomeSource`-shaped interface gets a live implementation beside its fixture; pages keep their current shape. The client is the *only* file that knows a URL. Types come from a shared contract, never hand-copied into the portal.

**(c) What does a page show when the gateway is down?**
This is not an edge case — **it is the normal state on a developer laptop**, and it is the question most likely to be got wrong. A gateway-down state must be **visibly distinct from an empty state**, because "no audit rows yet" and "cannot reach the gateway" must never look alike: one is a fact about the system, the other is a fact about the connection, and conflating them is how a demo silently asserts that nothing has happened. Recommendation: a single reusable banner naming the unreachable endpoint and carrying a `next` (start the gateway, with the command) — per non-negotiable #5 applied to a human surface — and no skeleton rows behind it.

**(d) Do the fixtures survive?**
Yes, as the **test and component-development source only**, kept behind the same `*Source` interfaces and never imported by a `page.tsx`. They are good fixtures and the component tests depend on them. A lint rule or a `portal-http-boundary`-style check should assert that no `page.tsx` imports a `fixtures.ts` once `W0-P3` lands, or the fixtures will quietly creep back.

---

## 5. What I am NOT deciding, and why

- **The endpoint list and response shapes.** They are a file-format decision with a blast radius across 13 pages; they belong in `W0-P3` once the surface is chosen, and they need reviewing as a unit rather than being invented here per page.
- **Whether `/api/v1/**` also serves the portal's definitional reads** (roles, consumers, manifests). Today those come from git directly and that is legitimate — the portal is a UX over git (criterion 9). My instinct is to leave them on git and keep the API strictly for *runtime* state, but it is a real design question and I would rather it be answered deliberately than by default.
- **Anything about writes.** Runtime writes go through `/mcp` and the write-path; definitional writes go through git. This seam is reads only. If a later task proposes a write endpoint here, that is a new decision and this note does not authorize it.

---

## 6. Recommendation, in one line

**Adopt Option C.** Then `W0-P3` builds the client, swaps the 13 pages, adds the gateway-down state, and the success test is that `portal-http-boundary.ts`'s allowlist gets *smaller*.

**If the owner reads "no REST facade" as absolute, say so and I will re-plan** — but the honest consequence is that the runtime half of the portal cannot be made real without either corrupting the agent tool catalogue (A) or making headless mode a fiction (B), and that trade should be made knowingly rather than discovered in `W0-P3`.

---

## 7. Decision record — 25 Sep 2026

**Decided by:** the owner (Bikash Pattnaik), in session, 25 Sep 2026.
**Decision:** adopt **Option C**. The owner's words: *"I am unclear what's best as per my expectation, we can go with it."* In other words the owner accepted the recommendation without choosing independently between the options. A later reviewer should know that this is an acceptance of the recommendation rather than a separately argued choice, and is free to reopen it on the evidence in §3.

**What this settles:**

1. **How "no REST facade" (CLAUDE.md §3) is read.** It governs **agent-facing discovery and invocation**: agents reach tools only through `/mcp`, the four meta-tools and role-scoped `tools/list`. It does **not** forbid a read-only governance API for registered consumers. `/api/v1/**` must never serve tool discovery, tool invocation or any write. If a later change moves it towards any of those, that is the REST facade the rule forbids, and it needs a fresh decision.
2. **§5's second open question is settled by default.** Definitional reads (roles, consumers, manifests, approvals) **stay on git**. `/api/v1/**` serves **runtime state only**: audit calls, the approval queue's runtime status, integrity verification, consumer usage, anomaly events, probe and enablement status, and kill-switch state.
3. **§5's first and third items stand unchanged.** `W0-P3` owns the endpoint list and response shapes, reviewed as one unit. This note authorizes no write endpoint.

**Consequences:**
- `W0-P3` is unblocked.
- `W0-P7` (the 11 in-process gateway imports) should land before or together with `W0-P3`, because Option C's success test is that the portal imports nothing from `@mcpforge/gateway` at runtime.
- The new surface sits on the gateway process, so its authn/authz tests belong in `pnpm test:policy`. An unregistered consumer and an unresolved human must both be refused on `/api/v1/**` exactly as on `/mcp` (non-negotiable #6).
